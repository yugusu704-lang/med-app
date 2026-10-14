# Android Neo-Brutalism 设计交付

这是用户已确认的 Atelier 设计项目导出包，包含 14 个页面、277 个节点。正式业务代码不在此目录中；这里的交互用于复审 UI。

## 打开预览

`preview-mobile-ui.html` 是约 1.5 MB 的单文件预览，内联 React runtime、导出 CSS 和 Inter 字体，无 CDN 依赖。手机屏幕的逻辑尺寸为 390 × 844，其中状态栏 28 px、应用视口 798 px、底部手势区 18 px。较矮桌面窗口会缩小手机框以完整展示，不改变内部布局尺寸。

可直接在本机浏览器打开该 HTML。若浏览器限制本地文件访问，可在此目录运行：

```powershell
node .\serve-preview.mjs
```

然后访问 http://127.0.0.1:5184/ 。服务仅监听 127.0.0.1，仅提供该预览 HTML。

## 文件

- `atelier-project.json`：可编辑的 Atelier 项目源数据。
- `atelier-source.zip`：原始导出源码包。
- `portable/`：已解压源码与构建产物；补充了 TS6 CSS 模块声明。
- `generate-project.mjs`：设计项目生成脚本。
- `package-preview.mjs`：把 portable/dist 打包为单文件预览；不改 Atelier 的页面布局。
- `sample-data.json`：设计示例数据。
- `preview-home.jpg`、`preview-config.jpg`、`preview-question.jpg`、`preview-explanation.jpg`、`preview-search.jpg`：浏览器验收截图。

重新打包：先构建 portable，再运行 `node .\package-preview.mjs`。

## 已核验

2026-10-12，Codex IAB 通过 localhost HTTP 预览实际走查：

1. 首页完整显示 Neo-Brutalism 风格、统计卡片、三个入口与底部导航。
2. 浏览科目进入科目地图，章节入口进入练习设置。
3. 随机出题开关可以由开变为关（可访问性状态从 1 变为 0）。
4. 练习设置进入单选题；选择 A 并提交后进入正确答案解析页。
5. 搜索输入可编辑，提交后进入示例搜索结果页。
6. 状态栏、穿孔镜头、底部安全区和整个手机框均已在截图中确认。

此前 portable 已通过 TS6 `tsc --noEmit` 和 Vite 8 构建；本次仅打包该导出 runtime。IAB 的安全策略不允许导航 file://，因此本机文件直开路径没有通过 IAB 实测；HTTP 同源预览已通过。离线资源内联由打包脚本保证，页面内部 CSP 禁止连接业务接口。

## 原型与业务的边界

数字、题目与答案是示例。搜索结果是预置页面，选择科目不会从数据库加载章节；开关状态属于当前页面交互；提交答案是预置页面跳转。“已保存”等提示是 Atelier 原型动作，不代表业务接口或持久化已连接。正式应用需接入已有题库查询、实际答案判定和学习记录存储。
