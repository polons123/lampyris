<#
Скачивает пакет libmpv для Windows под одну архитектуру в build\libs\<arch> и сверяет SHA-256 с scripts\libmpv.lock.

  scripts\fetch-libs.ps1 -Arch x64|arm64            скачать и проверить
  scripts\fetch-libs.ps1 -Arch x64|arm64 -Update    скачать последний релиз upstream и записать новые тег и сумму в libmpv.lock
#>
param(
    [Parameter(Mandatory)][ValidateSet('x64', 'arm64')][string]$Arch,
    [switch]$Update
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path $PSScriptRoot -Parent
$lockFile = Join-Path $PSScriptRoot 'libmpv.lock'
$dest = Join-Path $root "build\libs\$Arch"
$repo = 'zhongfly/mpv-winbuild'

if ($Update) {
    $rel = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest"
    $pattern = if ($Arch -eq 'x64') { '^mpv-dev-x86_64-\d+-git-\w+\.7z$' } else { '^mpv-dev-aarch64-\d+-git-\w+\.7z$' }
    $asset = $rel.assets | Where-Object { $_.name -match $pattern } | Select-Object -First 1
    if (-not $asset) { throw "В релизе $($rel.tag_name) нет пакета для $Arch" }
    $tag = $rel.tag_name; $name = $asset.name; $sha = $null
} else {
    $line = Get-Content $lockFile | Where-Object { $_ -match "^$Arch " } | Select-Object -First 1
    if (-not $line) { throw "В libmpv.lock нет записи для $Arch" }
    $tag, $name, $sha = ($line -split '\s+')[1..3]
}

$cache = Join-Path $root 'build\libs'
New-Item -ItemType Directory -Force $cache | Out-Null
$archive = Join-Path $cache $name
if (-not (Test-Path $archive)) {
    Write-Host "Скачивание $name ($tag)"
    Invoke-WebRequest "https://github.com/$repo/releases/download/$tag/$name" -OutFile $archive
}
$actual = (Get-FileHash $archive -Algorithm SHA256).Hash.ToLower()
if ($Update) {
    $lines = @(Get-Content $lockFile | Where-Object { $_ -notmatch "^$Arch " }) + "$Arch $tag $name $actual"
    Set-Content $lockFile $lines
    Write-Host "Записано в libmpv.lock: $Arch $tag $name $actual"
} elseif ($actual -ne $sha) {
    Remove-Item $archive -Force
    throw "SHA-256 не совпала для ${name}: ожидалась $sha, получена $actual"
} else {
    Write-Host "Контрольная сумма совпала ($Arch)"
}

if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Force $dest | Out-Null
tar -xf $archive -C $dest
if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $dest 'libmpv-2.dll'))) { throw "Не удалось распаковать $name" }
Write-Host "libmpv ($Arch): $dest"
