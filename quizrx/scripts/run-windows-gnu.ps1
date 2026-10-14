param(
    [switch]$Release,
    [switch]$SkipBuild,
    [string]$RustRoot = 'D:\rust',
    [string]$MingwRoot = 'D:\mingw64'
)
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$tauri = Join-Path $project 'src-tauri'
$runtime = Join-Path $project '.runtime'
$temporary = Join-Path $runtime 'tmp'
$buildProfile = if ($Release) { 'release' } else { 'debug' }
$executable = Join-Path $tauri "target\$buildProfile\quizrx.exe"

# A Codex workspace may label EXEs Low. Keep their browser data and logs in the
# same writable workspace. This changes only these child processes' environment.
$variables = @{
    RUSTUP_HOME = Join-Path $RustRoot 'rustup'
    CARGO_HOME = Join-Path $RustRoot 'cargo'
    PATH = "$(Join-Path $RustRoot 'cargo\bin');$(Join-Path $MingwRoot 'bin');$env:PATH"
    TMP = $temporary
    TEMP = $temporary
    CC = Join-Path $MingwRoot 'bin\gcc.exe'
    CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER = Join-Path $MingwRoot 'bin\gcc.exe'
    CARGO_PROFILE_DEV_DEBUG = '0'
    CARGO_TARGET_DIR = Join-Path $tauri 'target'
    WEBVIEW2_USER_DATA_FOLDER = Join-Path $runtime 'webview2'
    QUIZRX_LOG_DIR = Join-Path $runtime 'logs'
    QUIZRX_DATA_DIR = Join-Path $runtime 'data'
}
$previous = @{}
try {
    foreach ($name in $variables.Keys) {
        $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $variables[$name], 'Process')
    }
    foreach ($directory in @($temporary, $variables.WEBVIEW2_USER_DATA_FOLDER, $variables.QUIZRX_LOG_DIR, $variables.QUIZRX_DATA_DIR)) {
        New-Item -ItemType Directory -Force $directory | Out-Null
    }
    Push-Location $project
    try {
        if (-not $Release) {
            try { $response = Invoke-WebRequest 'http://localhost:1420/' -TimeoutSec 3 }
            catch { throw '请先在 quizrx/ 下运行 pnpm dev，等待端口 1420 就绪。' }
            if ($response.Content -notmatch '@vite/client') {
                throw '端口 1420 的服务不是 Vite 开发服务器。'
            }
        }
        if (-not $SkipBuild) {
            $arguments = @('+stable-x86_64-pc-windows-gnu', 'build', '--manifest-path', (Join-Path $tauri 'Cargo.toml'))
            if ($Release) {
                & pnpm build
                if ($LASTEXITCODE -ne 0) { throw '前端构建失败。' }
                $arguments += @('--release', '--features', 'tauri/custom-protocol')
            }
            $manifest = Join-Path $tauri 'Cargo.toml'
            $originalManifest = [IO.File]::ReadAllBytes($manifest)
            try {
                $desktopManifest = [IO.File]::ReadAllText($manifest).Replace('crate-type = ["staticlib", "cdylib", "rlib"]', 'crate-type = ["rlib"]')
                [IO.File]::WriteAllText($manifest, $desktopManifest, [Text.UTF8Encoding]::new($false))
                & cargo @arguments
                if ($LASTEXITCODE -ne 0) { throw 'Rust 构建失败。' }
            }
            finally { [IO.File]::WriteAllBytes($manifest, $originalManifest) }
        }
        if (-not (Test-Path -LiteralPath $executable)) { throw "找不到 $executable" }
        # Run this script from the user's normal desktop. In Codex, request an
        # unsandboxed tool run; a private sandbox desktop cannot display user UI.
        $application = Start-Process -FilePath $executable -WorkingDirectory $tauri -PassThru
        Write-Host "quizrx PID=$($application.Id); startup log: $($variables.QUIZRX_LOG_DIR)\startup.log"
        return $application
    }
    finally { Pop-Location }
}
finally {
    foreach ($name in $previous.Keys) {
        if ($null -eq $previous[$name]) {
            [Environment]::SetEnvironmentVariable($name, [NullString]::Value, 'Process')
        }
        else {
            [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process')
        }
    }
}
