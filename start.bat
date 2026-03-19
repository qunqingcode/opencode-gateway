@echo off
setlocal enabledelayedexpansion

:: ============================================================
:: OpenCode Gateway - One-Click Startup Script
:: ============================================================

set "SCRIPT_DIR=%~dp0"
set "MODE=%~1"

:: Parse command
if "%MODE%"=="" goto run
if "%MODE%"=="run" goto run
if "%MODE%"=="dev" goto dev
if "%MODE%"=="build" goto build
if "%MODE%"=="check" goto check
if "%MODE%"=="install" goto install
if "%MODE%"=="stop" goto stop
if "%MODE%"=="help" goto help
if "%MODE%"=="-h" goto help
if "%MODE%"=="--help" goto help

echo Unknown command: %MODE%
goto help

:: ============================================================
:: RUN - One-click start (default)
:: ============================================================
:run
echo.
echo ========================================
echo   OpenCode Gateway
echo   One-Click Startup
echo ========================================
echo.

cd /d "%SCRIPT_DIR%"

:: Read OpenCode port from .env
set "OPENCODE_PORT=4096"
for /f "tokens=2 delims==" %%a in ('findstr "OPENCODE_API_URL" .env 2^>nul') do (
    for /f "tokens=3 delims=:" %%b in ("%%a") do set "OPENCODE_PORT=%%b"
)
set "OPENCODE_PORT=%OPENCODE_PORT: =%"

:: Prompt user for project path
set "PROJECT_PATH="
echo.
set /p "PROJECT_PATH=Please enter the project path (leave empty for current directory): "
if "%PROJECT_PATH%"=="" set "PROJECT_PATH=."
echo.

:: Check if OpenCode Server is running
echo [1/4] Checking OpenCode Server on port %OPENCODE_PORT%...
netstat -ano | findstr ":%OPENCODE_PORT%" | findstr "LISTENING" >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo       OpenCode Server already running on port %OPENCODE_PORT%
) else (
    echo       Starting OpenCode Server on port %OPENCODE_PORT% with path: %PROJECT_PATH%...
    start "OpenCode Server" /D "%PROJECT_PATH%" opencode serve --port %OPENCODE_PORT%
    
    :: Wait for server to start
    set /a COUNT=0
    :wait_opencode
    timeout /t 1 /nobreak >nul
    netstat -ano | findstr ":%OPENCODE_PORT%" | findstr "LISTENING" >nul 2>&1
    if %ERRORLEVEL% neq 0 (
        set /a COUNT+=1
        if !COUNT! lss 30 goto wait_opencode
        echo [ERROR] OpenCode Server failed to start within 30 seconds
        goto end
    )
    echo       OpenCode Server started successfully
)

:: Check dependencies
if not exist node_modules (
    echo [2/4] Installing dependencies...
    call npm install --silent
) else (
    echo [2/4] Dependencies OK
)

:: Check build
if not exist dist\index.js (
    echo [3/4] Building TypeScript...
    call npm run build --silent
) else (
    echo [3/4] Build OK
)

:: Check .env
if not exist .env (
    echo [!] .env not found, creating from .env.example...
    copy .env.example .env >nul 2>&1
    echo     ========================================================
    echo     [ATTENTION] Please edit .env with your configuration!
    echo     The gateway will start, but might fail without valid keys.
    echo     ========================================================
    timeout /t 5 >nul
)

:: Start
echo [4/4] Starting gateway...
echo.
echo ========================================
echo   Gateway Running
echo   Press Ctrl+C to stop
echo ========================================
echo.

call npm start
goto end

:: ============================================================
:: DEV - Development mode with ts-node
:: ============================================================
:dev
echo.
echo ========================================
echo   Development Mode
echo ========================================
echo.

cd /d "%SCRIPT_DIR%"

if not exist node_modules (
    echo Installing dependencies...
    call npm install --silent
)

if not exist .env (
    echo Creating .env from .env.example...
    copy .env.example .env >nul 2>&1
)

