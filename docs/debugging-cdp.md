# 使用 CDP 联合调试 Electron 应用

> 用途：在没有原生菜单 / DevTools 快捷键的 Electron 应用中，用 Chromium DevTools 协议（CDP）从命令行远程联调 Renderer，定位运行时问题（如网络、图片、DOM、状态）。
> 本文源自 Issue #124 排查过程中沉淀的可复用方法。

---

## 1. 原理

应用在 `src/main/application-menu.ts` 中调用 `removeApplicationMenu(null)`，移除了 Electron 原生菜单，也没有内置 DevTools 快捷键。因此不能靠 GUI 快捷键打开 DevTools，需要：

1. 启动 Electron 时开启 CDP **远程调试端口**（`--remote-debugging-port`）。
2. 从命令行 / 脚本通过该端口接上任一页面 target，用 DevTools 协议执行表达式、监听网络事件。

这个机制**不改产品代码**，仅用于调试期。

---

## 2. 启动带调试端口的应用

本项目用 `electron-forge start` 同时启动 Vite dev server（提供 Renderer）和 Electron。要注入调试参数，用命令后的 `--` 透传给 Electron：

```bash
node_modules/.bin/electron-forge start -- --remote-debugging-port=9222
```

启动成功后会看到日志：

```
DevTools listening on ws://127.0.0.1:9222/devtools/browser/<id>
```

> 说明：
> - `electron . --remote-debugging-port=9222` 单独运行**不可行**，因为构建产物里没有 Renderer 的 `index.html`，Renderer 由 Vite dev server 提供（见 `vite.*.config.ts`）。必须走 `forge start`。
> - Fuses 配置里的 `EnableNodeCliInspectArguments: false` 只影响 Node **主进程** inspect，不影响渲染进程的 CDP。

### 查看可连接的目标

```bash
curl -s http://127.0.0.1:9222/json
```

返回的数组里，`type === "page"` 的是主窗口页面，取它的 `webSocketDebuggerUrl`。

---

## 3. 用 Node 内置 WebSocket 驱动 CDP

Node 24 自带全局 `WebSocket`，无需 `ws` 依赖即可写一个最小 CDP 驱动。

### 3.1 求值表达式（Runtime.evaluate）

```javascript
const target = (await (await fetch('http://127.0.0.1:9222/json')).json())
  .find((t) => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map();

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const i = ++id; pending.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
}
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id); pending.delete(msg.id);
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
  }
};
await new Promise((r) => (ws.onopen = r));

const result = await send('Runtime.evaluate', {
  expression: `({ imgs: [...document.querySelectorAll('.entry-detail-html img')].map(i => ({
    src: i.currentSrc, complete: i.complete, naturalWidth: i.naturalWidth,
  })) })`,
  returnByValue: true, awaitPromise: true,
});
console.log(JSON.stringify(result.result?.value, null, 2));
ws.close();
```

### 3.2 监听网络事件（定位 ERR_BLOCKED_BY_ORB 之类）

```javascript
ws.onmessage = (ev) => { /* 在 3.1 基础上追加： */
  const m = JSON.parse(ev.data);
  if (m.method === 'Network.loadingFailed') {
    console.log('FAIL', m.params.errorText, m.params.blockedReason);
  }
  if (m.method === 'Network.responseReceivedExtraInfo') {
    console.log('EXTRA headers:', m.params.headers['content-type']);
  }
};
// 先 enable，再触发资源加载
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Runtime.evaluate', {
  expression: `new Promise((res) => { const i = new Image();
    i.onload = () => res('OK'); i.onerror = () => res('ERR');
    i.src = 'https://...'; setTimeout(() => res('TIMEOUT'), 5000); })`,
  awaitPromise: true, returnByValue: true,
});
```

---

## 4. 排查技巧与踩坑

### 4.1 关键：不要把 `ws.onmessage` 覆盖

CDP 既要用同一个 WebSocket 响应 **pending 的 request**，又要接收 **异步事件**（`Network.*` 等）。务必在同一个 `onmessage` 里**同时**处理「`m.id` 匹配 pending」和「`m.method` 事件」。若把 `ws.onmessage` 直接覆盖成只处理事件的回调，所有请求的 Promise 都会永久挂起（表现为脚本长时间不退出的"卡住"）。

### 4.2 给脚本加看门狗超时

CDP 脚本可能因事件缺失而卡住。每个脚本加一个 `setTimeout` 退出，避免占住终端：

```javascript
const wd = setTimeout(() => { console.log('WATCHDOG'); process.exit(0); }, 20000);
// ... 完成后
clearTimeout(wd); ws.close();
```

### 4.3 `Runtime.evaluate` 的返回值读取层级

`send('Runtime.evaluate', ...)` 的结果在 `result.result.value`（多包了一层 `result`）。读取时用 `result.result?.value ?? result?.value` 兜底。

### 4.4 区分「真正解码失败」与「ORB 阻断」

- `<img>` 的 `complete=true` 但 `naturalWidth=0` → 加载完成但解码失败（可能是网络层拒绝了）。
- 配合 `Network.loadingFailed` 的 `errorText`：
  - `net::ERR_BLOCKED_BY_ORB` → **响应被浏览器安全机制拒绝**，需对响应头/源站行为做对照验证，而不是怀疑 URL 本身。
  - 其它错误（DNS、timeout、403）→ 网络/站点层面问题。

### 4.5 对照实验：确定 REFERRER / MIME 根因

遇到 ORB 时，判断是不是「referer 校验」或「MIME 被改写」：

```bash
# 无 referer
curl -sI "https://host/path/image.jpg"

# 带页面 referer（用页面 origin）
curl -sI -e "http://localhost:5173/" "https://host/path/image.jpg"
```

比较 `Content-Type` 与 HTTP 状态码。若「无 referer = 图片 200，带 referer = 403/html」，即可断定是目标站的 referer 校验，并同步从 CDP 的 `Network.responseReceivedExtraInfo` 读取 Chromium 实际收到的 `content-type` 交叉确认。

### 4.6 环境变量 / 代理干扰

本机可能跑 mihomo/clash 的 TUN 模式（虚拟网卡 `tun.enable: true`），会透明接管流量。调试网络问题时，先确认：

```bash
pgrep -af mihomo        # 进程
ip addr show Mihomo     # TUN 设备是否存在
```

但它未必是根因——必须用对照实验定位（见 4.5）。在 Issue #124 中，关闭代理后现象不变，证明根因不在代理，而在站点的 referer 校验。

---

## 5. 参考

- CDP 协议文档：<https://chromedevtools.github.io/devtools-protocol/>
- Electron 远程调试：`--remote-debugging-port`、`--remote-debugging-address`
- 根因分析结论：`docs/analysis/issue-124-image-referrer-policy.md`