# 本地文章搜索优化

> 状态：已实现  
> 索引版本：Migration `019_create_entry_search_index`

## 目标

搜索只使用本地持久化的文章标题和 Cleaned Markdown，并继承用户当前正在
浏览的 Feed、未读或收藏范围。用户位于某个 Feed 时，可以在搜索框下方显式
切换“当前订阅源 / 所有订阅源”。

## 查询语义

- 查询先执行 Unicode NFKC、首尾 trim 和连续空白折叠；
- 空白分隔的多个词默认使用 `AND`；
- 双引号内文本保持为一个短语；
- 用户输入始终被转义为 FTS5 文本，不直接暴露 `AND`、`OR`、`NOT` 等操作符；
- 任一查询词少于 3 个 Unicode 字符时，在当前范围内回退到参数化 `LIKE`；
- 其他查询使用 SQLite FTS5 `trigram` 索引。

不参与匹配的字段包括 Feed 名称、Feed Entry 摘要、作者、URL、AI Summary、
Translation、标注和便签。

## 排序与分页

排序键固定为：

1. `matchTier DESC`：标题完全匹配、标题前缀匹配、标题包含所有词、正文命中；
2. `rank ASC`：FTS5 `bm25(title=8, markdown=1)`；
3. `effectivePublishedAt DESC`：`COALESCE(publishedAt, createdAt)`；
4. `id DESC`。

搜索 cursor 同时保存 `matchTier`、`rank`、有效发布时间和 Entry ID。WHERE
游标条件与 ORDER BY 使用同一组字段，避免跨相关度层级分页时漏结果。

## 索引生命周期

`entry_search_fts` 是 `contentless-delete` FTS5 表，`rowid` 等于 `entry.id`。
Migration 首次创建后回填现有非删除文章。数据库触发器覆盖：

- Entry 插入、标题/Feed/软删除状态更新和硬删除；
- `entry_content` 插入、Markdown 更新和删除；
- Feed 级联删除 Entry。

标题和 Markdown 是真实数据源，FTS 只属于可重建的派生索引。

## Renderer

Main 返回纯文本 `searchSnippet`。Renderer 使用 React 文本节点拆分并渲染
`<mark>`，不接收或拼接命中 HTML。搜索模式只显示正文命中片段；非搜索模式
继续显示 Feed Entry 摘要。

## 验证重点

- 当前 Feed、未读和收藏范围组合；
- Feed 名称和摘要不再产生结果；
- 标题四层排序和 BM25 同层排序；
- 中英文、多词 AND、双引号短语、NFKC 和 1～2 字符回退；
- 搜索专用 keyset pagination；
- 旧库回填、标题/正文更新、软删除和级联删除；
- snippet 以纯文本传输，Renderer 无 HTML 注入。
