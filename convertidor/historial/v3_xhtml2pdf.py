#!/usr/bin/env python3
"""
md_to_pdf.py - Convierte archivos Markdown (.md) a PDF con estilos bonitos.

Esta versión usa xhtml2pdf (Python puro, sin dependencias externas de sistema).
Funciona en Windows sin instalar GTK, Pango ni nada extra.

Uso:
    python md_to_pdf.py <carpeta_entrada> [-o <carpeta_salida>] [-r] [--css <archivo.css>]

Ejemplos:
    python md_to_pdf.py ./docs
    python md_to_pdf.py ./docs -o ./pdfs
    python md_to_pdf.py ./docs -r              # recursivo (incluye subcarpetas)
    python md_to_pdf.py ./docs --css mi_estilo.css

Instalación de dependencias:
    pip install markdown xhtml2pdf
"""

import argparse
import sys
from pathlib import Path

import markdown
from xhtml2pdf import pisa


# CSS optimizado para xhtml2pdf (subset de CSS soportado)
# xhtml2pdf no soporta todo el CSS moderno, pero sí lo esencial para PDFs bonitos
DEFAULT_CSS = """
@page {
    size: A4;
    margin: 2.5cm 2cm;
    @frame footer_frame {
        -pdf-frame-content: footer_content;
        left: 50pt; width: 512pt; top: 780pt; height: 40pt;
    }
}

body {
    font-family: Helvetica, Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.5;
    color: #2c3e50;
}

h1, h2, h3, h4, h5, h6 {
    font-family: Helvetica, Arial, sans-serif;
    color: #1a202c;
    margin-top: 18pt;
    margin-bottom: 8pt;
    font-weight: bold;
}

h1 {
    font-size: 24pt;
    color: #2c3e50;
    border-bottom: 3pt solid #3498db;
    padding-bottom: 5pt;
}

h2 {
    font-size: 18pt;
    color: #34495e;
    border-bottom: 1pt solid #bdc3c7;
    padding-bottom: 3pt;
}

h3 { font-size: 14pt; color: #34495e; }
h4 { font-size: 12pt; color: #34495e; }

p {
    margin-top: 6pt;
    margin-bottom: 6pt;
    text-align: justify;
}

a {
    color: #2980b9;
    text-decoration: none;
}

code {
    font-family: Courier, monospace;
    background-color: #f4f6f8;
    padding: 2pt 4pt;
    font-size: 11pt;
    color: #c0392b;
}

pre {
    background-color: #2c3e50;
    color: #ecf0f1;
    padding: 12pt;
    font-family: Courier, monospace;
    font-size: 11pt;
    line-height: 1.5;
    -pdf-keep-in-frame-mode: shrink;
}

pre code {
    background-color: #2c3e50;
    color: #ecf0f1;
    padding: 0;
    font-size: 11pt;
}

blockquote {
    border-left: 4pt solid #3498db;
    margin-left: 0;
    margin-right: 0;
    padding-left: 12pt;
    padding-top: 4pt;
    padding-bottom: 4pt;
    background-color: #ecf0f1;
    color: #555;
    font-style: italic;
}

table {
    border-collapse: collapse;
    width: 100%;
    margin-top: 10pt;
    margin-bottom: 10pt;
}

th, td {
    border: 1pt solid #bdc3c7;
    padding: 6pt 8pt;
    text-align: left;
}

th {
    background-color: #3498db;
    color: white;
    font-weight: bold;
}

ul, ol {
    margin-top: 5pt;
    margin-bottom: 5pt;
}

li {
    margin-top: 2pt;
    margin-bottom: 2pt;
}

hr {
    border: none;
    border-top: 1pt solid #bdc3c7;
    margin-top: 15pt;
    margin-bottom: 15pt;
}

img {
    max-width: 100%;
}

#footer_content {
    text-align: center;
    font-size: 9pt;
    color: #888;
}
"""


def convertir_md_a_pdf(archivo_md: Path, archivo_pdf: Path, css_str: str) -> bool:
    """Convierte un único archivo .md a .pdf."""
    try:
        # Leer el contenido del archivo markdown
        contenido_md = archivo_md.read_text(encoding="utf-8")

        # Convertir markdown a HTML con extensiones útiles
        html_body = markdown.markdown(
            contenido_md,
            extensions=[
                "extra",          # tablas, código con backticks, etc.
                "codehilite",     # resaltado de sintaxis
                "sane_lists",     # mejor manejo de listas
                "nl2br",          # saltos de línea como <br>
            ],
        )

        # Envolver en HTML completo con el CSS embebido
        html_completo = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>{archivo_md.stem}</title>
    <style>
{css_str}
    </style>
</head>
<body>
{html_body}
<div id="footer_content">Página <pdf:pagenumber> de <pdf:pagecount></div>
</body>
</html>"""

        # Generar PDF
        archivo_pdf.parent.mkdir(parents=True, exist_ok=True)

        with open(archivo_pdf, "wb") as f:
            resultado = pisa.CreatePDF(
                src=html_completo,
                dest=f,
                encoding="utf-8",
            )

        if resultado.err:
            print(f"  ✗ Errores al convertir {archivo_md.name}", file=sys.stderr)
            return False
        return True

    except Exception as e:
        print(f"  ✗ Error con {archivo_md.name}: {e}", file=sys.stderr)
        return False


def main():
    parser = argparse.ArgumentParser(
        description="Convierte archivos Markdown (.md) a PDF con estilos bonitos.",
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

    # Determinar carpeta de salida
    carpeta_salida = args.output if args.output else args.carpeta_entrada

    # Cargar CSS (personalizado o por defecto)
    if args.css:
        if not args.css.exists():
            print(f"Error: el archivo CSS '{args.css}' no existe.", file=sys.stderr)
            sys.exit(1)
        css_str = args.css.read_text(encoding="utf-8")
        print(f"Usando CSS personalizado: {args.css}")
    else:
        css_str = DEFAULT_CSS

    # Buscar archivos .md
    patron = "**/*.md" if args.recursive else "*.md"
    archivos_md = sorted(args.carpeta_entrada.glob(patron))

    if not archivos_md:
        print(f"No se encontraron archivos .md en '{args.carpeta_entrada}'"
              f"{' (recursivo)' if args.recursive else ''}.")
        sys.exit(0)

    print(f"Encontrados {len(archivos_md)} archivo(s) .md. Convirtiendo...\n")

    exitos = 0
    fallos = 0

    for archivo_md in archivos_md:
        # Mantener estructura de subcarpetas si es recursivo
        ruta_relativa = archivo_md.relative_to(args.carpeta_entrada)
        archivo_pdf = carpeta_salida / ruta_relativa.with_suffix(".pdf")

        print(f"-> {ruta_relativa} ... ", end="", flush=True)
        if convertir_md_a_pdf(archivo_md, archivo_pdf, css_str):
            print(f"OK -> {archivo_pdf.name}")
            exitos += 1
        else:
            fallos += 1

    print(f"\n{'='*50}")
    print(f"Completado: {exitos} exitoso(s), {fallos} fallido(s)")
    if exitos > 0:
        print(f"PDFs guardados en: {carpeta_salida.resolve()}")


if __name__ == "__main__":
    main()
