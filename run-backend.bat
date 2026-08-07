@echo off
cd /d %~dp0
"C:\Windows\py.exe" -m uvicorn restaurant_agent.app:app --host 127.0.0.1 --port 8000
