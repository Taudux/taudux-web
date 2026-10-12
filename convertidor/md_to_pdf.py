#!/usr/bin/env python3
"""
md_to_pdf.py - Convierte archivos Markdown (.md) a PDF con estilos bonitos,
                diagramas Mermaid renderizados y resaltado de sintaxis.

Esta versión usa Playwright (Chromium headless), lo que permite:
  - Renderizar diagramas Mermaid como imágenes
  - Resaltado de sintaxis profesional (estilo VS Code) con highlight.js
  - Soporte completo de CSS moderno

Este módulo es el núcleo del proyecto: expone `convertir_lote()`, que usan
tanto esta interfaz de línea de comandos como la aplicación de escritorio
(`app.py`).

Uso:
    python md_to_pdf.py <carpeta_entrada> [-o <carpeta_salida>] [-r] [--css <archivo.css>]

Instalación (una sola vez):
    pip install markdown playwright
    playwright install chromium

Ejemplos:
    python md_to_pdf.py ./docs
    python md_to_pdf.py ./docs -o ./pdfs
    python md_to_pdf.py ./docs -r              # recursivo (incluye subcarpetas)
"""

import argparse
import asyncio
import base64
import mimetypes
import re
import sys
import urllib.request
from pathlib import Path
from urllib.parse import unquote

import markdown
from playwright.async_api import async_playwright


# Extensiones que se consideran Markdown, en un solo lugar para que la búsqueda
# por carpeta y la selección de archivos sueltos nunca discrepen.
EXTENSIONES_MD = (".md", ".markdown", ".mdown", ".mkd")

# Carpeta donde se cachearán los assets (mermaid.js, highlight.js, etc.)
ASSETS_DIR = Path.home() / ".md_to_pdf_assets"

# URLs de los assets que necesitamos
ASSETS = {
    "mermaid.min.js": "https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.0/mermaid.min.js",
    "highlight.min.js": "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js",
    "vs2015.min.css": "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/vs2015.min.css",
}


class ErrorAssets(Exception):
    """No se pudieron obtener los assets (mermaid.js, highlight.js)."""


class Resultado:
    """
    Cómo le fue a un archivo. Sustituye al booleano de antes: un archivo puede
    convertirse y aun así haber perdido algo por el camino, y eso hay que poder
    contarlo.
    """

    def __init__(self, origen: Path, destino: Path, ok: bool,
                 avisos=None, error: str = None):
        self.origen = origen
        self.destino = destino
        self.ok = ok
        self.avisos = avisos or []
        self.error = error

    def __bool__(self):
        return self.ok


def asegurar_assets() -> dict:
    """
    Descarga los assets si no existen localmente, y devuelve un dict
    con el contenido de cada uno (para embeber en el HTML).

    Lanza ErrorAssets si algo falla. No termina el proceso: esta función la
    llaman también la interfaz gráfica y el servicio web, donde un sys.exit()
    dejaría la aplicación colgada sin explicación.
    """
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    contenidos = {}

    for nombre, url in ASSETS.items():
        ruta_local = ASSETS_DIR / nombre

        # Un archivo vacío o truncado (descarga interrumpida) no sirve y hay
        # que volver a bajarlo; si no, la caché queda envenenada para siempre.
        if ruta_local.exists() and ruta_local.stat().st_size < 1024:
            ruta_local.unlink()

        if not ruta_local.exists():
            print(f"  Descargando {nombre} (primera vez)...", flush=True)
            # Se descarga a un archivo temporal y sólo al terminar se renombra,
            # para que nunca quede un archivo a medias con el nombre bueno.
            temporal = ruta_local.with_suffix(ruta_local.suffix + ".parcial")
            try:
                urllib.request.urlretrieve(url, temporal)
                temporal.replace(ruta_local)
            except Exception as e:
                temporal.unlink(missing_ok=True)
                raise ErrorAssets(
                    f"No se pudo descargar {nombre}.\n"
                    f"Revisa tu conexión a internet, o baja el archivo a mano desde:\n"
                    f"  {url}\n"
                    f"y guárdalo en:\n"
                    f"  {ruta_local}\n"
                    f"Detalle: {e}"
                ) from e

        contenidos[nombre] = ruta_local.read_text(encoding="utf-8")

    return contenidos


