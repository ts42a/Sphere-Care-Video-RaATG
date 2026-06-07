# Stop whatever is listening on the backend port (default 8000).
$ErrorActionPreference = "Stop"
$Port = if ($env:BACKEND_PORT) { [int]$env:BACKEND_PORT } else { 8000 }

$pids = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique

if (-not $pids) {
    Write-Host "[stop_backend] No listener on port $Port"
    exit 0
}

foreach ($procId in $pids) {
    if ($procId -and $procId -ne 0) {
        Write-Host "[stop_backend] Stopping PID $procId (port $Port)"
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
}
Start-Sleep -Seconds 1
Write-Host "[stop_backend] Port $Port is free"
