@echo off
setlocal

set SCRIPT_DIR=%~dp0
if "%GAME_DIR%"=="" (
    echo Set GAME_DIR to your Diablo II install directory
    echo   set GAME_DIR=C:\path\to\diablo2
    exit /b 1
)

:: Build
zig build -Doptimize=ReleaseSmall
if errorlevel 1 exit /b 1

:: Kill previous instance
taskkill /f /im Game.exe 2>nul

:: Clear log
del /q "%GAME_DIR%\aether_log.txt" 2>nul

:: Copy Lua scripts
if not exist "%GAME_DIR%\aether\scripts" mkdir "%GAME_DIR%\aether\scripts"
copy /y "%SCRIPT_DIR%scripts\*.lua" "%GAME_DIR%\aether\scripts\" >nul 2>&1

:: Copy DLLs
copy /y "%SCRIPT_DIR%zig-out\bin\Aether.dll" "%GAME_DIR%\" >nul
copy /y "%SCRIPT_DIR%zig-out\bin\dbghelp.dll" "%GAME_DIR%\" >nul

:: Launch
cd /d "%GAME_DIR%"
start "" Game.exe -w

timeout /t 3 >nul
echo === aether_log.txt ===
type "%GAME_DIR%\aether_log.txt" 2>nul || echo (no log)