echo Starting in development mode...
echo Press Ctrl+C to stop
echo.

call npm run dev
goto end

:: ============================================================
:: BUILD - Compile TypeScript
:: ============================================================
:build
echo.
echo Building TypeScript...
cd /d "%SCRIPT_DIR%"

if not exist node_modules (
    call npm install --silent
)

call npm run build

if %ERRORLEVEL% equ 0 (
    echo.
    echo [OK] Build successful!
    echo     Output: dist\
) else (
    echo.
    echo [ERROR] Build failed!
)
goto end

:: ============================================================
:: CHECK - Health check
:: ============================================================
:check
echo.
echo ========================================
echo   Health Check
echo ========================================
echo.

cd /d "%SCRIPT_DIR%"

:: Node.js
where node >nul 2>&1
if %ERRORLEVEL% equ 0 (
    for /f "tokens=*" %%i in ('node -v') do set VER=%%i
    echo [OK] Node.js: !VER!
) else (
    echo [X] Node.js: Not installed
)

:: npm
where npm >nul 2>&1
if %ERRORLEVEL% equ 0 (
    for /f "tokens=*" %%i in ('npm -v') do set VER=%%i
    echo [OK] npm: !VER!
) else (
    echo [X] npm: Not installed
)

:: Dependencies
if exist node_modules (
    echo [OK] Dependencies: Installed
) else (
    echo [X] Dependencies: Not installed
)

:: .env
if exist .env (
    echo [OK] .env: Found
) else (
    echo [X] .env: Not found
)

:: Build
if exist dist\index.js (
    echo [OK] Build: Ready
) else (
    echo [X] Build: Not ready
)

echo.
goto end

:: ============================================================
:: INSTALL - Install dependencies
:: ============================================================
:install
echo Installing dependencies...
cd /d "%SCRIPT_DIR%"
call npm install

if %ERRORLEVEL% equ 0 (
    echo.
    echo [OK] Dependencies installed!
) else (
    echo.
    echo [ERROR] Failed to install dependencies!
)
goto end

:: ============================================================
:: STOP - Stop OpenCode Server
:: ============================================================
:stop
echo.
echo ========================================
echo   Stopping OpenCode Server
echo ========================================
echo.

cd /d "%SCRIPT_DIR%"

:: Read OpenCode port from .env
set "OPENCODE_PORT=4096"
for /f "tokens=2 delims==" %%a in ('findstr "OPENCODE_API_URL" .env 2^>nul') do (
    for /f "tokens=3 delims=:" %%b in ("%%a") do set "OPENCODE_PORT=%%b"
)
set "OPENCODE_PORT=%OPENCODE_PORT: =%"

:: Find and stop OpenCode process
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%OPENCODE_PORT%" ^| findstr "LISTENING"') do (
    echo Stopping process %%a on port %OPENCODE_PORT%...
    taskkill /PID %%a /F >nul 2>&1
    if %ERRORLEVEL% equ 0 (
        echo [OK] OpenCode Server stopped
    ) else (
        echo [ERROR] Failed to stop process %%a
    )
)

echo Done.
goto end

:: ============================================================
:: HELP - Show usage
:: ============================================================
:help
echo.
echo   OpenCode Gateway v2.0
echo.
echo   Usage: start.bat [command]
echo.
echo   Commands:
echo     (none)    One-click start (starts OpenCode + Gateway)
echo     run       One-click start (same as no argument)
echo     dev       Development mode with ts-node
echo     build     Build TypeScript
echo     check     Run health check
echo     install   Install dependencies
echo     stop      Stop OpenCode Server
echo     help      Show this help
echo.
echo   Examples:
echo     start.bat          # One-click start
echo     start.bat dev      # Development mode
echo     start.bat stop     # Stop OpenCode Server
echo.
goto end

:: ============================================================
:: END
:: ============================================================
:end
if "%MODE%"=="" pause