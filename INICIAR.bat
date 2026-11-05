@echo off
cd /d "%~dp0"
if not exist "package.json" (
  echo No se encontro package.json. Abre la carpeta correcta del proyecto.
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo Instalando dependencias por primera vez...
  call npm install
  if errorlevel 1 pause & exit /b 1
)
start "" http://localhost:3000
call npm start
pause
