@echo off
cd /d "%~dp0"
echo Starting AI Pharmacy OS...
start "" "%~dp0PharmacyOS.exe"
echo Server starting at http://localhost:5175
timeout /t 3 /nobreak >nul
start "" http://localhost:5175
