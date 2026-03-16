@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"

where vsce >nul 2>&1
if %errorlevel% neq 0 (
    echo [INFO] Installing vsce...
    npm install -g @vscode/vsce
)

call vsce package
if %errorlevel% neq 0 (
    echo [ERROR] Packaging failed.
    exit /b 1
)

for /f "delims=" %%f in ('dir /b /o-d *.vsix 2^>nul') do (
    echo [OK] %%f
    goto :eof
)
