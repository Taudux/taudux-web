@echo off
REM Lanza la aplicacion mostrando la consola (util para ver errores).
REM Para el uso diario, usa el acceso directo del Escritorio.

cd /d "%~dp0"
python "app.py"

if errorlevel 1 (
    echo.
    echo La aplicacion termino con errores.
    pause
)