# CSS moderno con tema oscuro para los bloques de código (al estilo VS Code)
DEFAULT_CSS = """
@page {
    size: A4;
    margin: 2cm 1.8cm;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.6;
    color: #2c3e50;
    margin: 0;
    padding: 0;
}

h1, h2, h3, h4, h5, h6 {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    color: #1a202c;
    margin-top: 1.4em;
    margin-bottom: 0.5em;
    page-break-after: avoid;
    font-weight: 600;
}

h1 {
    font-size: 26pt;
    color: #2c3e50;
    border-bottom: 3px solid #3498db;
    padding-bottom: 0.3em;
}

h2 {
    font-size: 20pt;
    color: #34495e;
    border-bottom: 1px solid #bdc3c7;
    padding-bottom: 0.2em;
}

h3 { font-size: 16pt; color: #34495e; }
h4 { font-size: 13pt; color: #34495e; }

p {
    margin: 0.7em 0;
    text-align: justify;
}

a {
    color: #2980b9;
    text-decoration: none;
}

/* Código inline */
:not(pre) > code {
    font-family: 'Cascadia Code', 'Fira Code', 'Consolas', 'Menlo', monospace;
    background-color: #f1f3f5;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.9em;
    color: #d63384;
    border: 1px solid #e9ecef;
}

/* Bloques de código - estilo VS Code Dark+ */
pre {
    background-color: #1e1e1e;
    border-radius: 8px;
    padding: 16px 18px;
    overflow-x: auto;
    line-height: 1.5;
    page-break-inside: avoid;
    border: 1px solid #333;
    margin: 1em 0;
}

pre code {
    font-family: 'Cascadia Code', 'Fira Code', 'Consolas', 'Menlo', 'Courier New', monospace;
    font-size: 10.5pt;
    color: #d4d4d4;
    background: transparent !important;
    padding: 0;
    border: none;
    line-height: 1.5;
}

/* Highlight.js - tema VS Code Dark+ */
.hljs { color: #d4d4d4; background: #1e1e1e; }
.hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-section, .hljs-link { color: #569cd6; }
.hljs-function .hljs-keyword { color: #569cd6; }
.hljs-subst { color: #d4d4d4; }
.hljs-string, .hljs-title, .hljs-name, .hljs-type, .hljs-attribute, .hljs-symbol, .hljs-bullet, .hljs-built_in, .hljs-addition, .hljs-variable, .hljs-template-tag, .hljs-template-variable { color: #ce9178; }
.hljs-comment, .hljs-quote, .hljs-deletion, .hljs-meta { color: #6a9955; font-style: italic; }
.hljs-number { color: #b5cea8; }
.hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-title, .hljs-section, .hljs-doctag, .hljs-type, .hljs-name, .hljs-strong { font-weight: normal; }
.hljs-emphasis { font-style: italic; }
.hljs-attr { color: #9cdcfe; }
.hljs-property { color: #9cdcfe; }
.hljs-punctuation { color: #d4d4d4; }
.hljs-tag { color: #569cd6; }
.hljs-params { color: #9cdcfe; }

/* JSON específico */
.language-json .hljs-attr { color: #9cdcfe; }
.language-json .hljs-string { color: #ce9178; }
.language-json .hljs-number { color: #b5cea8; }
.language-json .hljs-literal { color: #569cd6; }
.language-json .hljs-punctuation { color: #d4d4d4; }

blockquote {
    border-left: 4px solid #3498db;
    margin: 1em 0;
    padding: 0.5em 1em;
    background-color: #ecf0f1;
    color: #555;
    font-style: italic;
}

table {
    border-collapse: collapse;
    width: 100%;
    margin: 1em 0;
    page-break-inside: avoid;
}

th, td {
    border: 1px solid #bdc3c7;
    padding: 0.5em 0.8em;
    text-align: left;
}

th {
    background-color: #3498db;
    color: white;
    font-weight: 600;
}

tr:nth-child(even) {
    background-color: #f8f9fa;
}

ul, ol {
    margin: 0.5em 0;
    padding-left: 2em;
}

li {
    margin: 0.3em 0;
}

hr {
    border: none;
    border-top: 2px solid #bdc3c7;
    margin: 2em 0;
}

img {
    max-width: 100%;
    height: auto;
}

/* Diagramas Mermaid */
.mermaid {
    text-align: center;
    margin: 1.5em 0;
    page-break-inside: avoid;
}

.mermaid svg {
    max-width: 100%;
    height: auto;
}
"""


