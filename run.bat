@echo off
setlocal

cd /d "%~dp0"

set "PYTHON_EXE=%~dp0.venv-1\Scripts\python.exe"
if not exist "%PYTHON_EXE%" (
    set "PYTHON_EXE=C:\Windows\py.exe"
)

set "APP_URL=http://127.0.0.1:8000"

echo Starting Restaurant Agent...
start "Restaurant Agent Backend" cmd /k ""%PYTHON_EXE%" -m uvicorn restaurant_agent.app:app --host 127.0.0.1 --port 8000"

for /l %%i in (1,1,20) do (
    powershell -NoProfile -Command "$resp = Invoke-WebRequest -Uri '%APP_URL%/health' -UseBasicParsing -TimeoutSec 2; if ($resp.StatusCode -eq 200) { exit 0 }" >nul 2>&1
    if not errorlevel 1 goto ready
    ping 127.0.0.1 -n 2 >nul
)

:ready
start "" "%APP_URL%"

echo Restaurant Agent is running.
echo Open this URL if the browser did not open automatically:
echo %APP_URL%
echo.
echo Close the backend window to stop the server.

endlocal