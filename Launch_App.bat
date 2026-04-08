@echo off
setlocal

echo Checking for Node.js...

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo Node.js not found. Installing Node.js...
    powershell -Command "Start-Process 'https://nodejs.org/dist/latest/node-v20.11.1-x64.msi' -Wait"
    echo Please complete the Node.js installer, then re-run this script.
    pause
    exit /b
)

echo Node.js is installed.

echo Installing Express...
call npm init -y >nul
call npm install express --save

echo Starting server.js...
node server.js

endlocal