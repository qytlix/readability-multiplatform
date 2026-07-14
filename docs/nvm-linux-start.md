# NVM 工作流：启动项目须知

> **项目**：Shale — 本地优先 AI Feed 阅读器  
> **适用平台**：Arch Linux (EndeavourOS) / Wayland  
> **最后更新**：2026-07-14

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
| TypeScript 类型检查 | `npm run typecheck` |
| 启动开发模式 | `npm start` |

---

## 6. 推荐 alias（可选）

在 `~/.bashrc` 或 `~/.zshrc` 中添加：

```bash
alias shale="cd ~/Documents/github/readability-multiplatform && nvm use 24.11.1 --silent && npm start"
```

然后终端只需执行 `shale` 即可一键启动。