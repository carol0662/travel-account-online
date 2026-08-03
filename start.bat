@echo off
chcp 65001 >nul
echo 正在启动多人旅游记账 APP（联网共享版）...
echo 启动后请在浏览器打开 http://localhost:3000
echo.
node --experimental-sqlite server.js
pause
