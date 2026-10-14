# 开源资源与实现说明

2026-10-02 在 GitHub 查阅并筛选以下仓库。此项目的扩展组件和动效为按现有 JSON 渲染契约独立编写的适配实现，未安装或复制这些仓库的整套组件代码。参考的是组件种类、语义和交互模式，不能视为原库的完整功能或无障碍认证。

| 资源 | 许可 | 本项目中的参考用途 |
| --- | --- | --- |
| [shadcn/ui](https://github.com/shadcn-ui/ui) | [MIT](https://github.com/shadcn-ui/ui/blob/main/LICENSE.md) | 提示横幅、搜索、骨架屏、列表、面包屑及方案/评价组合的组件分类 |
| [Radix Primitives](https://github.com/radix-ui/primitives) | [MIT](https://github.com/radix-ui/primitives/blob/main/LICENSE) | 折叠面板、滑块、单选组、分段选择的语义与交互模式 |
| [Animate.css](https://github.com/animate-css/animate.css) | [MIT](https://github.com/animate-css/animate.css/blob/main/LICENSE) | 淡入、位移、缩放、弹跳、翻转与减少动态效果的预设组织方式 |

组件元数据在 `shared/catalog.ts`，默认内容在 `shared/model.ts`；组件行为在 `src/ExtendedNode.tsx`。新增组件使用原生 HTML 控件和 React 本地状态。选项和条目用 `|`、逗号或换行分隔，均按普通文本渲染。动作仍使用现有本地模拟机制。

动效在 `shared/motion.ts` 和 `src/motion.css`，包含 16 种效果和「无动效」选项。位置采用相对原布局的 X/Y 偏移；与动效的 transform 分开。所有运行时文件和此说明都会随源码导出，运行时不需要 CDN。
