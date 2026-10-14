param([string]$RustRoot='D:\rust', [string]$MingwRoot='D:\mingw64', [string]$TestFilter='practice::tests')
$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot -Parent
$tauri=Join-Path $project 'src-tauri'
$temporary=Join-Path $project '.runtime\tmp'
New-Item -ItemType Directory -Force $temporary | Out-Null
$changes=@{
    RUSTUP_HOME=Join-Path $RustRoot 'rustup'; CARGO_HOME=Join-Path $RustRoot 'cargo'
    PATH="$(Join-Path $RustRoot 'cargo\bin');$(Join-Path $MingwRoot 'bin');$env:PATH"
    TMP=$temporary; TEMP=$temporary; CC=Join-Path $MingwRoot 'bin\gcc.exe'
    CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=Join-Path $MingwRoot 'bin\gcc.exe'
    CARGO_PROFILE_DEV_DEBUG='0'; CARGO_BUILD_JOBS='2'; CARGO_TARGET_DIR=Join-Path $tauri 'target'
}
$previous=@{}
try {
    foreach($name in $changes.Keys){$previous[$name]=[Environment]::GetEnvironmentVariable($name,'Process');[Environment]::SetEnvironmentVariable($name,$changes[$name],'Process')}
    $output=& cargo +stable-x86_64-pc-windows-gnu test --manifest-path (Join-Path $tauri 'Cargo.toml') --locked --lib --no-run --message-format=json
    if($LASTEXITCODE -ne 0){throw 'Rust test compilation failed'}
    $artifact=$output | ForEach-Object {try {$_|ConvertFrom-Json}catch{}} | Where-Object {$_.reason -eq 'compiler-artifact' -and $_.profile.test -and $_.executable} | Select-Object -Last 1
    if(-not $artifact){throw 'No library test executable returned by Cargo'}
    $executable=[IO.Path]::GetFullPath($artifact.executable)
    $expectedRoot=[IO.Path]::GetFullPath((Join-Path $tauri 'target'))+[IO.Path]::DirectorySeparatorChar
    if(-not $executable.StartsWith($expectedRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'Unexpected test artifact location'}
    # MinGW cannot merge Rust's default manifest with Tauri's v6 manifest in the
    # test harness. Replace only this generated test EXE's resources, not app EXEs.
    if(-not ('QuizRxTestManifest' -as [type])){
        Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class QuizRxTestManifest {
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr BeginUpdateResource(string path, bool delete);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool UpdateResource(IntPtr h, IntPtr type, IntPtr name, ushort language, byte[] data, uint size);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool EndUpdateResource(IntPtr h, bool discard);
}
'@
    }
    $manifest='<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0"><dependency><dependentAssembly><assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*"/></dependentAssembly></dependency></assembly>'
    $bytes=[Text.Encoding]::UTF8.GetBytes($manifest)
    $handle=[QuizRxTestManifest]::BeginUpdateResource($executable,$true)
    if($handle -eq [IntPtr]::Zero){throw 'Cannot update generated test manifest'}
    if(-not [QuizRxTestManifest]::UpdateResource($handle,[IntPtr]24,[IntPtr]1,0,$bytes,$bytes.Length)){
        [QuizRxTestManifest]::EndUpdateResource($handle,$true)|Out-Null;throw 'Cannot write test manifest'
    }
    if(-not [QuizRxTestManifest]::EndUpdateResource($handle,$false)){throw 'Cannot save test manifest'}
    $env:PATH="$(Join-Path $tauri 'target\debug');$env:PATH"
    & $executable $TestFilter --nocapture
    if($LASTEXITCODE -ne 0){throw 'Practice regression tests failed'}
}
finally {
    foreach($name in $previous.Keys){
        if($null -eq $previous[$name]){[Environment]::SetEnvironmentVariable($name,[NullString]::Value,'Process')}
        else{[Environment]::SetEnvironmentVariable($name,$previous[$name],'Process')}
    }
}
