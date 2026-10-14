<#
Собирает установщик Lampyris (Inno Setup 6) из готового пакета build-windows.ps1: dist\Lampyris-<версия>-windows-<arch>-setup.exe
и контрольную сумму. Сначала выполните build-windows.ps1 -Arch <arch>. Inno Setup: https://jrsoftware.org/isdl.php (ISCC.exe
ищется в стандартных папках или в PATH). Подпись (если задан сертификат): переменные LAMPYRIS_SIGN_PFX и LAMPYRIS_SIGN_PASSWORD, нужен signtool.

  windows\scripts\build-installer.ps1 -Arch x64|arm64 [-InstallInnoIfMissing]

-InstallInnoIfMissing: если Inno Setup нет, скачать официальный 6.7.3 с GitHub (проверяется подпись автора) и установить для текущего пользователя.
#>
param([Parameter(Mandatory)][ValidateSet('x64', 'arm64')][string]$Arch, [switch]$InstallInnoIfMissing)
$ErrorActionPreference = 'Stop'
$win = Split-Path $PSScriptRoot -Parent
$repo = Split-Path $win -Parent
$version = (Get-Content (Join-Path $repo 'scripts\VERSION') -Raw).Trim()
$dist = Join-Path $repo 'dist'
$pkg = Join-Path $dist "Lampyris-$version-windows-$Arch"
if (-not (Test-Path (Join-Path $pkg 'Lampyris.exe'))) { throw "Нет пакета ${pkg}: сначала build-windows.ps1 -Arch $Arch" }

$iscc = @("${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe", "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { $c = Get-Command ISCC.exe -ErrorAction SilentlyContinue; if ($c) { $iscc = $c.Source } }
if (-not $iscc -and $InstallInnoIfMissing) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $exe = Join-Path ([IO.Path]::GetTempPath()) 'innosetup-6.7.3.exe'
    Invoke-WebRequest 'https://github.com/jrsoftware/issrc/releases/download/is-6_7_3/innosetup-6.7.3.exe' -OutFile $exe
    $sig = Get-AuthenticodeSignature $exe
    if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'Pyrsys B\.V\.') { throw 'Подпись установщика Inno Setup не прошла проверку' }
    Start-Process $exe -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CURRENTUSER' -Wait
    $iscc = "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
    if (-not (Test-Path $iscc)) { $iscc = $null }
}
if (-not $iscc) { throw 'Не найден Inno Setup 6 (ISCC.exe); -InstallInnoIfMissing скачает его' }

$ErrorActionPreference = 'Continue'
& $iscc "/DAppVersion=$version" "/DArch=$Arch" "/DSourceDir=$pkg" "/DOutputDir=$dist" (Join-Path $win 'installer\lampyris.iss')
if ($LASTEXITCODE -ne 0) { throw 'ISCC завершился с ошибкой' }
$ErrorActionPreference = 'Stop'

$setup = Join-Path $dist "Lampyris-$version-windows-$Arch-setup.exe"
if ($env:LAMPYRIS_SIGN_PFX) {
    $signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match '\\x64\\' } | Sort-Object FullName -Descending | Select-Object -First 1
    if (-not $signtool) { throw 'Не найден signtool.exe (Windows SDK)' }
    $ErrorActionPreference = 'Continue'
    & $signtool.FullName sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /f $env:LAMPYRIS_SIGN_PFX /p $env:LAMPYRIS_SIGN_PASSWORD $setup
    if ($LASTEXITCODE -ne 0) { throw 'signtool завершился с ошибкой' }
    $ErrorActionPreference = 'Stop'
}
$hash = (Get-FileHash $setup -Algorithm SHA256).Hash.ToLower()
"$hash  $(Split-Path $setup -Leaf)" | Set-Content (Join-Path $dist "$(Split-Path $setup -Leaf).sha256")
Write-Host "Готово: $setup ($hash)"
