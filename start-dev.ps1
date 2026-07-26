param(
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

$root = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$backendDir = $root
$python = Join-Path $root '.venv\Scripts\python.exe'
$frontendUrl = 'http://localhost:8080/frontdesign-v1/'
$backendUrl = 'http://127.0.0.1:8000/healthz'

if (-not (Test-Path -LiteralPath $python)) {
    throw '.venv was not found. Create the virtual environment and install requirements.txt first.'
}

$logRoot = [System.IO.Path]::GetTempPath()
$runId = [DateTime]::Now.ToString('yyyyMMdd-HHmmss-fff')
$backendLog = Join-Path $logRoot "black-soil-loop-backend-$runId.log"
$backendErrorLog = Join-Path $logRoot "black-soil-loop-backend-error-$runId.log"
$frontendLog = Join-Path $logRoot "black-soil-loop-frontend-$runId.log"
$frontendErrorLog = Join-Path $logRoot "black-soil-loop-frontend-error-$runId.log"
$backendProcess = $null
$frontendProcess = $null

function Stop-ChildProcess {
    param([System.Diagnostics.Process]$Process)

    if ($null -ne $Process -and -not $Process.HasExited) {
        Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
    }
}

function Show-LogTail {
    param([string]$Path)

    if (Test-Path -LiteralPath $Path) {
        Get-Content -LiteralPath $Path -Tail 20 -ErrorAction SilentlyContinue
    }
}

function Test-ServiceReady {
    param([string]$Uri)

    try {
        $null = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 1
        return $true
    } catch {
        return $false
    }
}

try {
    $deadline = (Get-Date).AddSeconds(30)
    $backendReady = Test-ServiceReady $backendUrl
    $frontendReady = Test-ServiceReady $frontendUrl

    if (-not $backendReady) {
        $backendProcess = Start-Process `
            -FilePath $python `
            -WorkingDirectory $backendDir `
            -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000') `
            -WindowStyle Hidden `
            -RedirectStandardOutput $backendLog `
            -RedirectStandardError $backendErrorLog `
            -PassThru
    }

    if (-not $frontendReady) {
        $frontendProcess = Start-Process `
            -FilePath $python `
            -WorkingDirectory $root `
            -ArgumentList @('-m', 'http.server', '8080', '--directory', ('"{0}"' -f $root)) `
            -WindowStyle Hidden `
            -RedirectStandardOutput $frontendLog `
            -RedirectStandardError $frontendErrorLog `
            -PassThru
    }

    while ((Get-Date) -lt $deadline -and (-not $backendReady -or -not $frontendReady)) {
        if ($null -ne $backendProcess -and $backendProcess.HasExited) {
            if (Test-ServiceReady $backendUrl) {
                $backendProcess = $null
            } else {
                throw "The backend process exited.`n$(Show-LogTail $backendErrorLog)"
            }
        }
        if ($null -ne $frontendProcess -and $frontendProcess.HasExited) {
            if (Test-ServiceReady $frontendUrl) {
                $frontendProcess = $null
            } else {
                throw "The frontend process exited.`n$(Show-LogTail $frontendErrorLog)"
            }
        }

        $backendReady = Test-ServiceReady $backendUrl
        $frontendReady = Test-ServiceReady $frontendUrl

        if (-not $backendReady -or -not $frontendReady) {
            Start-Sleep -Milliseconds 250
        }
    }

    if (-not $backendReady) {
        throw "Backend did not start within 30 seconds.`n$(Show-LogTail $backendErrorLog)"
    }

    if (-not $frontendReady) {
        throw "Frontend did not start within 30 seconds.`n$(Show-LogTail $frontendErrorLog)"
    }

    Write-Host 'Black-Soil-Loop is ready.' -ForegroundColor Green
    Write-Host "Backend: $backendUrl"
    Write-Host "Frontend: $frontendUrl"
    Write-Host "Backend log: $backendLog"
    Write-Host "Frontend log: $frontendLog"
    Write-Host 'The browser will open. Press Ctrl+C to stop both services.' -ForegroundColor Yellow
    if (-not $NoBrowser) {
        Start-Process $frontendUrl | Out-Null
    }

    while ($true) {
        if ($null -ne $backendProcess -and $backendProcess.HasExited) {
            throw "The backend process exited.`n$(Show-LogTail $backendErrorLog)"
        }
        if ($null -eq $backendProcess -and -not (Test-ServiceReady $backendUrl)) {
            throw 'The existing backend service is no longer reachable.'
        }
        if ($null -ne $frontendProcess -and $frontendProcess.HasExited) {
            throw "The frontend process exited.`n$(Show-LogTail $frontendErrorLog)"
        }
        if ($null -eq $frontendProcess -and -not (Test-ServiceReady $frontendUrl)) {
            throw 'The existing frontend service is no longer reachable.'
        }
        Start-Sleep -Seconds 2
    }
} finally {
    Stop-ChildProcess $backendProcess
    Stop-ChildProcess $frontendProcess
}
