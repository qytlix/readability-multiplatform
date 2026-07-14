# Readability 正文提取原型验证

> 验证日期：2026-07-14
> 状态：可行性确认
> 对应：M0-FEED-02

---

## 1. 验证结论

**`@mozilla/readability` + `jsdom` 在本项目 main 进程中完全可用**，能够对代表性网页输出结构化 Cleaned HTML。推荐在 M1 中基于此方案实现完整的 ContentCleaner 和 ContentService。

---

## 2. 测试覆盖

| 文章类型 | 文件 | 核心验证点 |
|---|---|---|
| 普通文章 | `simple-article.html` | 标题提取、正文内容、排除导航/评论/脚本 |
| 含表格/代码/图片 | `complex-article.html` | 保留表格、代码块、blockquote、图片、列表 |
| 中文文章 | `chinese-article.html` | 中文标题、中文正文、中文代码注释 |
| sanitize 验证 | inline | 移除 `<script>`、事件属性、`javascript:` URL |

### 测试结果

- **32 / 32 测试通过**
- 三种代表性文章全部成功提取标题、正文和结构化 HTML
- Readability 自动排除 `<nav>`、`<footer>`、`<script>` 等无关内容
- 表格 (`<table>`)、代码片段 (`<pre><code>`)、图片 (`<figure><img>`)、引用 (`<blockquote>`)、列表 (`<ul>/<ol>`) 均正确保留
- 中文文本（UTF-8 + 中文标点 + 代码注释）无乱码

---

## 3. 技术方案

### 核心流程

```typescript
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

function extract(html: string, url: string) {
  const doc = new JSDOM(html, { url });
  const reader = new Readability(doc.window.document);
  return reader.parse();
}
```

### `parse()` 返回值

```typescript
interface ParseResult {
  title: string;        // 取自 <title> 标签
  byline: string | null;// 取自 meta[author]
  dir: string | null;   // 文本方向
  content: string;      // 清洗后 HTML（不含 script/nav/footer 等）
  textContent: string;  // 纯文本版本
  length: number;       // 字符数
  excerpt: string;      // 自动截取的前言
  siteName: string | null;
}
```

### Sanitize 方案

Readability 输出本身已移除 `<script>` 等不安全元素。进一步 sanitize 的附加措施：

| 措施 | 实现方式 |
|---|---|
| 移除 `<script>` 标签 | DOMPurify 或正则 |
| 移除事件处理属性 | `onclick`, `onerror` 等正则清理 |
| 清理 `javascript:` URL | 替换为 `#` |
| 规范化 HTML | DOMPurify.sanitize() |

---

## 4. 已知边界与注意事项

| 场景 | 行为 | 建议 |
|---|---|---|
| 文章过短（< 100 字符） | Readability 可能返回 `null` | 回退原文显示 |
| 页面无 `<title>` | 返回空字符串 | 使用 URL 或 Feed 标题 |
| meta[author] 缺失 | `byline` 为 `null` | 可接受 |
| 页面含大量广告/侧栏 | 自动排除 | 部分页面可能过度裁剪 |
| 密码保护页面 | 正文不可见 | 回退原文 |
| 非 HTML 响应 | JSDOM 容错解析但结果差 | 检查 Content-Type 前过滤 |

### 失败回退策略

当 Readability 提取失败或效果不可接受时：

1. 返回 `entry.url` 让用户通过 Web 阅读（P0 必须支持）
2. 直接展示 Feed 提供的 `contentHtml` / `summary`（如有）

---

## 5. 依赖与版本

| 库 | 版本 | 类型 | 备注 |
|---|---|---|---|
| `@mozilla/readability` | latest | CJS | main 进程直接 require |
| `jsdom` | latest | CJS | Readability 依赖的 DOM 环境 |
| `turndown` | latest | CJS | M1 前验证，用于 HTML → Markdown |

**已验证**：CJS 导出可用，main 进程（Vite/Electron）可正常加载。

---

## 6. 下一步（M1）

- [ ] 实现 `ContentCleaner` 封装 Readability + sanitize
- [ ] 实现 `MarkdownConverter` 封装 turndown
- [ ] 实现 `ContentService.fetchAndClean()`
- [ ] 集成 `ContentFetcher`（网络获取）
- [ ] 所有清洗状态通过 `pipelineStatus` 跟踪