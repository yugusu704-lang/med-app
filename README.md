# QuizRx 医学题库

React + Tauri 2 + Rust 离线医学刷题 App，Android ARM64 debug APK 见 [Releases](https://github.com/yugusu704-lang/med-app/releases)。

## 本次更新

- 首页新增「大纲精练 / 课程强化」。
- 局部解剖学 9 个模块共 270 题，每章 21 道 A1、9 道 A2，五选项及逐项解析。
- `source = OBE大纲` 独立筛选科目、章节和练习；默认统考试题筛选排除该来源。
- 原有 51,281 题完整保留，合并后 51,551 题，Schema v1、content_hash、FTS5 索引一致。
- 根据大纲说明，盆部与会阴、脊柱区含自学拓展；绪论作为教材导论补充。

题库 JSON 位于 `data/obe/局部解剖学/`。教材 PDF 与个人笔记未纳入仓库。隔离通过数据库来源字段和查询过滤实现。

## 安装

下载新版 Release 的 `QuizRx-OBE-arm64-debug.apk`，在手机允许从文件应用安装 APK，或运行：

```powershell
adb install -r QuizRx-OBE-arm64-debug.apk
```

需要 Android 7.0+ ARM64。debug 包适用于测试验收；本次没有连接手机执行实机安装验证。

## 构建

安装 Node.js、pnpm、Rust、Android Studio/SDK/NDK，并为 Rust 添加 `aarch64-linux-android`。
新版 APK 是 ZIP 格式：从其 `assets/quizbank.db` 提取内置数据库放到仓库根目录，并复制到 `quizrx/src-tauri/gen/android/app/src/main/assets/quizbank.db`。
进入 `quizrx`，运行 `pnpm install` 和 `scripts/build-android.ps1`。工具链位置可通过该脚本参数指定，详情见 `quizrx/README.md`。

## 增量导入与检查

```powershell
python -m processor.json_to_sqlite --db quizbank.db --input-dir data/obe/局部解剖学 --incremental --source OBE大纲
# 核对演练结果后加 --apply 执行；重复题按 content_hash 跳过。
python -m unittest discover -s tests -v
cd quizrx
pnpm build
node scripts/test-android-back.mjs
.\scripts\test-windows-gnu.ps1 -TestFilter tests
```

增量发布生成原库备份和记录，默认演练不修改主库。新题结构、五选项、章节数量、来源及旧库保留校验记录位于 `validation/`。

