# OpenCode Gateway - One-Click Startup Script (PowerShell)
# Usage: .\start.ps1 [command]

param(
    [string]$Command = "run"
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Show-Help {
    Write-Host ""
    Write-Host "  OpenCode Gateway v2.0"
    Write-Host ""
    Write-Host "  Usage: .\start.ps1 [command]"
    Write-Host ""
    Write-Host "  Commands:"
    Write-Host "    run       One-click start (starts OpenCode + Gateway)"
    Write-Host "    dev       Development mode with ts-node"
    Write-Host "    build     Build TypeScript"
    Write-Host "    check     Run health check"
    Write-Host "    install   Install dependencies"
    Write-Host "    stop      Stop OpenCode Server"
    Write-Host "    help      Show this help"
    Write-Host ""
}

function Test-Command {
    param($Name)
    $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-Run {
    Write-Host ""
    Write-Host "========================================"
    Write-Host "  OpenCode Gateway"
    Write-Host "  One-Click Startup"
    Write-Host "========================================"
    Write-Host ""

    Set-Location $ScriptDir

    # Read OpenCode port from .env
    $OpenCodePort = 4096
    if (Test-Path ".env") {
        $envContent = Get-Content ".env" -Raw
        if ($envContent -match "OPENCODE_API_URL=http://[^:]*:(\d+)") {
            $OpenCodePort = $matches[1]
        }
    }

    # Check if OpenCode Server is running
    Write-Host "[1/4] Checking OpenCode Server on port $OpenCodePort..."
    $listener = Get-NetTCPConnection -LocalPort $OpenCodePort -State Listen -ErrorAction SilentlyContinue
    if ($listener) {
        Write-Host "      OpenCode Server already running on port $OpenCodePort"
    } else {
        Write-Host "      Starting OpenCode Server on port $OpenCodePort..."
        Start-Process -FilePath "opencode" -ArgumentList "serve", "--port", $OpenCodePort -WindowStyle Normal
        
        # Wait for server to start
        $count = 0
        while ($count -lt 30) {
            Start-Sleep -Seconds 1
            $listener = Get-NetTCPConnection -LocalPort $OpenCodePort -State Listen -ErrorAction SilentlyContinue
            if ($listener) {
                Write-Host "      OpenCode Server started successfully"
                break
            }
            $count++
        }
        if ($count -ge 30) {
            Write-Host "[ERROR] OpenCode Server failed to start within 30 seconds"
            return
        }
    }

    # Check dependencies
    if (-not (Test-Path "node_modules")) {
        Write-Host "[2/4] Installing dependencies..."
        npm install --silent
    } else {
        Write-Host "[2/4] Dependencies OK"
    }

    # Check build
    if (-not (Test-Path "dist\index.js")) {
        Write-Host "[3/4] Building TypeScript..."
        npm run build --silent
    } else {
        Write-Host "[3/4] Build OK"
    }

    # Check .env
    if (-not (Test-Path ".env")) {
        Write-Host "[!] .env not found, creating from .env.example..." -ForegroundColor Yellow
        Copy-Item ".env.example" ".env"
        Write-Host "    ========================================================" -ForegroundColor Yellow
        Write-Host "    [ATTENTION] Please edit .env with your configuration!" -ForegroundColor Yellow
        Write-Host "    The gateway will start, but might fail without valid keys." -ForegroundColor Yellow
        Write-Host "    ========================================================" -ForegroundColor Yellow
        Start-Sleep -Seconds 5
    }

    # Start
    Write-Host "[4/4] Starting gateway..."
    Write-Host ""
    Write-Host "========================================"
    Write-Host "  Gateway Running"
    Write-Host "  Press Ctrl+C to stop"
    Write-Host "========================================"
    Write-Host ""

    npm start
}

function Invoke-Dev {
    Write-Host ""
    Write-Host "========================================"
    Write-Host "  Development Mode"
    Write-Host "========================================"
    Write-Host ""

    Set-Location $ScriptDir

    if (-not (Test-Path "node_modules")) {
        Write-Host "Installing dependencies..."
        npm install --silent
    }

    if (-not (Test-Path ".env")) {
        Write-Host "Creating .env from .env.example..."
        Copy-Item ".env.example" ".env"
    }

    Write-Host "Starting in development mode..."
    Write-Host "Press Ctrl+C to stop"
    Write-Host ""

    npm run dev
}

function Invoke-Build {
    Write-Host ""
    Write-Host "Building TypeScript..."
    Set-Location $ScriptDir

    if (-not (Test-Path "node_modules")) {
        npm install --silent
    }

    npm run build

    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "[OK] Build successful!"
        Write-Host "     Output: dist\"
    } else {
        Write-Host ""
        Write-Host "[ERROR] Build failed!"
    }
}

function Invoke-Check {
    Write-Host ""
    Write-Host "========================================"
    Write-Host "  Health Check"
    Write-Host "========================================"
    Write-Host ""

    Set-Location $ScriptDir

    # Node.js
    if (Test-Command "node") {
        $ver = (node -v)
        Write-Host "[OK] Node.js: $ver"
    } else {
        Write-Host "[X] Node.js: Not installed"
    }

    # npm
    if (Test-Command "npm") {
        $ver = (npm -v)
        Write-Host "[OK] npm: $ver"
    } else {
        Write-Host "[X] npm: Not installed"
    }

    # Dependencies
    if (Test-Path "node_modules") {
        Write-Host "[OK] Dependencies: Installed"
    } else {
        Write-Host "[X] Dependencies: Not installed"
    }

    # .env
    if (Test-Path ".env") {
        Write-Host "[OK] .env: Found"
    } else {
        Write-Host "[X] .env: Not found"
    }

    # Build
    if (Test-Path "dist\index.js") {
        Write-Host "[OK] Build: Ready"
    } else {
        Write-Host "[X] Build: Not ready"
    }

    Write-Host ""
}

function Invoke-Install {
    Write-Host "Installing dependencies..."
    Set-Location $ScriptDir
    npm install

    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "[OK] Dependencies installed!"
    } else {
        Write-Host ""
        Write-Host "[ERROR] Failed to install dependencies!"
    }
}

function Invoke-Stop {
    Write-Host ""
    Write-Host "========================================"
    Write-Host "  Stopping OpenCode Server"
    Write-Host "========================================"
    Write-Host ""

    Set-Location $ScriptDir

    # Read OpenCode port from .env
    $OpenCodePort = 4096
    if (Test-Path ".env") {
        $envContent = Get-Content ".env" -Raw
        if ($envContent -match "OPENCODE_API_URL=http://[^:]*:(\d+)") {
            $OpenCodePort = $matches[1]
        }
    }

    # Find and stop OpenCode process
    $listener = Get-NetTCPConnection -LocalPort $OpenCodePort -State Listen -ErrorAction SilentlyContinue
    if ($listener) {
        $pid = $listener.OwningProcess
        Write-Host "Stopping process $pid on port $OpenCodePort..."
        Stop-Process -Id $pid -Force
        Write-Host "[OK] OpenCode Server stopped"
    } else {
        Write-Host "No process found on port $OpenCodePort"
    }

    Write-Host "Done."
}

# Main
switch ($Command) {
    "run" { Invoke-Run }
    "dev" { Invoke-Dev }
    "build" { Invoke-Build }
    "check" { Invoke-Check }
    "install" { Invoke-Install }
    "stop" { Invoke-Stop }
    "help" { Show-Help }
    "-h" { Show-Help }
    "--help" { Show-Help }
    default {
        Write-Host "Unknown command: $Command"
        Show-Help
    }
}