[CmdletBinding()]
param(
    [switch]$Release,
    [switch]$CheckOnly,
    [string]$RustRoot = 'D:\rust',
    [string]$BuildDirectory = (Join-Path $env:LOCALAPPDATA 'QuizRxBuild\android-target'),
    [string]$MingwRoot = 'D:\mingw64',
    [string]$JavaHome = 'C:\Program Files\Android\Android Studio\jbr',
    [string]$AndroidSdk = (Join-Path $env:LOCALAPPDATA 'Android\Sdk'),
    [string]$NdkVersion = '28.2.13676358',
    [string]$GradleUserHome = (Join-Path $env:USERPROFILE '.gradle'),
    [ValidateRange(24, 35)][int]$ApiLevel = 24
)
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path $PSScriptRoot -Parent
$tauriDirectory = Join-Path $projectDirectory 'src-tauri'
$runtimeDirectory = Join-Path $projectDirectory '.runtime'
$temporaryDirectory = Join-Path $runtimeDirectory 'tmp'
$ndkDirectory = Join-Path $AndroidSdk "ndk\$NdkVersion"
$ndkBinDirectory = Join-Path $ndkDirectory 'toolchains\llvm\prebuilt\windows-x86_64\bin'
$androidClang = Join-Path $ndkBinDirectory "aarch64-linux-android$ApiLevel-clang.cmd"
$androidClangCpp = Join-Path $ndkBinDirectory "aarch64-linux-android$ApiLevel-clang++.cmd"
$hostGcc = Join-Path $MingwRoot 'bin\gcc.exe'
$adb = Join-Path $AndroidSdk 'platform-tools\adb.exe'

foreach ($requiredFile in @(
    (Join-Path $JavaHome 'bin\java.exe'),
    (Join-Path $RustRoot 'cargo\bin\cargo.exe'),
    (Join-Path $RustRoot 'cargo\bin\rustup.exe'),
    $hostGcc, $androidClang, $androidClangCpp,
    (Join-Path $ndkBinDirectory 'llvm-ar.exe'), $adb
)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
        throw "缺少构建工具：$requiredFile。请安装或通过脚本参数指定现有工具链。"
    }
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { throw 'PATH 中找不到 pnpm。' }

