# NVM 工作流：启动项目须知

> **项目**：Shale — 本地优先 AI Feed 阅读器  
> **适用平台**：Arch Linux (EndeavourOS) / Wayland  
> **最后更新**：2026-07-15

---

## 1. 每次打开新终端

```bash
cd /path/to/readability-multiplatform
nvm use 24.11.1
```

> 如果已经 `nvm alias default 24.11.1`，且 shell 配置了自动加载 nvm（`~/.bashrc` 中 `source /usr/share/nvm/init-nvm.sh`），大多数情况下切进目录后版本自动生效。不放心就跑一下 `node -v` 确认。

---

## 2. 启动项目

```bash
npm start
```

等价于：

```bash
npx electron-forge start
```

---

## 3. Wayland 兼容

项目已在 `src/main/main.ts` 内置 Wayland 检测：

```ts
if (env.XDG_SESSION_TYPE === 'wayland' || env.WAYLAND_DISPLAY) {
  env.ELECTRON_OZONE_PLATFORM_HINT = 'wayland';
  app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform');
  app.commandLine.appendSwitch('ozone-platform', 'wayland');
  app.commandLine.appendSwitch('in-process-gpu');
}
```

**通常直接 `npm start` 即可**——代码会自动判断并配置。如果遇到 GPU 崩溃，手动加环境变量启动一次试试：

```bash
ELECTRON_OZONE_PLATFORM_HINT=wayland npm start
```

---

## 4. 常见问题

### 4.1 `EALLOWGIT` 错误

```
npm error code EALLOWGIT
npm error Fetching packages of type "git" have been disabled
```

**原因**：npm 12+ 默认禁止 git 依赖。  
**解决**：切到 nvm 管理的 Node（npm 11 不拦截）：

```bash
nvm use 24.11.1
npm install
```

### 4.2 `electron` 二进制未下载

```
Error: Electron failed to install correctly. Please delete `node_modules/electron` and run "npx install-electron --no" manually.
```

**解决**：

```bash
rm -rf node_modules/electron
npm install electron
```

### 4.3 端口被占用

```
Port 5173 is in use, trying another one...
```

自动切换端口，不影响使用。

### 4.4 全局包冲突

如果 `.npmrc` 含有 `prefix=~/.local`，nvm 切换时会报：

```
Your user's .npmrc file has a `prefix` setting, which are incompatible with nvm.
```

**解决**：注释或删除 `~/.npmrc` 中的 `prefix` 行，然后用 nvm 重新安装需要的全局包：

```bash
npm install -g @anthropic-ai/claude-code
```

### 4.5 `better-sqlite3` 原生模块版本不匹配（高频）

`better-sqlite3` 是 C++ 原生模块，编译产物与运行时 Node.js 版本强绑定。
本项目中存在两个不同的 Node.js 运行时：

| 运行时 | 版本 | NODE_MODULE_VERSION |
|--------|------|---------------------|
| 本地 nvm Node.js | 24.11.1 | **137** |
| Electron 43 内置 Node | 对应 Node 22 分支 | **148** |

`npm test`（vitest）使用本地 Node.js，`npm start` 使用 Electron 内置 Node。
同一份 `better-sqlite3` 编译产物无法同时兼容两者。

#### 错误表现

```
Error: The module 'better-sqlite3.node' was compiled against a different
Node.js version using NODE_MODULE_VERSION 148. This version of Node.js
requires NODE_MODULE_VERSION 137.
```

#### 完整工作流

**已自动化**：`package.json` 中配置了 `pretest` 脚本，`npm test` 会自动在测试前 rebuild 到本地 Node 版本。

```bash
npm test     # pretest 自动 npm rebuild better-sqlite3 → vitest
npm start    # @electron/rebuild 自动检测并 rebuild → Electron 启动
```

不再需要手动记 rebuild 命令。

#### 规则总结（已过时但保留作参考）

```
        首次 npm ci
            │
            ▼
     ┌──────────────┐
     │ 本地 Node 137 │ ← npm test 可用（pretest 自动 rebuild）
     └──────┬───────┘
            │
    ┌───────┴────────┐
    │                │
 npm start       npm test
 (自动rebuild)   (pretest 自动rebuild)
    │                │
    ▼                ▼
 ┌──────────────┐ ┌──────────────┐
 │ Electron 148 │ │ 本地 Node 137│
 └──────────────┘ └──────────────┘
```

`npm start` 和 `npm test` 现在各自自动处理 rebuild，无需手动切换。

### 4.6 首次 `npm start` 无窗口、终端卡住

