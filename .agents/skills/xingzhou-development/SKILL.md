---
name: xingzhou-development
description: Develop, debug, review, test, deploy, or release the Xingzhou SiYuan plugin in this repository. Use for changes to its Svelte UI, work-item planning, daily rhythm, checklist, nutrition, persistence, SiYuan integration, or packaging; do not use for unrelated SiYuan plugins or general product-planning discussion.
---

# 行舟插件开发

在不破坏用户数据和现有行为的前提下，沿着行舟真实的调用链定位问题，完成最小范围修改，并用与风险相称的测试验证结果。

## 开始工作

1. 完整遵循仓库根目录 `AGENTS.md`；它是权限、安全、Git、测试、部署和发布规则的权威来源。
2. 检查工作区状态，识别并保留已有修改。
3. 从用户描述的实际操作路径出发，用 `rg` 定位入口、领域逻辑、持久化路径和已有测试。
4. 在修改前说明根因或当前判断、准备采用的方案及影响范围。证据不足时继续检查，不把猜测写成结论。

## 选择修改边界

- 展示或交互问题：先定位对应 Svelte 组件，再确认其依赖的领域函数和状态所有者；不要用界面补丁掩盖领域逻辑错误。
- 业务规则问题：优先修改可独立测试的 TypeScript 领域模块，让组件只负责调用和呈现。
- 保存、迁移、恢复或思源 API 问题：先阅读 [references/architecture-and-data.md](references/architecture-and-data.md)，再检查相关实现和测试。
- Svelte 交互、布局、日期或排期问题：先阅读 [references/testing-and-ui.md](references/testing-and-ui.md)。
- 发布或推送任务：以 `AGENTS.md` 和当前 `.github/workflows/` 为准；不得把普通开发任务自行扩大成发布。

## 实施方法

1. 先建立一条可验证的因果链：用户动作 → 组件事件 → 领域转换 → 保存/API → 重新加载后的状态。
2. 找到拥有该规则的最小模块，只修改该模块及必要的调用方和测试，避免重复实现同一规则。
3. 优先复用现有解析、规范化、克隆、排序、日期和保存函数；新增状态时同时检查默认值、旧数据解析、清除分支和序列化结果。
4. 对条件字段同时验证“选择是时保留/要求内容”和“改成否或不适用时清除旧内容”，避免隐藏字段残留数据。
5. 对跨组件共享状态确认唯一所有者和回传路径，特别检查模块切换、重新打开、自动保存和异步响应覆盖。
6. 对持久化修改保持修订号、串行写入、轮换备份、写后复核和损坏停止写入等不变量。
7. 对思源写操作先读取并定位精确目标，写入后重新读取复核；不得使用 Markdown 导出结果覆盖原文档。

## 验证与交付

1. 先运行最接近修改点的测试，并增加能够在修改前失败、修改后通过的回归用例。
2. 根据 `AGENTS.md` 的风险分级继续运行检查、完整测试和构建；不要用无关的大范围测试代替针对性测试。
3. UI 修改除自动化测试外，说明需要用户在思源中验证的实际路径；涉及布局时覆盖宽屏与窄屏、滚动、焦点和弹窗关闭。
4. 只有满足仓库规则时才执行本机部署；部署后使用既有脚本的校验结果，不手工修改安装目录里的生成文件。
5. 完成汇报包含根因、修改、影响范围、测试数量、检查警告、构建、部署和 Git 状态；明确列出未执行或无法执行的验证。
