# 医学题库 · QuizRx

React + Tauri + Rust 的离线题库，桌面与 Android 共用题库查询、判分和学习记录。

Windows GNU 构建、启动脚本，以及“启动正常但无窗口”的已验证原因见 [Windows 启动排查](docs/windows-startup.md)。

Android 工具链、APK 构建和设备验收见 [Android 离线应用](docs/android.md)。已确认的新野兽设计及可携带预览见 [手机 UI](design/mobile-neo/README.md)。

题库 `quizbank.db` 保持只读；会话、未提交答案、错题和收藏写入独立的 `user.sqlite`。Windows GNU 回归可运行 `scripts/test-windows-gnu.ps1`。

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
