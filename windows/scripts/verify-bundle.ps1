<#
Проверяет состав готового пакета Windows: exe и libmpv-2.dll на месте, у обоих архитектура совпадает с заявленной,
рядом лежат лицензии.   scripts\verify-bundle.ps1 -Dir dist\Lampyris-0.1.0-windows-x64 -Arch x64
#>
param(
    [Parameter(Mandatory)][string]$Dir,
    [Parameter(Mandatory)][ValidateSet('x64', 'arm64')][string]$Arch
)
$ErrorActionPreference = 'Stop'
$want = if ($Arch -eq 'x64') { 0x8664 } else { 0xAA64 }
function Machine($path) {
    $fs = [IO.File]::OpenRead($path)
    try {
        $b = New-Object byte[] 4096
        [void]$fs.Read($b, 0, 4096)
        [BitConverter]::ToUInt16($b, [BitConverter]::ToInt32($b, 60) + 4)
    } finally { $fs.Dispose() }
}
$fail = $false
foreach ($f in 'Lampyris.exe', 'libmpv-2.dll', 'LICENSE', 'THIRD-PARTY.md') {
    if (-not (Test-Path (Join-Path $Dir $f))) { Write-Error "Нет файла $f" -ErrorAction Continue; $fail = $true }
}
foreach ($f in 'Lampyris.exe', 'libmpv-2.dll') {
    $p = Join-Path $Dir $f
    if (Test-Path $p) {
        $m = Machine $p
        if ($m -ne $want) { Write-Error ("{0}: архитектура 0x{1:X}, ожидалась 0x{2:X}" -f $f, $m, $want) -ErrorAction Continue; $fail = $true }
        else { Write-Host ("ok: {0} ({1})" -f $f, $Arch) }
    }
}
if ($fail) { exit 1 }
