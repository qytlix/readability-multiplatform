# Issue #124 分析：正文图片在 Reader 中加载失败（ERR_BLOCKED_BY_ORB）

> 分析日期：2026-08-02
> 分析人：Coding Agent（qytlix 辅助，联合内置调试器）
> 对应 Issue：[#124](https://github.com/qytlix/readability-multiplatform/issues/124)
> 修复分支：`fix/issue-124-image-referrer-policy`

---

## 1. 问题总结

Jeff Geerling 的文章（`Adding a backup Internet WAN on my OPNsense Router`）正文图片经抓取与 Cleaning 后无法在 Reader 中正常显示，只留下破损图片标识和 alt 文本。

用户观察到的关键现象：**单独打开解析出的图片 URL（用浏览器顶层导航）可以显示，但在 Reader 中图片在「损坏图片」与「空内容」之间反复转换。**

Issue 原文最初指向「相对 URL / srcset / picture / 懒加载属性」等 Cleaning 层面的处理。本次通过内置调试器联合排查后**推翻了这一方向**：Cleaning 层正确输出了规范绝对 HTTPS URL，真正的根因位于 **Render 阶段的跨域子资源加载，被目标站点（Cloudflare）的 referer 校验拒绝，进而触发 Chromium 的 ORB 机制**。

---

## 2. 排查过程（联合内置调试器）

### 2.1 启动带调试端口的应用

应用移除了原生菜单、且无内置 DevTools 快捷键，因此通过 `electron-forge start` 透传 `--remote-debugging-port` 启动：

```bash
node_modules/.bin/electron-forge start -- --remote-debugging-port=9222
```

启动后 CDP 监听 `ws://127.0.0.1:9222`，`http://127.0.0.1:9222/json` 可列出 page target 的 `webSocketDebuggerUrl`。

### 2.2 证据链

| 验证方法 | 结果 |
|---|---|
| 从 CDP 读取 Reader 内 `<img>` 节点 | `src` 为**正确的绝对 HTTPS URL**，`complete=true` 但 `naturalWidth=0`、`naturalHeight=0` |
| `curl` 直接请求图片 URL | `200 image/jpeg`，真 JPEG，1400×788 |
| `curl` 带 `Referer: http://localhost:5173/` | **`403 text/plain`，`error code: 1011`，`vary: referer`，`server: cloudflare`** |
| CDP `Network.*` 监听图片子资源 | `requestWillBeSent` type=Image 带 `Referer: http://localhost:5173/`；响应 `content-type: text/html; charset=UTF-8` |
| CDP `Network.loadingFailed` | **`net::ERR_BLOCKED_BY_ORB`** |
| 关闭 mihomo 代理前后 | 现象完全相同（与本地代理无关） |
| 对照：google / imgur / avatars.githubusercontent | 正常加载（站点不校验 referer） |

### 2.3 根因链条

1. Reader 把 `cleanedHtml` 通过 `dangerouslySetInnerHTML` 注入页面，页面运行在 Vite dev server 源 `http://localhost:5173/`（开发阶段）。
2. 页面内的 `<img src=绝对URL>` 是**跨域 no-cors 子资源**，Chromium 自动附带当前页面 origin 作为 `Referer: http://localhost:5173/`。
3. 目标站点（Jeff Geerling，Cloudflare 托管）配置了基于 `Referer` 的反爬/bot 校验（`vary: referer`），对不受信任的 referer 返回 `403`，且响应 `Content-Type` 变为 `text/html` / `text/plain` 而非图片。
4. Chromium 的 **ORB（Opaque Response Blocking）** 检测到：`<img>` 请求的响应 `Content-Type` 与预期的图片类型不符，判定为伪造/不可信响应，抛出 **`net::ERR_BLOCKED_BY_ORB`**，图片 `naturalWidth=0` → 破损图。
5. 顶层导航（单独打开图片 URL）不走 no-cors 子资源 / ORB 路径，且 referer 行为不同，因此可以显示。

---

## 3. 结论：这不是 Cleaning/URL 规范化 bug

Issue #124 原文担心的「相对 URL / srcset / picture / 懒加载属性」方向**是误判**。实测当前 `main` 分支上：

- 4 张正文图片的 `src` 全部被 `ContentCleaner` 规范化为正确绝对 HTTPS URL；
- 相对 URL 处理修复（`291068d`，cleaner v6）早在 Issue 创建前已合入。

真正根因是 **渲染期跨域图片子资源因 Referer 被目标站拒绝并触发 ORB**，属站点 referer 校验 + 浏览器安全机制的交互，与内容管线无关。

---

## 4. 修复方案：为图片注入 `referrerpolicy="no-referrer"`

对这类 Cloudflare referer 校验的最直接、最通用修复，是在 Cleaning 输出的 `<img>` 上注入 `referrerpolicy="no-referrer"`，让图片子资源请求不再携带页面 `Referer`，从而不被站点按 referer 拒绝。

需要处理的位置（图片最终注入 Reader 的 HTML）：

- `src/main/feed/fetcher/ContentCleaner.ts` — `normalizeReaderImages()`，对 `<img>` 设置 `referrerpolicy`；
- 其它会以图片节点进入 Reader 的入口（如 `cleanStoredHtml`、`normalizeReaderMedia`）按需同步。

### 影响 / 边界

- 仅影响 `<img>` 子资源请求的 `Referer`，不影响主文档、API 或其它跨域请求的语义。
- `no-referrer` 不携带任何 referer，浏览器对目标站行为等同「无 referer」场景（经 curl 验证为 `200 image/jpeg`）。
- 不引入代理、不下载/缓存远程图片，符合 Issue 实现边界。
- 对本身不校验 referer 的站点（Google、imgur 等）无副作用。

### 验证

- 样例文章重新抓取后 4 张图片在 Reader 中可正常加载。
- 增加离线测试：Cleaner 对含 `<img>` 的输出注入 `referrerpolicy="no-referrer"`，且相对 URL 仍被规范化为绝对 URL。
- 人工在 Windows 11 与原生 Wayland 上冒烟。

---

## 5. 实施状态

已于本分支实现并验证：

- `src/main/feed/fetcher/ContentCleaner.ts`：
  - `normalizeReaderImages()` 对最终保留的 `<img>` 注入 `referrerpolicy="no-referrer"`（除被判定为无效 src/srcset 而被移除的图片外）；
  - `cleanStoredHtml()` 同样注入，保证存量重建内容也具备该属性；
  - `CONTENT_CLEANER_VERSION` 由 6 升至 7，触发旧缓存内容按新 cleaner 重建。
- 新增离线测试 `injects referrerpolicy=no-referrer on reader images...`（覆盖相对 URL 规范化 + 注入）。
- 全量测试 159 文件 / 1247 用例通过；typecheck、lint 通过。
- 用真实 Jeff 文章 HTML 实测：4 张图片全部带 `referrerpolicy="no-referrer"` 且 URL 保持正确绝对 URL。

---

## 6. 供人工审核的开放点

1. 是否应仅对「绝对 URL 且跨站」的图片注入 `referrerpolicy`，还是对全部 `<img>` 一律注入？（本次采用后者的简单、可预期语义，待 Review 确认。）
2. dev 环境 referer 为 `localhost:5173`，被打包后为 `file://` 源，Cloudflare 对 `file://` referer 的行为需在真实打包环境复验。