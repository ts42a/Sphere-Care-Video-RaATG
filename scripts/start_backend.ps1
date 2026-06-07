# Start FastAPI backend on port 8000 (frees the port if another uvicorn is still running).
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$Port = if ($env:BACKEND_PORT) { [int]$env:BACKEND_PORT } else { 8000 }
$HostAddr = if ($env:BACKEND_HOST) { $env:BACKEND_HOST } else { "127.0.0.1" }
$Reload = $args -contains "--reload"

function Stop-ListenersOnPort {
    param([int]$LocalPort)
    $pids = Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($procId in $pids) {
        if ($procId -and $procId -ne 0) {
            Write-Host "[start_backend] Stopping PID $procId (port $LocalPort in use)"
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        }
    }
    if ($pids) { Start-Sleep -Seconds 1 }
}

Stop-ListenersOnPort -LocalPort $Port

$Python = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $Python)) {
    $Python = "python"
}

$uvicornArgs = @("-m", "uvicorn", "backend.main:app", "--host", $HostAddr, "--port", "$Port")
if ($Reload) { $uvicornArgs += "--reload" }

Write-Host "[start_backend] http://${HostAddr}:$Port (Ctrl+C to stop)"
& $Python @uvicornArgs