# HTML template con Mermaid.js y highlight.js incluidos vía CDN
HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    {base}
    <title>{title}</title>
    <style>
{hljs_css}
    </style>
    <style>
{css}
    </style>
    <script>
{hljs_js}
    </script>
    <script>
{mermaid_js}
    </script>
</head>
<body>
{body}
<script>
    // Inicializar Mermaid
    if (typeof mermaid !== 'undefined') {{
        mermaid.initialize({{
            startOnLoad: true,
            theme: 'base',
            themeVariables: {{
                primaryColor: '#fef9e7',
                primaryTextColor: '#2c3e50',
                primaryBorderColor: '#34495e',
                lineColor: '#7f8c8d',
                secondaryColor: '#ecf0f1',
                tertiaryColor: '#fff'
            }},
            flowchart: {{
                useMaxWidth: true,
                htmlLabels: true,
                curve: 'basis'
            }}
        }});
    }}

    // Aplicar resaltado de sintaxis a todos los bloques de código (excepto mermaid)
    if (typeof hljs !== 'undefined') {{
        document.querySelectorAll('pre code:not(.language-mermaid)').forEach((block) => {{
            hljs.highlightElement(block);
        }});
    }}
</script>
</body>
</html>"""


def procesar_mermaid(html: str) -> str:
    """
    Convierte bloques <pre><code class="language-mermaid">...</code></pre>
    en <div class="mermaid">...</div> para que Mermaid.js los renderice.
    """
    patron = re.compile(
        r'<pre><code class="language-mermaid">(.*?)</code></pre>',
        re.DOTALL,
    )

    def reemplazar(match):
        codigo = match.group(1)
        # Decodificar entidades HTML básicas
        codigo = (codigo
                  .replace('&lt;', '<')
                  .replace('&gt;', '>')
                  .replace('&amp;', '&')
                  .replace('&quot;', '"')
                  .replace('&#39;', "'"))
        return f'<div class="mermaid">{codigo}</div>'

    return patron.sub(reemplazar, html)


# Pie de página con el número de página. Chromium reemplaza las clases
# pageNumber y totalPages por los valores reales al imprimir.
PIE_PAGINA = """
<div style="width:100%; font-size:8pt; color:#7f8c8d;
            font-family:-apple-system,'Segoe UI',Arial,sans-serif;
            padding:0 1.8cm; text-align:center;">
    <span class="pageNumber"></span> / <span class="totalPages"></span>
