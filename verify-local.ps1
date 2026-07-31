param(
    [int]$BackendPort = 18000,
    [int]$FrontendPort = 18080
)

$ErrorActionPreference = 'Stop'

$root = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$python = Join-Path $root '.venv\Scripts\python.exe'
$ruff = Join-Path $root '.venv\Scripts\ruff.exe'
$envFile = Join-Path $root '.env'
$wranglerLogDir = Join-Path $root 'tmp'
$previousWranglerLogPath = $env:WRANGLER_LOG_PATH
$backendProcess = $null
$frontendProcess = $null

function Invoke-Checked {
    param(
        [string]$Label,
        [string]$FilePath,
        [string[]]$ArgumentList
    )

    Write-Host "[verify] $Label" -ForegroundColor Cyan
    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE."
    }
}

function Assert-PortAvailable {
    param([int]$Port)

    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    try {
        $listener.Start()
    } finally {
        $listener.Stop()
    }
}

function Wait-HttpOk {
    param(
        [string]$Uri,
        [System.Diagnostics.Process]$Process
    )

    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
        if ($Process.HasExited) {
            throw "Process $($Process.Id) exited before $Uri became ready."
        }
        try {
            $response = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200) {
                return
            }
        } catch {
        }
        Start-Sleep -Milliseconds 250
    }
    throw "$Uri did not become ready within 30 seconds."
}

if (-not (Test-Path -LiteralPath $envFile)) {
    throw '.env was not found. Local full verification requires the PostgreSQL configuration.'
}
if (-not (Test-Path -LiteralPath $python) -or -not (Test-Path -LiteralPath $ruff)) {
    throw '.venv is incomplete. Install requirements.txt first.'
}

Push-Location $root
try {
    $null = New-Item -ItemType Directory -Path $wranglerLogDir -Force
    $env:WRANGLER_LOG_PATH = Join-Path $wranglerLogDir 'wrangler-verify.log'
    Invoke-Checked 'Ruff' $ruff @('check', 'app', 'tests', 'scripts')
    Invoke-Checked 'pytest' $python @('-m', 'pytest', 'tests', '-q')
    Invoke-Checked 'PostgreSQL and API runtime' $python @('scripts\verify_runtime.py')
    Invoke-Checked 'Cloudflare static build' 'npm.cmd' @('run', 'cf:check')

    Assert-PortAvailable $BackendPort
    Assert-PortAvailable $FrontendPort
    $backendProcess = Start-Process -FilePath $python -WorkingDirectory $root -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', "$BackendPort") -WindowStyle Hidden -PassThru
    $frontendProcess = Start-Process -FilePath $python -WorkingDirectory $root -ArgumentList @('-m', 'http.server', "$FrontendPort", '--bind', '127.0.0.1') -WindowStyle Hidden -PassThru

    $backendBase = "http://127.0.0.1:$BackendPort"
    $frontendBase = "http://127.0.0.1:$FrontendPort"
    Wait-HttpOk "$backendBase/healthz" $backendProcess
    Wait-HttpOk "$frontendBase/frontdesign-v1/" $frontendProcess

    $null = Invoke-RestMethod "$backendBase/api/v1/public/dashboard/news" -TimeoutSec 5
    $mock = Invoke-RestMethod "$frontendBase/frontend-mocks-v0.1/e02-public-overview-changchun.json" -TimeoutSec 5
    if ($mock.code -ne 'OK' -or $null -eq $mock.data) {
        throw 'The local Mock endpoint returned an invalid response.'
    }

    Write-Host 'Local full verification passed.' -ForegroundColor Green
    Write-Host "Backend probe: $backendBase"
    Write-Host "Frontend probe: $frontendBase/frontdesign-v1/"
} finally {
    foreach ($process in @($backendProcess, $frontendProcess)) {
        if ($null -ne $process -and -not $process.HasExited) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
    }
    $env:WRANGLER_LOG_PATH = $previousWranglerLogPath
    Pop-Location
}
