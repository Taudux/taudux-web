# Guía de uso

## Puesta en marcha (una sola vez)

### 1. Instalar las dependencias

```bash
cd convertidor
pip install -r requirements.txt
```

### 2. Instalar el navegador que genera el PDF

```bash
playwright install chromium
```

Descarga Chromium (~150 MB) en `%LOCALAPPDATA%\ms-playwright`. Solo se hace una
vez por computadora, no por proyecto.

### 3. Crear el acceso directo del Escritorio

```bash
powershell -ExecutionPolicy Bypass -File .\crear_acceso_directo.ps1
```

El script localiza `pythonw.exe` por su cuenta (funciona con pyenv) y crea
**"Markdown a PDF"** en el Escritorio. Vuelve a ejecutarlo si cambias la versión
de Python o mueves la carpeta del proyecto.

---

## Convertir un archivo

1. Doble clic en **Markdown a PDF** en el Escritorio.
2. `Agregar archivos…` y elige tu `.md`.
3. Decide dónde guardarlo:
   - **Junto al archivo original** — el PDF queda al lado del `.md`, con el mismo nombre.
   - **En esta carpeta** — todos los PDF van al mismo destino.
4. **Convertir a PDF**.

El registro inferior va marcando cada archivo. Al terminar se abre la carpeta de
salida (puedes desactivarlo en Opciones).

## Convertir muchos archivos

`Agregar carpeta…` carga de una vez todos los `.md` de una carpeta. Si la opción
**"incluir también sus subcarpetas"** está marcada, baja por todo el árbol.

La lista acumula: puedes agregar una carpeta, luego archivos sueltos de otro
lado, y convertir todo junto. Los duplicados se ignoran.

## Cambiar el diseño del PDF

En **Opciones → CSS personalizado**, elige un archivo `.css` y reemplazará por
completo la hoja de estilos por omisión.

Para partir de la actual: copia el bloque `DEFAULT_CSS` de
[`md_to_pdf.py`](../md_to_pdf.py) a un archivo nuevo y edita desde ahí. Las
reglas `@page` controlan tamaño y márgenes.

---

## Solución de problemas

### "No module named 'playwright'" o "No module named 'markdown'"

Faltan las dependencias:

```bash
pip install -r requirements.txt
```

### "Executable doesn't exist at …chrome.exe"

Falta el navegador:

```bash
playwright install chromium
```

### La ventana no abre al hacer doble clic

Ejecuta **`Markdown a PDF.bat`**, que sí muestra la consola y deja ver el error.

### Los diagramas Mermaid salen como texto plano

El bloque debe estar marcado exactamente como `mermaid`:

````markdown
```mermaid
flowchart LR
    A --> B
```
````

Si la sintaxis del diagrama tiene un error, Mermaid no lo renderiza y el
conversor sigue adelante tras 15 segundos de espera. Valida el diagrama en
<https://mermaid.live>.

### La primera conversión tarda mucho

Descarga `mermaid.min.js` (~3.3 MB) y `highlight.min.js` a
`%USERPROFILE%\.md_to_pdf_assets`. Las siguientes ya usan la caché y funcionan
sin conexión. Si la descarga falla, el programa te indica la URL para bajar el
archivo a mano.

### Un archivo falla y los demás sí se convierten

Es el comportamiento esperado: cada archivo se maneja por separado y el error
concreto aparece en el registro. El resumen final cuenta exitosos y fallidos.

### El PDF sale sin acentos o con caracteres raros

El archivo `.md` debe estar guardado en **UTF-8**. En VS Code se cambia desde la
barra inferior, con "Guardar con codificación".
