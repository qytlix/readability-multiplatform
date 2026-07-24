# ECNU 2026 summer 应用编程实践课程作业

## 参考项目

[项目地址](https://github.com/neolee/mercury)

### 基础功能

1. 管理网站订阅、同步
   - 处理的标准的 `RSS Feed` 是一个 `xml` 文件。
   - 导入 `OPML` 作为一个包，可以用于分享。
2. 适合阅读的方式展示
   - 阅读主模式：干净的模式，有样式替换
   - 网站原始样式
   - dual 模式：可以对比（用于验证）

### 更方便的功能

1. AI 功能
   - 生成摘要：语言/长度
   - 翻译
   - 自动tag：可以批量，也可以手动
   - 模型配置
   - 用量数据：消耗了多少的token
2. 已读
3. 笔记
4. 分享
5. 搜索

## 作业要求

1. 4个必须功能
   - 基础功能：Feed/OPML 解析 + Sync + 内容呈现
   - 内容清洗：Cleaned HTML（内容清晰流水线，有现成的库） + Cleaned Markdown（用于交给 AI） + 定制样式（md 的渲染）
   - AI 功能一：Summary Agent + LLM Providers 送出全文，得到 *限定语言* 的摘要
   - AI 功能二：Translation Agent 可以全文翻译，也可以
2. 5个额外功能
   - 辅助功能：多语言支持，日志上报，调试工具
   - 辅助功能：大模型用量统计
   - 笔记和文摘到处：笔记 + 单篇导出 + 多篇导出
   - 标签系统：文章标签 + 按照标签筛选 + Tag Agent + 标签管理
3. 4个必须的技术要求（功能上的）
   - 产品体验：良好的设计规范，优雅的用户体验。自我感觉挑剔的，作为用户看待，以老师的审美为准
   - 本地有限：无需注册登录或者订阅，永远不主动采集用户数据（调用 LLM 没办法哦）
   - 平台中立：Windows/Linux/macOS 工程是跨平台的，验证只要求 Windows（怎么这样），可以用 Electron/Tauri/Qt
   - 大模型中立：支持任何提供标准API的大语言模型服务（本地），建议测试 DeepSeek 和 chatECNU
4. 2个可选的技术要求（关于工程过程的）（加分项）
   - Coding Agent留痕：形成持久化的，有价值的工作过程文档（可以放在 docs/）
   - 团队协同留痕：正确记录提交人和提交历史（发现问题，提出 Issue）

## Advanced Translation

Reader 的高级翻译链路支持自动识别源语言，以及英语、简体中文、香港繁体、
日语、韩语、德语、法语和西班牙语八种目标语言。Provider 可选择 OpenAI、
DeepSeek、OpenRouter、Anthropic、Gemini 或自定义 OpenAI-compatible 服务；
API Key 只在 Main 进程中读取，不会通过 Preload 暴露给页面。

在 **Settings → AI** 中可以：

- 选择源语言、目标语言和 Provider 模型；
- 按需启用智能上下文；超长文章会在固定 48,000 字符预算内对全文做确定性
  代表采样，失败时降级为普通翻译；
- 选择 29 个离线内置专家，或预览并导入受限 YAML 用户专家；
- 逐库启用 34 个离线术语库，或按页面示例导入 UTF-8 CSV 用户术语库；
- 配置划词翻译快捷键，获取单词、短语或句子的结构化结果。

内置专家和术语资源都随应用打包，运行时不会从上游更新。详细契约、缓存与
人工验证步骤见
[`docs/ai/translation-advanced.md`](docs/ai/translation-advanced.md) 和
[`docs/ai/translation-advanced-verification.md`](docs/ai/translation-advanced-verification.md)。

> 使用 issue 赋能（神经词汇来的）讨论

> 使用 github workflows 构建 releases

> 第一次汇报：
  组员分工/分成几步，
  有任何问题可以提出，
  选择什么技术框架可以和 AI 讨论
