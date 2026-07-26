$ErrorActionPreference = 'Stop'

$backendRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$pythonPath = Join-Path $backendRoot '.venv\Scripts\python.exe'

if (-not (Test-Path -LiteralPath $pythonPath)) {
    throw '未找到 backend\.venv，请先按 README 安装 Python 依赖。'
}

Push-Location $backendRoot
try {
    & $pythonPath -m app.cli.accounts @args
    if ($LASTEXITCODE -ne 0) {
        throw "账户命令执行失败，退出码：$LASTEXITCODE"
    }
}
finally {
    Pop-Location
}
