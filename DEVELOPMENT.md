# Local Development

## Environment

- Node.js 24.x LTS（推荐 24.11.1）
- npm
- 只使用并提交 `package-lock.json`

检查环境：

```bash
node -v
npm -v
```

## Install

```bash
npm ci
```

安装完成后会自动将 `better-sqlite3` 重建为当前 Electron 版本的 ABI，并用
Electron 实际加载 SQLite 进行验证。不要用裸的 `npm rebuild better-sqlite3`
作为启动前修复：它会改回系统 Node.js 的 ABI。

如果 npm 官方源访问较慢：

```bash
npm ci --registry=https://registry.npmmirror.com
```

## Verify

每次提交前至少运行：

```bash
npm run typecheck
npm run lint
npm test
```

## Start

```bash
npm start
```

`npm start`（以及 Forge 的 package/make）会按 Electron ABI 检查
`better-sqlite3`；只有检测到 ABI 不匹配时才重建。因此在更新依赖、切换 Electron
版本或运行测试后都可以直接启动，而正常启动不需要重复编译。
如果曾使用 `--ignore-scripts` 安装依赖，先运行：

```bash
npm run rebuild:native
npm run verify:native
```

预期：

- Electron 窗口正常打开；
- 显示 `Shale` 和 `React renderer ready`；
- 点击 `Test IPC` 后显示 `IPC OK: pong`。

在 Renderer DevTools 的页面主上下文中执行：

```js
typeof require
// "undefined"

await window.shaleAPI.system.ping()
// { ok: true, message: "pong" }
```

使用 `Command + Q` 或对应平台的退出方式完全关闭应用。

## Package

```bash
npm run package
```

如果 Electron 资源从 GitHub 下载超时：

macOS / Linux：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run package
```

Windows PowerShell：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm run package
Remove-Item Env:ELECTRON_MIRROR
```

产物位于 `out/`。Forge 默认只打包当前操作系统和架构；不要提交 `out/`。

## Before Commit

```bash
git diff --check
git status --short
```

确认：

- 只包含当前任务相关文件；
- `node_modules/`、`.vite/`、`out/` 没有进入 Git；
- 不要提交 API Key、Token、用户数据库或其他敏感数据。

功能特有的测试步骤、实际结果和未验证平台，应记录在对应 Issue 或 PR 中。