首次启动时 `electron-forge` 会用 `@electron/rebuild` 重编译 `better-sqlite3` 的 C 源码，CPU 占用高、无输出，看起来像卡死。

**判断**：`ps aux | grep cc1` 如果能看到 gcc 进程，说明正在编译，等待即可。编译完 Electron 窗口会自动出现。

第二次启动不再需要编译，秒开。

### 4.7 Vitest 测试中 `global.fetch` mock 类型不匹配

```
Type 'Mock<...>' is not assignable to type '{ (input: URL | RequestInfo, ...): Promise<Response> }'
```

**原因**：`vi.fn()` 的返回类型与 `typeof global.fetch` 不兼容。

**解决**：用辅助函数绕开类型检查：

```ts
function setMockFetch(fn: (...args: any[]) => any): void {
  (globalThis as any).fetch = fn;
}
```

或用 `vi.stubGlobal('fetch', mock)`（vitest 4.x）。

### 4.8 DOMPurify + JSDOM 类型不兼容

```
Type 'Window' is not assignable to parameter of type 'WindowLike'.
```

**原因**：`dompurify` 的 TypeScript 类型期望浏览器 `Window`，而 JSDOM 的 window 对象缺少部分 DOM API 类型。

**解决**：在 `ContentCleaner.ts` 中强转：

```ts
const purify = createDOMPurify(dom.window as any);
```

运行时完全正常，仅类型定义差异。

### 4.9 ContentFetcher 测试中 `reader.cancel is not a function`

```
TypeError: reader.cancel is not a function
```

**原因**：`ContentFetcher` 中 `reader.cancel()` 是 `ReadableStreamDefaultReader` 的标准方法，mock 对象缺少该方法。

**解决**：mock 返回的 reader 必须包含 `cancel`：

```ts
const reader = {
  read: vi.fn().mockResolvedValue({ done: false, value: data }),
  cancel: vi.fn().mockResolvedValue(undefined),
};
```

### 4.10 Readability 只从 `<title>` 提取标题，不从 `<h1>` 提取

在测试中用 `<h1>` 作为标题断言会失败：

```html
<!-- ❌ Readability 不会把 h1 当标题 -->
<html><body><article><h1>My Title</h1></article></body></html>

<!-- ✅ 必须用 <title> -->
<html><head><title>My Title</title></head><body><article>...</article></body></html>
```

**原因**：`@mozilla/readability` 的标题提取逻辑优先读取 `<title>` 标签、og:title 等 meta，不依赖 `<h1>`。

### 4.11 数据库数据重启后丢失

添加的 Feed 重启后消失。

**原因**：`main.ts` 调用 `initializeServices()` 未传路径，`DatabaseManager` 默认 `:memory:`：

```ts
constructor(dbPath?: string) {
  this.db = new Database(dbPath ?? ':memory:'); // ← 每次启动新库
}
```

**解决**：传入 Electron 标准用户数据目录：

```ts
const dbPath = path.join(app.getPath('userData'), 'shale.db');
initializeServices(dbPath);
```

**已修复**（commit `6983f28`）。

### 4.12 测试导入路径缺少 `src/` 前缀

```
Cannot find module '../../shared/contracts/feed.types'
```

**原因**：测试文件在 `tests/integration/` 目录，`../../shared/` 到达项目根而不是 `src/`。

**解决**：测试中的导入路径需带 `src/`：

```ts
// ❌
import type { ParsedFeed } from '../../shared/contracts/feed.types';
// ✅
import type { ParsedFeed } from '../../src/shared/contracts/feed.types';
```

---

## 5. 实用命令速查

| 目的 | 命令 |
|---|---|
| 查看当前 Node 版本 | `node -v` |
| 查看当前 npm 版本 | `npm -v` |
| 切换项目 Node 版本 | `nvm use 24.11.1` |
| 查看已安装的 Node 版本 | `nvm ls` |
| 安装依赖（锁文件优先） | `npm ci` |
| 更新依赖 + 锁文件 | `npm install` |
| 测试前重编译原生模块 | `npm rebuild better-sqlite3`（`pretest` 已自动执行，通常无需手动） |
| TypeScript 类型检查 | `npm run typecheck` |
| 运行测试 | `npm test` |
| 启动开发模式 | `npm start` |

---

## 6. 推荐 alias（可选）

在 `~/.bashrc` 或 `~/.zshrc` 中添加：

```bash
alias shale="cd ~/Documents/github/readability-multiplatform && nvm use 24.11.1 --silent && npm start"
```

然后终端只需执行 `shale` 即可一键启动。