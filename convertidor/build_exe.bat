@echo off
REM ---------------------------------------------------------------------------
REM build_exe.bat - Genera un ejecutable independiente con PyInstaller.
REM
REM Resultado:  dist\Markdown a PDF\Markdown a PDF.exe
REM
REM NOTA IMPORTANTE
REM   El .exe NO incluye el navegador Chromium (pesa ~150 MB y Playwright lo
REM   gestiona por su cuenta). El equipo donde se ejecute necesita haber corrido
REM   una vez:   playwright install chromium
REM
REM   Si solo lo vas a usar en esta computadora, no necesitas el .exe: basta con
REM   el acceso directo del Escritorio (crear_acceso_directo.ps1).
REM ---------------------------------------------------------------------------

cd /d "%~dp0"

echo Instalando PyInstaller si hace falta...
python -m pip install --quiet --upgrade pyinstaller
if errorlevel 1 goto :error

echo.
echo Compilando...
python -m PyInstaller ^
    --noconfirm ^
    --clean ^
    --windowed ^
    --name "Markdown a PDF" ^
    --collect-all playwright ^
    --collect-all markdown ^
    --icon "recursos\md-to-pdf.ico" ^
    app.py
if errorlevel 1 goto :error

echo.
echo ==========================================================
echo  Listo. El ejecutable esta en:
echo    dist\Markdown a PDF\Markdown a PDF.exe
echo ==========================================================
pause
exit /b 0

:error
echo.
echo La compilacion fallo.
pause
exit /b 1
