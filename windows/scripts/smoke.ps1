<#
Дымовой запуск готового пакета: приложение открывает тестовое видео (lavfi testsrc) без сервера Lampa и через несколько
секунд пишет в журнал состояние плеера; скрипт проверяет, что mpv действительно декодирует видео.
  scripts\smoke.ps1 -Dir dist\Lampyris-0.1.0-windows-x64
#>
param([Parameter(Mandatory)][string]$Dir)
$ErrorActionPreference = 'Stop'
$exe = Join-Path (Resolve-Path $Dir) 'Lampyris.exe'
$log = Join-Path $env:LOCALAPPDATA 'Lampyris\Logs\lampa.log'
if (Test-Path $log) { Remove-Item $log -Force }
$env:LAMPA_MPV_TEST = 'av://lavfi:testsrc=duration=20:size=320x180:rate=25'
$env:LAMPA_DEBUG = '1'
$p = Start-Process $exe -PassThru
try {
    $found = $null
    for ($i = 0; $i -lt 30 -and -not $found; $i++) {
        Start-Sleep -Seconds 1
        if ($p.HasExited) { throw "Lampyris.exe завершился сам (код $($p.ExitCode))" }
        if (Test-Path $log) { $found = Select-String -Path $log -Pattern '\[smoke\] video-codec=' | Select-Object -First 1 }
    }
    if (Test-Path $log) { Get-Content $log -Tail 20 }
    if (-not $found) { throw 'В журнале нет строки [smoke]: плеер не запустился' }
    Write-Host $found.Line
    if ($found.Line -match 'video-codec=-') { throw 'mpv не определил видеокодек' }
    # Кодек сам по себе не доказывает воспроизведение: нужны размер кадра и продвинувшаяся позиция.
    $m = [regex]::Match($found.Line, 'size=(\d+)x(\d+) time-pos=([0-9.]+)')
    if (-not $m.Success -or [int]$m.Groups[1].Value -le 0 -or [int]$m.Groups[2].Value -le 0 -or [double]::Parse($m.Groups[3].Value, [Globalization.CultureInfo]::InvariantCulture) -le 0) {
        throw 'Видео не воспроизводится: нет размера кадра или позиция не продвинулась'
    }
} finally {
    if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
}
