[CmdletBinding()]
param(
    [ValidateRange(1, 65535)][int]$Port = 5820,
    [string]$DataDirectory,
    [string]$PythonPath,
    [switch]$OpenBrowser
)

$ErrorActionPreference = 'Stop'
if (-not $DataDirectory) { $DataDirectory = Join-Path $PSScriptRoot 'data' }
$url = "http://127.0.0.1:$Port"
function Test-StudioReady {
    try {
        $state = Invoke-RestMethod -Uri "$url/api/session" -TimeoutSec 2
        return ($state.storage -eq 'mysql' -and $state.PSObject.Properties.Name -contains 'setupRequired')
    } catch {
        return $false
    }
}

if (-not (Test-StudioReady)) {
    $candidates = if ($PythonPath) {
        @($PythonPath)
    } else {
        @(
            (Join-Path $PSScriptRoot '.venv/Scripts/python.exe')
            (Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe')
            (Get-Command python -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1)
        )
    }
    $runtime = $null
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            try {
                & $candidate -c "import sys, mysql.connector, PIL, qrcode; sys.exit(0 if sys.version_info >= (3, 10) else 1)" 2>$null
                if ($LASTEXITCODE -eq 0) { $runtime = $candidate; break }
            } catch { continue }
        }
    }
    if (-not $runtime) { throw 'Install requirements.txt in the project virtual environment. See README.md.' }

    $directory = [System.IO.Directory]::CreateDirectory($DataDirectory).FullName
    if (Test-Path -LiteralPath (Join-Path $directory 'mysql-service/provisioned')) {
        & $runtime -B (Join-Path $PSScriptRoot 'tools/local_mysql.py') start --data-dir $directory
        if ($LASTEXITCODE -ne 0) { throw 'Project MySQL failed to start. See data/mysql-service/mysql.log.' }
        if (Test-StudioReady) {
            Write-Output $url
            if ($OpenBrowser) { Start-Process $url }
            return
        }
    }
    $program = Join-Path $PSScriptRoot 'server.py'
    $workerId = & $runtime -B $program serve --background --host 127.0.0.1 --port $Port --data-dir $directory
    if ($LASTEXITCODE -ne 0 -or !$workerId) { throw 'Could not start the MySQL-backed service.' }
    $process = Get-Process -Id ([int]$workerId) -ErrorAction Stop
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if ($process.HasExited) { break }
        if (Test-StudioReady) { $ready = $true; break }
        Start-Sleep -Milliseconds 250
    }
    if (-not $ready) { throw "Startup failed. Check $directory/service-error.log" }
    Write-Output "EIM PID $($process.Id)"
}
Write-Output $url
if ($OpenBrowser) { Start-Process $url }
