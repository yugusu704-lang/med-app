# Android 离线应用

手机端优先支持 Android ARM64，沿用 React + Tauri + Rust。首页、科目地图、练习设置、答题、解析与搜索采用已确认的 Neo-Brutalism 设计。题库查询和答案判定在设备内完成，无需云端服务或账户。

## 数据与首次启动

应用包含 schema v1 的 `quizbank.db`，题库以只读方式打开，不把练习状态写入题库。Android 的 APK 资源不可直接作为普通 SQLite 文件打开，首次启动通过本应用的 Kotlin `BankPlugin` 以资产流复制到私有目录，再由 Rust 校验 SHA-256、长度及 schema 版本并原子重命名。复制在后台线程执行，启动页显示准备状态并支持失败重试。题库按内容哈希命名，更新不会覆盖学习数据库。该步骤约需额外 86 MB 文件空间，首次启动时间取决于设备存储速度。

学习状态使用独立的 `user.sqlite`：收藏、作答记录及练习历史与题库资源分离。每次作答由 Rust 校验题目和提交的答案，前端展示返回结果。当前方案不包含云同步、远程题库下载或账号体系。清除应用数据或卸载会删除私有数据；后续备份功能需单独实现。

## 工具链

本机安装路径：

- JDK：`C:\Program Files\Android\Android Studio\jbr`
- Android SDK：`%LOCALAPPDATA%\Android\Sdk`
- NDK：`28.2.13676358`
- Rust：`D:\rust`，宿主 `stable-x86_64-pc-windows-gnu`，移动目标 `aarch64-linux-android`
- 宿主 GNU 编译器：`D:\mingw64\bin`

Android SQLite C 代码使用 NDK clang，不能继承桌面构建的全局 `CC=gcc`。宿主 Rust build scripts 仍使用 GNU 工具链。构建脚本分别设置宿主与 ARM64 编译器，并在退出时还原进程环境变量。

Android 的 `CARGO_TARGET_DIR` 默认放在 `%LOCALAPPDATA%\QuizRxBuild\android-target`（可用 `-BuildDirectory` 指定），使宿主构建脚本继承普通用户的 Medium 完整性。若放在带 Low 标签的工作区，插件构建脚本不能向 Cargo 用户缓存复制 `.tauri` 项目，实际会报 `拒绝访问 (os error 5)`；更换构建目录后 ARM64 Rust 编译已通过。临时目录仍放在工作区。

初始化模板的 Gradle `BuildTask.kt` 已修正 Node 参数：显式调用项目内 `node_modules/@tauri-apps/cli/tauri.js`，避免将 `tauri` 当作不存在的 Node 脚本路径。

移动端必须保留 Cargo 的 `cdylib` crate-type，桌面 GNU 的临时 `rlib` 变通不能用于 Android。初始化生成的 Android Gradle 项目由 `pnpm tauri android init` 创建。

## 构建 APK

在 `quizrx` 目录运行：

```powershell
# 只检查工具链、ARM64目标和设备状态，不构建
.\scripts\build-android.ps1 -CheckOnly

# 默认ARM64 debug APK，内嵌前端，不依赖 Vite 开发服务器
.\scripts\build-android.ps1

# ARM64 release APK
.\scripts\build-android.ps1 -Release
```

脚本调用 `pnpm tauri android build --target aarch64 --apk --ci`，debug 默认增加 `--debug`。前端构建由 Tauri 配置的 `beforeBuildCommand` 执行。输出 APK 位于 `src-tauri\gen\android\app\build\outputs\apk`，脚本打印实际文件路径，不自动安装。

`TMP/TEMP` 和 JVM 临时目录均放在 `.runtime\tmp`，Gradle 默认复用 `%USERPROFILE%\.gradle` 中的现有缓存，可用 `-GradleUserHome` 指定缓存目录。首次构建可能需要联网下载 Gradle 与 Android 依赖。可通过脚本参数 `-JavaHome`、`-AndroidSdk`、`-NdkVersion`、`-RustRoot`、`-MingwRoot` 指定已安装工具链；`-ApiLevel` 默认 24。

release 发行还需配置签名密钥。构建成功不代表签名、安装或应用运行已通过验收；不要把未签名 release APK 直接当作可发行安装包。

## 设备检查与安装

APK 构建不要求连接手机。设备安装前，在用户正常 PowerShell 中运行：

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices -l
# 手机已开启USB调试，并在手机上授权此电脑后：
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r '<脚本打印的debug APK绝对路径>'
```

Codex 沙箱中的 adb 曾因无法创建 `.android` 目录而失败。相同工具在 `require_escalated` 的用户进程中可正常列出设备（当时没有连接设备）；这是执行权限限制，不表示 SDK 或 adb 缺失。脚本将设备检查失败显示为警告，不阻断无需设备的 APK 构建。在 Codex 中执行完整构建时使用经过授权的 `require_escalated` 调用，以允许 SDK、Gradle 和设备工具写入用户目录。

## 验证状态与待验收

2026-10-12，ARM64 debug APK 已真实构建成功（连续两次），位于 `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`。SDK 工具核验显示包名 `com.wjx.quizrx`、应用名“医学题库”、最低 API 24、目标 API 36、仅包含 `arm64-v8a`；APK v2 签名验证通过。内嵌 `assets/quizbank.db` 长度 90,263,552 字节，SHA-256 与仓库原始题库一致。

正式前端通过 TS6 类型检查与 Vite 构建；6 组真实 Rust/SQLite 回归通过，覆盖各题型、A3 子题、重启恢复、提交幂等、收藏分页、题库内容变更与异常版本。Windows GNU 测试 EXE 需要 Common Controls v6 清单；`scripts/test-windows-gnu.ps1` 修复生成的测试产物后运行测试。

四项底部导航已在正式前端改为固定位置，每项至少 52px 高，预留内容空间和手势安全区；设计项目与 portable 预览已同步调整。浏览器视觉验收使用明确标注的真实题库只读 fixture，模拟会话不作为 Rust 持久化证据。设计原型见 `design/mobile-neo/README.md`。

没有连接 Android 手机或可用模拟器，因此尚未完成安装与设备运行验收。当前交付是 debug 开发安装包，发行签名和 release APK 尚未配置。

必须在 ARM64 Android 设备上继续核验：首次复制题库成功、首页真实统计、题目搜索、单选/多选/案例判定、学习状态重启后保留、离线运行、长题干滚动、系统返回键和手势安全区。真实 APK 构建及设备验收结果应补充到本节。

