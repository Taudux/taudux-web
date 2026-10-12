<#
    crear_acceso_directo.ps1

    Crea (o actualiza) un acceso directo "Markdown a PDF" en el Escritorio que
    abre la aplicación sin ventana de consola.

    Uso:
        powershell -ExecutionPolicy Bypass -File .\crear_acceso_directo.ps1
#>

$ErrorActionPreference = "Stop"

$proyecto = Split-Path -Parent $MyInvocation.MyCommand.Path
$app      = Join-Path $proyecto "app.py"
$icono    = Join-Path $proyecto "recursos\md-to-pdf.ico"

if (-not (Test-Path $app)) {
    throw "No se encontró app.py en $proyecto"
}

# --- Localizar pythonw.exe (el intérprete sin consola) ---------------------
# `python` puede ser un shim (pyenv), así que le preguntamos al propio
# intérprete dónde vive realmente.
$pythonw = & python -c "import sys, os; print(os.path.join(os.path.dirname(sys.executable), 'pythonw.exe'))"

if (-not (Test-Path $pythonw)) {
    throw "No se encontró pythonw.exe. Se esperaba en: $pythonw"
}

Write-Host "Interprete : $pythonw"
Write-Host "Aplicacion : $app"

# --- Crear el acceso directo ----------------------------------------------
$escritorio = [Environment]::GetFolderPath("Desktop")
$destino    = Join-Path $escritorio "Markdown a PDF.lnk"

$shell    = New-Object -ComObject WScript.Shell
$atajo    = $shell.CreateShortcut($destino)

$atajo.TargetPath       = $pythonw
$atajo.Arguments        = "`"$app`""
$atajo.WorkingDirectory = $proyecto
$atajo.Description      = "Convierte archivos Markdown (.md) a PDF"
$atajo.WindowStyle      = 1

if (Test-Path $icono) {
    $atajo.IconLocation = "$icono,0"
}

$atajo.Save()

Write-Host ""
Write-Host "Listo. Acceso directo creado en:" -ForegroundColor Green
Write-Host "  $destino"