</div>
"""

ENCABEZADO_VACIO = "<div></div>"


# Tope por imagen. Una imagen enorme incrustada en base64 hincha el HTML un 33 %
# y puede tumbar al navegador; más vale avisar y dejarla fuera.
MAX_IMAGEN_BYTES = 25 * 1024 * 1024

_PATRON_IMG = re.compile(r'(<img\b[^>]*?\bsrc=")([^"]+)(")', re.IGNORECASE)


def incrustar_imagenes(html: str, carpeta_base: Path, avisos: list) -> str:
    """
    Sustituye las rutas de imágenes locales por su contenido en base64.

    Hace falta porque una página creada con set_content() tiene origen opaco y
    Chromium le niega la lectura de archivos locales: sin esto, toda imagen del
    documento sale rota. Incrustarlas además deja el HTML autocontenido, que es
    justo lo que necesita el servicio web, donde no hay carpeta de origen.
    """
    remotas = []

    def reemplazar(match):
        prefijo, src, sufijo = match.groups()

        if src.startswith("data:"):
            return match.group(0)

        if src.startswith(("http://", "https://")):
            remotas.append(src)
            return match.group(0)

        # Ruta local: puede venir con %20 y demás escapes de URL
        ruta = Path(unquote(src.split("?", 1)[0].split("#", 1)[0]))
        if not ruta.is_absolute():
            ruta = carpeta_base / ruta

        try:
            if not ruta.is_file():
                avisos.append(f"Imagen no encontrada, saldrá rota: {src}")
                return match.group(0)

            if ruta.stat().st_size > MAX_IMAGEN_BYTES:
                avisos.append(
                    f"Imagen demasiado grande ({ruta.stat().st_size // 1024 // 1024} MB), "
                    f"no se incrustó: {src}")
                return match.group(0)

            datos = ruta.read_bytes()
        except OSError as e:
            avisos.append(f"No se pudo leer la imagen {src}: {e}")
            return match.group(0)

        tipo = mimetypes.guess_type(ruta.name)[0] or "image/png"
        b64 = base64.b64encode(datos).decode("ascii")
        return f"{prefijo}data:{tipo};base64,{b64}{sufijo}"

    html = _PATRON_IMG.sub(reemplazar, html)

    if remotas:
        avisos.append(
            f"{len(remotas)} imagen(es) apuntan a internet y la red está "
            f"bloqueada: saldrán rotas. Descárgalas junto al documento.")

    return html


async def convertir_md_a_pdf(
    archivo_md: Path,
    archivo_pdf: Path,
    css_str: str,
    assets: dict,
    browser,
    permitir_red: bool = False,
) -> Resultado:
    """
    Convierte un único archivo .md a .pdf usando Playwright.

    permitir_red: si es False (lo normal), se bloquea cualquier petición que no
    sea a un archivo local. Evita que un .md ajeno haga que el navegador salga
    a internet, y de paso hace la conversión más rápida y predecible.

    Devuelve un Resultado con los avisos de lo que se haya degradado.
    """
    avisos = []
    page = None
    try:
        # Leer el contenido del archivo markdown
        contenido_md = archivo_md.read_text(encoding="utf-8")

        # Convertir markdown a HTML
        html_body = markdown.markdown(
            contenido_md,
            extensions=[
                "extra",          # tablas, código con backticks, etc.
                "fenced_code",    # bloques de código con ```
                "sane_lists",     # mejor manejo de listas
            ],
        )

        # Procesar bloques de Mermaid: convertirlos en divs especiales
        html_body = procesar_mermaid(html_body)

        # Incrustar las imágenes locales como data: URI (ver incrustar_imagenes)
        html_body = incrustar_imagenes(html_body, archivo_md.parent.resolve(), avisos)

        # <base> por corrección: fija contra qué resolver cualquier URL relativa
        # que quede (por ejemplo, dentro de HTML crudo escrito a mano en el .md).
        base = f'<base href="{archivo_md.parent.resolve().as_uri()}/">'

        # Armar HTML completo con los assets embebidos
        html_completo = HTML_TEMPLATE.format(
            title=archivo_md.stem,
            base=base,
            css=css_str,
            body=html_body,
            hljs_css=assets["vs2015.min.css"],
            hljs_js=assets["highlight.min.js"],
            mermaid_js=assets["mermaid.min.js"],
        )

        # Crear PDF con Playwright
        archivo_pdf.parent.mkdir(parents=True, exist_ok=True)

        page = await browser.new_page()

        if not permitir_red:
            async def solo_local(route, request):
                if request.url.startswith(("file://", "data:", "blob:", "about:")):
                    await route.continue_()
                else:
                    await route.abort()

            await page.route("**/*", solo_local)

        # 'load' en vez de 'networkidle': con todo embebido no hay red que
        # esperar, y networkidle añadía medio segundo por archivo sin motivo.
        await page.set_content(html_completo, wait_until="load")

        # Esperar a que Mermaid termine de renderizar (si hay diagramas)
        if 'class="mermaid"' in html_body:
            try:
                await page.wait_for_function(
                    "document.querySelectorAll('.mermaid svg').length === "
                    "document.querySelectorAll('.mermaid').length",
                    timeout=8000,
                )
            except Exception:
                avisos.append(
                    "Algún diagrama Mermaid no terminó de renderizarse "
                    "(se agotaron los 8 s de espera)."
                )

            # Mermaid no lanza excepción cuando la sintaxis está mal: dibuja un
            # cartel de error dentro del SVG. Hay que ir a buscarlo.
            rotos = await page.evaluate(
                """() => [...document.querySelectorAll('.mermaid')]
                        .filter(d => !d.querySelector('svg')
                                  || /Syntax error/i.test(d.textContent)).length"""
            )
            if rotos:
                avisos.append(
                    f"{rotos} diagrama(s) Mermaid con error de sintaxis: "
                    f"en el PDF aparecerán como 'Syntax error in text'."
                )

        # Margen para que las fuentes web y los SVG acaben de asentarse
        await page.wait_for_timeout(200)

        await page.pdf(
            display_header_footer=True,
            header_template=ENCABEZADO_VACIO,
            footer_template=PIE_PAGINA,
            path=str(archivo_pdf),
            format="A4",
            margin={"top": "2cm", "bottom": "2cm", "left": "1.8cm", "right": "1.8cm"},
            print_background=True,
        )
        return Resultado(archivo_md, archivo_pdf, True, avisos)

    except Exception as e:
        return Resultado(archivo_md, archivo_pdf, False, avisos, error=str(e))

    finally:
        # Siempre, incluso si page.pdf() falló: una pestaña que no se cierra se
        # queda con su memoria tomada durante todo el lote.
        if page is not None:
            try:
                await page.close()
            except Exception:
                pass


async def _convertir_pares_async(pares: list, css_str: str, assets: dict,
                                 progreso, cancelado=None):
    """Procesa todos los pares (origen, destino) usando una única instancia de Chromium."""
    resultados = []
    total = len(pares)

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        try:
            for indice, (archivo_md, archivo_pdf) in enumerate(pares, start=1):
                if cancelado is not None and cancelado():
                    break

                resultado = await convertir_md_a_pdf(
                    archivo_md, archivo_pdf, css_str, assets, browser)
                resultados.append(resultado)

                if progreso:
                    progreso(indice, total, resultado)
        finally:
            await browser.close()

    return resultados


def convertir_lote(pares: list, css_str: str = None, progreso=None, cancelado=None):
    """
    Convierte una lista de pares (ruta_md, ruta_pdf) en una sola pasada.

    Es el punto de entrada que comparten la CLI, la aplicación de escritorio y
    el servicio web.

    pares     : lista de tuplas (Path del .md, Path del .pdf a generar)
    css_str   : CSS a aplicar; si es None se usa DEFAULT_CSS
    progreso  : callable opcional (indice, total, Resultado) que se invoca
                después de cada archivo, para reportar avance
    cancelado : callable opcional sin argumentos; si devuelve True entre dos
                archivos, el lote se detiene ahí

    Devuelve la lista de Resultado. Lanza ErrorAssets si no hay assets.
    """
    if css_str is None:
        css_str = DEFAULT_CSS

    assets = asegurar_assets()
    return asyncio.run(
        _convertir_pares_async(pares, css_str, assets, progreso, cancelado))


def buscar_markdown(carpeta: Path, recursivo: bool = False) -> list:
    """
    Devuelve los archivos Markdown de una carpeta, ordenados.

    Reconoce las cuatro extensiones habituales, no sólo .md, para que
    "Agregar carpeta" encuentre lo mismo que acepta "Agregar archivos".
    """
    encontrados = []
    for extension in EXTENSIONES_MD:
        patron = f"**/*{extension}" if recursivo else f"*{extension}"
        encontrados.extend(carpeta.glob(patron))
    return sorted(set(encontrados))


def destinos_sin_colision(archivos: list, carpeta_salida: Path) -> list:
    """
    Arma los pares (origen, destino) cuando todo va a una misma carpeta,
    garantizando que dos archivos distintos nunca compartan destino.

    Sin esto, `a/README.md` y `b/README.md` producían un solo README.pdf y el
    segundo pisaba al primero en silencio.
    """
    pares = []
    usados = set()

    for md in archivos:
        destino = carpeta_salida / f"{md.stem}.pdf"
        if destino in usados:
            # Se desambigua con el nombre de la carpeta de origen, y si aún así
            # choca, con un contador.
            destino = carpeta_salida / f"{md.stem} ({md.parent.name}).pdf"
            contador = 2
            while destino in usados:
                destino = carpeta_salida / f"{md.stem} ({md.parent.name}) {contador}.pdf"
                contador += 1
        usados.add(destino)
        pares.append((md, destino))

    return pares


def main():
    parser = argparse.ArgumentParser(
        description="Convierte archivos Markdown (.md) a PDF con Mermaid y syntax highlighting.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "carpeta_entrada",
        type=Path,
        help="Carpeta que contiene los archivos .md a convertir",
    )
    parser.add_argument(
        "-o", "--output",
        type=Path,
        default=None,
        help="Carpeta de salida para los PDFs (por defecto: misma que la de entrada)",
    )
    parser.add_argument(
        "-r", "--recursive",
        action="store_true",
        help="Buscar archivos .md de forma recursiva en subcarpetas",
    )
    parser.add_argument(
        "--css",
        type=Path,
        default=None,
        help="Ruta a un archivo CSS personalizado (opcional)",
    )

    args = parser.parse_args()

    # Validar carpeta de entrada
    if not args.carpeta_entrada.exists():
        print(f"Error: la carpeta '{args.carpeta_entrada}' no existe.", file=sys.stderr)
        sys.exit(1)
    if not args.carpeta_entrada.is_dir():
        print(f"Error: '{args.carpeta_entrada}' no es una carpeta.", file=sys.stderr)
        sys.exit(1)

    carpeta_salida = args.output if args.output else args.carpeta_entrada

    # Cargar CSS
    if args.css:
        if not args.css.exists():
            print(f"Error: el archivo CSS '{args.css}' no existe.", file=sys.stderr)
            sys.exit(1)
        css_str = args.css.read_text(encoding="utf-8")
        print(f"Usando CSS personalizado: {args.css}")
    else:
        css_str = DEFAULT_CSS

    # Buscar archivos .md
    archivos_md = buscar_markdown(args.carpeta_entrada, args.recursive)

    if not archivos_md:
        print(f"No se encontraron archivos .md en '{args.carpeta_entrada}'"
              f"{' (recursivo)' if args.recursive else ''}.")
        sys.exit(0)

    print(f"Encontrados {len(archivos_md)} archivo(s) .md. Convirtiendo...\n")

    # Armar los pares (origen, destino) conservando la estructura de subcarpetas
    pares = [
        (
            md,
            carpeta_salida / md.relative_to(args.carpeta_entrada).with_suffix(".pdf"),
        )
        for md in archivos_md
    ]

    def reportar(indice, total, resultado):
        relativa = resultado.origen.relative_to(args.carpeta_entrada)
        estado = f"OK -> {resultado.destino.name}" if resultado.ok else "FALLO"
        print(f"[{indice}/{total}] {relativa} ... {estado}")
        if resultado.error:
            print(f"        error: {resultado.error}", file=sys.stderr)
        for aviso in resultado.avisos:
            print(f"        aviso: {aviso}")

    try:
        resultados = convertir_lote(pares, css_str, progreso=reportar)
    except ErrorAssets as e:
        print(f"\nError: {e}", file=sys.stderr)
        sys.exit(1)

    exitos = sum(1 for r in resultados if r.ok)
    fallos = len(resultados) - exitos
    con_avisos = sum(1 for r in resultados if r.avisos)

    print(f"\n{'='*50}")
    print(f"Completado: {exitos} exitoso(s), {fallos} fallido(s)")
    if con_avisos:
        print(f"{con_avisos} archivo(s) se convirtieron con avisos (ver arriba).")
    if exitos > 0:
        print(f"PDFs guardados en: {carpeta_salida.resolve()}")


if __name__ == "__main__":
    main()
