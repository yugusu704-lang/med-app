# Windows GNU 启动与无窗口排查

本项目在 Windows GNU 工具链下可以显示窗口。2026-10-11 在当前 Codex 环境中确认，原来的“后端启动成功但无窗口”由 **EXE 的 Low 完整性标签与 WebView2 数据目录的 Medium 完整性不匹配**引起；普通文件写入测试不能排除这一点。

## 已验证的证据

1. `icacls D:\repo` 显示可继承的 `Mandatory Label\Low Mandatory Level`；构建的 `target\debug\quizrx.exe` 继承同一标签。
2. 即便从默认桌面、普通用户的 Medium PowerShell 启动，EXE 的进程令牌仍是 Low（`TokenIntegrityLevel` RID `0x1000`）。Windows 按用户与可执行文件完整性级别的较低值创建进程，详见 [Microsoft MIC 文档](https://learn.microsoft.com/en-us/windows/win32/secauthz/mandatory-integrity-control)。
3. 默认 `%LOCALAPPDATA%\com.wjx.quizrx\EBWebView` 没有 Low 标签，按 Windows 规则视为 Medium。Low 进程不能向 Medium 对象写入，即使 DACL 给当前用户 FullControl。预创建空目录只能让应用越过目录创建，不能让 WebView2 完成初始化。
4. 安装 `log` 日志器后，真实错误为：

   ```text
   ERROR tauri_runtime_wry: failed to create webview: WebView2 error:
   WindowsError(Error { code: HRESULT(0x800700AA), message: "请求的资源在使用中。" })
   ```

5. `tauri-runtime-wry 2.11.4` 的 `Message::CreateWindow` 分支只用 `log::error!` 记录 native 创建失败。项目原本没有日志器，错误因此不可见。Tauri 仍登记 `main` 并执行用户 `setup` 和 `Ready`；`get_webview_window("main")` 的存在不能证明 native 创建成功。此时 `hwnd()` 返回 `Unavailable`，尺寸和可见性查询返回 `FailedToReceiveMessage`，`show()` / `set_focus()` 却可返回 `Ok`。
6. 同一 EXE 在默认桌面使用工作区内新数据目录后立即成功，`EnumWindows` 得到 `Tauri Window`、标题 `quizrx`、可见窗口；`EnumChildWindows` 得到 WRY/Chrome 子窗口。页面真实渲染 51,281 题、34 科目、900 章节和三个入口。
7. 将同一 EXE 与 `WebView2Loader.dll` 的字节写入普通用户目录中的新文件（继承 Medium 标签），不覆盖默认 WebView2 目录，再启动：进程 RID `0x2000`，原数据目录也成功。这排除了数据库、窗口配置、前端和 GNU WebView2 ABI 问题。单独复制 EXE 不够，GNU 构建依赖旁边的 Loader DLL。
8. `.rsrc merge failure: multiple non-default manifests` 在成功显示窗口的构建中也存在，因此不是此次无窗口的原因。不需要改清单、安装 MSVC 或管理员工具。

独立限制：普通 Codex 沙箱工具启动的进程位于 `WinSta0\CodexSandboxDesktop-…`，并持有 restricted token。即使修正 WebView2 目录，它也不能在用户默认桌面显示窗口。应从用户终端启动；Codex 内执行窗口验收时使用获准的非沙箱工具运行。这不等于管理员提升。

## 当前环境的启动方式

在用户默认桌面的 PowerShell 中执行。脚本默认使用 `D:\rust` 和 `D:\mingw64`，可用 `-RustRoot` / `-MingwRoot` 指定别的位置。

Debug 需要先在另一个终端运行 Vite：

```powershell
cd D:\repo\ykb_copyer\quizrx
pnpm dev
```

构建并启动：

```powershell
cd D:\repo\ykb_copyer\quizrx
.\scripts\run-windows-gnu.ps1
```

已有本次构建产物时用 `-SkipBuild`。Release 会先构建前端，并以 `--release --features tauri/custom-protocol` 内嵌 `dist`，无需 Vite：

```powershell
.\scripts\run-windows-gnu.ps1 -Release
```

脚本将编译临时文件、WebView2 数据、启动日志分别写入工作区的 `.runtime/tmp`、`.runtime/webview2`、`.runtime/logs`，并在退出脚本时还原调用终端的环境变量。`.runtime/` 不进入 Git。它不会修改系统标签或其他应用的数据，也不会关闭 Chromium sandbox。

也可以对已有 EXE 手工启动：

```powershell
$env:WEBVIEW2_USER_DATA_FOLDER='D:\repo\ykb_copyer\quizrx\.runtime\webview2'
$env:QUIZRX_LOG_DIR='D:\repo\ykb_copyer\quizrx\.runtime\logs'
Start-Process D:\repo\ykb_copyer\quizrx\src-tauri\target\debug\quizrx.exe `
  -WorkingDirectory D:\repo\ykb_copyer\quizrx\src-tauri
```

WebView2 数据目录应持久保存，且与宿主完整性级别匹配。Microsoft 的 [数据目录文档](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/user-data-folder) 也要求运行时拥有适当读写权限；跨桌面进程不应共享同一会话目录。普通安装在 Medium 用户环境下仍可使用默认 AppData 路径，无需上述覆盖。

## 保留的代码修复

- `src-tauri/src/startup.rs`：记录运行时 Warn/Error 和 panic 到 stderr 与 `startup.log`。默认路径为 `%LOCALAPPDATA%/com.wjx.quizrx/logs`，可用 `QUIZRX_LOG_DIR` 覆盖。
- `src-tauri/src/lib.rs`：Windows `setup` 检查主窗口实际 HWND，native 创建失败就记录 Wry 原始原因并以退出码 1 结束，避免继续无窗口常驻。此处不依赖 Tauri 的 setup panic：Release 的 `panic=abort` 会触发 Windows Error Reporting，可能暂时持有无窗口进程。
- `src-tauri/Cargo.toml`：Android 开发后已恢复 `crate-type = ["staticlib", "cdylib", "rlib"]`。Windows GNU 脚本仅在构建期间临时使用 `rlib`，并在 `finally` 中按原始字节恢复清单；Android 仍生成所需的共享库。
- `scripts/run-windows-gnu.ps1` 与 `.gitignore`：固化当前环境的构建和运行设置；新增 `QUIZRX_DATA_DIR=.runtime/data`，让 Low 完整性的桌面程序也能写入独立学习记录。

临时的 `setup` / `Ready` / `on_page_load` 逐事件追踪以及强制 `show` / `set_focus` 已撤除。数据链路和 JSON 数据未作此次修改。

## 最终验收记录（2026-10-12）

- 最终源码的 `cargo check`、Debug GNU 构建和 Release GNU 构建均通过。Release 按仓库的 LTO、opt-level 3、panic=abort 配置构建，启用 `tauri/custom-protocol`。
- 前端 `tsc --noEmit`、Vite build 以及 `pnpm build` 通过；此次没有前端源码改动。
- 关闭 Vite 后，Release 的 `http://tauri.localhost/` 页面显示“医学题库”、51,281 题、34 科目、900 章节和三个入口。已保存 WebView2 实际渲染截图。
- 最终无调试端口的 Release 实例：`EnumWindows` 得到可见的 `Tauri Window`，标题 `quizrx`，外框逻辑尺寸约 815×637，WebView 客户区 800×600；存在该 EXE 自己的 WebView2 浏览器进程。窗口桌面为 `WinSta0\Default`，宿主仍是 Low，但工作区数据目录可写，因此成功。
- 原 Low EXE 加默认 Medium 数据目录的失败对照：日志包含原始 `0x800700AA`，进程直接以退出码 1 结束，不再触发 WER 持有进程。
- 启动脚本 `-Release -SkipBuild` 实跑通过，环境变量恢复检查通过。临时调试参数已撤除，普通用户目录中的诊断 EXE / Loader 副本已清理。
- `tests_json_vault/` 和 `undefined/` 的 Git diff 为零。原有业务改动保留；没有提交或推送 Git。