# cc-rs distinguishes host GNU tools from Android clang. Clear inherited desktop
# globals so the bundled SQLite C source cannot accidentally use MinGW for ARM64.
$environmentChanges = @{
    RUSTUP_HOME = Join-Path $RustRoot 'rustup'
    CARGO_HOME = Join-Path $RustRoot 'cargo'
    RUSTUP_TOOLCHAIN = 'stable-x86_64-pc-windows-gnu'
    PATH = "$(Join-Path $RustRoot 'cargo\bin');$(Join-Path $MingwRoot 'bin');$(Join-Path $JavaHome 'bin');$(Join-Path $AndroidSdk 'platform-tools');$env:PATH"
    JAVA_HOME = $JavaHome
    ANDROID_HOME = $AndroidSdk
    ANDROID_SDK_ROOT = $AndroidSdk
    ANDROID_USER_HOME = Join-Path $runtimeDirectory 'android-user'
    NDK_HOME = $ndkDirectory
    TMP = $temporaryDirectory
    TEMP = $temporaryDirectory
    GRADLE_USER_HOME = $GradleUserHome
    # Host build scripts must inherit Medium integrity: they copy Android
    # plugin projects into Cargo's user cache. Workspace Low EXEs cannot do so.
    CARGO_TARGET_DIR = $BuildDirectory
    CARGO_PROFILE_DEV_DEBUG = '0'
    CARGO_BUILD_JOBS = '2'
    CC = $null
    CXX = $null
    AR = $null
    CFLAGS = $null
    CXXFLAGS = $null
    CC_x86_64_pc_windows_gnu = $hostGcc
    CXX_x86_64_pc_windows_gnu = Join-Path $MingwRoot 'bin\g++.exe'
    AR_x86_64_pc_windows_gnu = Join-Path $MingwRoot 'bin\ar.exe'
    CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER = $hostGcc
    CC_aarch64_linux_android = $androidClang
    CXX_aarch64_linux_android = $androidClangCpp
    AR_aarch64_linux_android = Join-Path $ndkBinDirectory 'llvm-ar.exe'
    CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER = $null
    JAVA_TOOL_OPTIONS = (($env:JAVA_TOOL_OPTIONS + ' -Djava.io.tmpdir=' + $temporaryDirectory).Trim())
}
$previousEnvironment = @{}
try {
    foreach ($environmentName in $environmentChanges.Keys) {
        $previousEnvironment[$environmentName] = [Environment]::GetEnvironmentVariable($environmentName, 'Process')
        $environmentValue = if ($null -eq $environmentChanges[$environmentName]) { [NullString]::Value } else { $environmentChanges[$environmentName] }
        [Environment]::SetEnvironmentVariable($environmentName, $environmentValue, 'Process')
    }
    foreach ($taskDirectory in @($temporaryDirectory, $environmentChanges.GRADLE_USER_HOME, $environmentChanges.ANDROID_USER_HOME)) {
        New-Item -ItemType Directory -Force -Path $taskDirectory | Out-Null
    }
    $installedTargets = & rustup target list --installed
    if ($LASTEXITCODE -ne 0 -or $installedTargets -notcontains 'aarch64-linux-android') {
        throw '缺少 ARM64 Rust 目标。请运行 rustup +stable-x86_64-pc-windows-gnu target add aarch64-linux-android。'
    }
    Write-Host 'Android 设备状态（构建 APK 不要求连接设备）：'
    & $adb devices -l
    if ($LASTEXITCODE -ne 0) { Write-Warning 'adb devices 检查失败。APK 构建无需设备；安装前请在用户 PowerShell 中另行检查 adb。' }
    if ($CheckOnly) {
        Write-Host '构建工具链检查通过；设备状态见上方输出。尚未执行 APK 构建或安装。'
        return
    }
    if (-not (Test-Path -LiteralPath (Join-Path $tauriDirectory 'gen\android\gradlew.bat'))) {
        throw 'Android 项目尚未初始化。请先在 quizrx 目录运行 pnpm tauri android init。'
    }
    $cargoManifest = [IO.File]::ReadAllText((Join-Path $tauriDirectory 'Cargo.toml'))
    if ($cargoManifest -notmatch 'crate-type\s*=\s*\[[^\]]*"cdylib"') {
        throw 'Android 需要 cdylib。请还原 Cargo.toml 移动端 crate-type；桌面 GNU 变通不可用于 Android。'
    }
    Push-Location $projectDirectory
    try {
        # Tauri configures the Android linker and embeds frontendDist through its
        # beforeBuildCommand. No Vite development server is needed for this APK.
        $buildArguments = @('tauri', 'android', 'build', '--target', 'aarch64', '--apk', '--ci')
        if (-not $Release) { $buildArguments += '--debug' }
        & pnpm @buildArguments
        if ($LASTEXITCODE -ne 0) { throw "Android 构建失败（退出码 $LASTEXITCODE）。" }
        $apkDirectory = Join-Path $tauriDirectory 'gen\android\app\build\outputs\apk'
        $apkFiles = Get-ChildItem -LiteralPath $apkDirectory -Recurse -Filter '*.apk' -File
        if (-not $apkFiles) { throw "构建结束但未找到 APK：$apkDirectory" }
        Write-Host 'APK 构建输出（未自动安装）：'
        $apkFiles | Select-Object FullName, Length, LastWriteTime
    }
    finally { Pop-Location }
}
finally {
    foreach ($environmentName in $previousEnvironment.Keys) {
        $environmentValue = if ($null -eq $previousEnvironment[$environmentName]) { [NullString]::Value } else { $previousEnvironment[$environmentName] }
        [Environment]::SetEnvironmentVariable($environmentName, $environmentValue, 'Process')
    }
}





