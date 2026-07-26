# EXP-06：导出文件界面打磨（Issue #77）

> 对应 Issue #77
> 预估：0.5~1d
> 依赖：EXP-05（多篇导出 UI 可用）

---

## 目标

修复导出选项对话框中的三个视觉/交互问题和一处 Bug，使导出界面更简洁、语义更清晰、交互更健壮。

---

## 影响文件

| 文件 | 改动 |
|------|------|
| `src/renderer/features/feeds/ExportOptionsDialog.tsx` | 四项改动全部在这里 |
| `src/renderer/features/reader/ReaderPage.css` | 新增/修改状态指示器和工具提示样式 |

---

## 改动详情

### 1. 去掉不符合风格的 emoji

| 位置 | 当前 | 改为 |
|------|------|------|
| 对话框标题 | `📄 导出文件` | `导出文件` |
| 文章行状态图标 | `✅` / `❌` / `⏳` (pending/cleaning 都用 `⏳`) | CSS 纯色圆点: 绿色(成功) / 红色(失败) / 灰色(等待) + 旋转动画(清洗中) |
| 未清洗标签 | `🧹未清洗` | `未获取`（见第 2 项） |
| 全部清洗按钮 | `🧹 清洗全部未清洗（N篇）` | `获取全部（N篇）`（见第 2 项） |
| 列级全选按钮 | `☑` / `☐` | 使用 CSS 自定义 checkbox 风格的勾选/未勾选图标 |

**设计思路**：项目其他部分（主题切换、菜单按钮等）统一使用 SVG 图标和无 emoji 文字。状态指示改用 CSS 纯色圆点，与文章阅读状态的绿色/灰色点风格一致。

---

### 2. "清洗" → "获取" + 工具提示浮窗

| 位置 | 当前 | 改为 |
|------|------|------|
| 未获取标签 | `🧹未清洗` | `未获取` |
| 单篇获取按钮 | `现在清洗` | `现在获取`，加 `title="重新获取并清洗文章内容"` |
| 获取中标签 | `清洗中…` | `获取中…` |
| 全部获取按钮 | `清洗全部未清洗（N篇）` | `获取全部（N篇）` |
| 获取失败标签 | `清洗失败` | `获取失败` |
| 获取全部按钮 hover | 无 | 加 `title` 属性说明 |

**语义说明**："获取"比"清洗"更能向用户传达"正在从网络获取并处理文章"的完整含义，而"清洗"是内部术语。

---

### 3. 多选模式：无内容时禁用列级全选按钮

- 计算每类内容的全局可用性：`articles.some(a => a.hasSummary)` / `hasTranslation` / `hasNotes`
- 当没有任何文章包含"总结"时，"总结"列级全选按钮 `disabled`
- 同理 for "翻译"、"笔记"
- 禁用时 hover 显示工具提示浮窗：`"没有文章包含总结"` / `"没有文章包含翻译"` / `"没有文章包含笔记"`
- 使用现有 `article-action-tooltip` CSS 类名模式

---

### 4. [Bug] 有未就绪文章时点击"下一步"直接返回主界面

**根因分析**：
1. `perArticleOptions` Map 在初始化时包含了**所有**文章（包括未清洗的）
2. 未清洗文章没有渲染 checkbox，但它们的选项仍存在于 Map 中
3. 点击"下一步" → `onConfirm(perArticleOptions)` → `exportMultipleEntries` 传入全部文章
4. 未清洗文章在 Service 层找不到内容 → 抛出 `EXPORT_CONTENT_NOT_FOUND`
5. 对话框关闭 → 用户看到主界面（selectionMode 仍开启）

**修复方案**：

在"下一步"按钮的 `onClick` 中过滤 `perArticleOptions`，只保留清洗成功的文章：

```typescript
onClick={() => {
  const readyOptions = new Map(
    Array.from(perArticleOptions.entries()).filter(([entryId]) => {
      const article = articles.find(a => a.entryId === entryId);
      return article && getEffectiveStatus(article.entryId) === 'success';
    })
  );
  if (readyOptions.size > 0) {
    onConfirm(readyOptions);
  }
  // 若全部未就绪，不关闭对话框（保持当前界面）
}}
```

同时，如果没有任何文章就绪，"下一步"按钮应 disabled。

---

## 验证步骤

```bash
# 编译检查
npx tsc --noEmit --pretty

# 人工验证：
# 1. 单篇导出：打开文章 → 导出 → 确认无 emoji，"获取"语义正确，hover 显示工具提示
# 2. 多选导出：选择 2-3 篇（含已/未清洗）→ 弹出对话框 → 确认无 emoji
# 3. 列级按钮：当所有文章都没有总结/翻译/笔记时，对应按钮 disabled + 工具提示
# 4. Bug 修复：部分未清洗 → 点击下一步 → 只导出已清洗文章，不返回主界面
# 5. 边界：全部未清洗 → "下一步"按钮 disabled
# 6. 边界：全部已清洗 → 正常导出
```
