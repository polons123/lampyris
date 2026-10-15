<#
Собирает Lampyris для Windows под одну архитектуру: библиотека libmpv (с проверкой SHA-256), cargo build, пакет
dist\Lampyris-<версия>-windows-<arch>\ и архив .zip с контрольной суммой, а также полностью портативный вариант
(-portable.zip: рядом с exe лежит portable.txt, настройки и данные WebView2 хранятся в папке data рядом с программой). Нужны Rust (с нужной целью) и Visual Studio Build Tools.

  windows\scripts\build-windows.ps1 -Arch x64|arm64
#>
param([Parameter(Mandatory)][ValidateSet('x64', 'arm64')][string]$Arch)
$ErrorActionPreference = 'Stop'
$win = Split-Path $PSScriptRoot -Parent
$repo = Split-Path $win -Parent
$version = (Get-Content (Join-Path $repo 'scripts\VERSION') -Raw).Trim()
$target = if ($Arch -eq 'x64') { 'x86_64-pc-windows-msvc' } else { 'aarch64-pc-windows-msvc' }

& (Join-Path $PSScriptRoot 'fetch-libs.ps1') -Arch $Arch
Push-Location $win
# Нативные команды пишут сообщения в stderr: при 'Stop' Windows PowerShell 5.1 считал бы их ошибкой, поэтому проверяем код выхода.
$ErrorActionPreference = 'Continue'
try {
    rustup target add $target
    if ($LASTEXITCODE -ne 0) { throw 'rustup target add завершился с ошибкой' }
    cargo build --release --locked --target $target
    if ($LASTEXITCODE -ne 0) { throw 'cargo build завершился с ошибкой' }
} finally { Pop-Location; $ErrorActionPreference = 'Stop' }

$name = "Lampyris-$version-windows-$Arch"
$dist = Join-Path $repo 'dist'
$pkg = Join-Path $dist $name
if (Test-Path $pkg) { Remove-Item $pkg -Recurse -Force }
New-Item -ItemType Directory -Force $pkg | Out-Null
Copy-Item (Join-Path $win "target\$target\release\lampyris.exe") (Join-Path $pkg 'Lampyris.exe')
Copy-Item (Join-Path $win "build\libs\$Arch\libmpv-2.dll") $pkg
Copy-Item (Join-Path $repo 'LICENSE') $pkg
Copy-Item (Join-Path $repo 'THIRD-PARTY.md') $pkg

& (Join-Path $PSScriptRoot 'verify-bundle.ps1') -Dir $pkg -Arch $Arch
$zip = Join-Path $dist "$name.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path $pkg -DestinationPath $zip
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
"$hash  $name.zip" | Set-Content (Join-Path $dist "$name.zip.sha256")
Write-Host "Готово: $zip ($hash)"

# Полностью портативный вариант: тот же состав + маркер portable.txt и пустая папка data (в архиве ей нужен файл).
$pname = "$name-portable"
$ppkg = Join-Path $dist $pname
if (Test-Path $ppkg) { Remove-Item $ppkg -Recurse -Force }
Copy-Item $pkg $ppkg -Recurse
Set-Content (Join-Path $ppkg 'portable.txt') -Encoding UTF8 -Value @(
    'Полностью портативный режим Lampyris.',
    'Пока этот файл лежит рядом с Lampyris.exe, настройки, вход в Lampa, данные WebView2, журнал и mpv.conf хранятся в папке data рядом с программой.',
    'Папку можно переносить целиком (например, на флешку) или сохранить перед переустановкой Windows. Удалите этот файл, чтобы вернуться к обычным папкам пользователя.'
)
New-Item -ItemType Directory -Force (Join-Path $ppkg 'data') | Out-Null
Set-Content (Join-Path $ppkg 'data\README.txt') -Encoding UTF8 -Value 'Здесь Lampyris хранит свои данные (Roaming — настройки и mpv.conf, Local — WebView2, журнал, кэш).'
$pzip = Join-Path $dist "$pname.zip"
if (Test-Path $pzip) { Remove-Item $pzip -Force }
Compress-Archive -Path $ppkg -DestinationPath $pzip
Remove-Item $ppkg -Recurse -Force
$phash = (Get-FileHash $pzip -Algorithm SHA256).Hash.ToLower()
"$phash  $pname.zip" | Set-Content (Join-Path $dist "$pname.zip.sha256")
Write-Host "Готово: $pzip ($phash)"
