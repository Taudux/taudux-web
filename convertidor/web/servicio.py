#!/usr/bin/env python3
"""
servicio.py - API HTTP del convertidor PDF <-> Markdown.

Un solo endpoint, `POST /convertir`, que recibe el archivo y devuelve todo el
resultado en un JSON. La página no tiene que encadenar peticiones ni conocer
rutas del servidor.

La regla que manda aquí es la que le prometemos a la gente en la pantalla:
**no se guarda nada**. Cada petición trabaja en un directorio temporal propio
que se borra en un `finally`, pase lo que pase. No hay base de datos, no hay
disco persistente y no hay registro del contenido.

Ejecutar en local:
    python web/servicio.py
    # queda en http://localhost:8080

En Cloud Run lo levanta gunicorn (ver Dockerfile).
"""

import base64
import io
import json
import os
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

import pymupdf
from flask import Flask, jsonify, request

# El núcleo vive en la raíz del proyecto, un nivel arriba de web/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import md_to_pdf          # noqa: E402
import pdf_to_md          # noqa: E402


app = Flask(__name__)

# --------------------------------------------------------------------------- #
# Límites. Conservadores a propósito mientras el servicio es gratuito; suben
# cuando existan los planes de pago. Deben coincidir con los que la página
# anuncia: prometer un límite y aplicar otro es peor que no anunciarlo.
# --------------------------------------------------------------------------- #

MAX_PDF_BYTES = 20 * 1024 * 1024
MAX_MD_BYTES = 2 * 1024 * 1024
MAX_PAGINAS = 100

EXTENSIONES_MD = md_to_pdf.EXTENSIONES_MD

# Quién puede llamar al servicio desde el navegador.
ORIGENES = [
    "https://taudux.com",
    "https://www.taudux.com",
    "http://localhost:8766",
    "http://127.0.0.1:8766",
]

app.config["MAX_CONTENT_LENGTH"] = MAX_PDF_BYTES + 1024 * 1024


# --------------------------------------------------------------------------- #
# CORS. A mano, sin flask-cors: son tres cabeceras y una dependencia menos que
# mantener en la imagen.
# --------------------------------------------------------------------------- #

@app.after_request
def permitir_origen(respuesta):
    origen = request.headers.get("Origin")
    if origen in ORIGENES:
        respuesta.headers["Access-Control-Allow-Origin"] = origen
        respuesta.headers["Vary"] = "Origin"
        respuesta.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
        respuesta.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return respuesta


@app.route("/convertir", methods=["OPTIONS"])
def preflight():
    return ("", 204)


@app.get("/salud")
def salud():
    """Para el health check de Cloud Run."""
    return jsonify({"estado": "ok"})


# --------------------------------------------------------------------------- #
# Conversión
# --------------------------------------------------------------------------- #

def error(mensaje, codigo=400, clave=None):
    cuerpo = {"detalle": mensaje}
    if clave:
        cuerpo["error"] = clave
    return jsonify(cuerpo), codigo


@app.post("/convertir")
def convertir():
    subido = request.files.get("archivo")
    if not subido or not subido.filename:
        return error("No llegó ningún archivo.")

    nombre = Path(subido.filename).name
    extension = Path(nombre).suffix.lower()

    if extension not in (".pdf",) + tuple(EXTENSIONES_MD):
        return error(f"No reconocemos la extensión «{extension}». "
                     f"Sube un PDF o un archivo Markdown.")

    # Directorio propio por petición: aísla los archivos de dos conversiones
    # simultáneas y hace que borrar sea una sola llamada.
    trabajo = Path(tempfile.mkdtemp(prefix="convertidor-"))
    try:
        origen = trabajo / nombre
        subido.save(origen)
        peso = origen.stat().st_size

        if extension == ".pdf":
            if peso > MAX_PDF_BYTES:
                return error(f"El PDF pesa {peso // 1024 // 1024} MB y el "
                             f"límite es {MAX_PDF_BYTES // 1024 // 1024} MB.", 413)
            return convertir_pdf(origen, trabajo)

        if peso > MAX_MD_BYTES:
            return error(f"El Markdown pesa {peso // 1024} KB y el límite es "
                         f"{MAX_MD_BYTES // 1024} KB.", 413)
        return convertir_markdown(origen, trabajo)

    except Exception as e:
        app.logger.exception("fallo al convertir")
        return error(f"No se pudo procesar el archivo: {e}", 500)

    finally:
        # El `finally` es la promesa de privacidad hecha código: si esto no
        # corre, el archivo de alguien se queda en el disco del servidor.
        shutil.rmtree(trabajo, ignore_errors=True)


def convertir_pdf(origen: Path, trabajo: Path):
    """PDF -> Markdown."""
    with pymupdf.open(origen) as doc:
        paginas = doc.page_count
    if paginas > MAX_PAGINAS:
        return error(f"El PDF tiene {paginas} páginas y el límite es "
                     f"{MAX_PAGINAS}.", 413)

    salida = trabajo / "salida"
    resultado = pdf_to_md.convertir(origen, salida)

    if not resultado.ok:
        # El rechazo por PDF rasterizado no es un error del servicio: es una
        # respuesta prevista, y la página tiene una pantalla propia para ella.
        clave = ("rasterizado"
                 if resultado.diagnostico
                 and resultado.diagnostico.clase == pdf_to_md.RASTERIZADO
                 else "no_convertible")
        return error(resultado.motivo_rechazo, 422, clave)

    cuerpo = {
        "direccion": "pdf-a-md",
        "nombre": resultado.markdown.name,
        "tipo": "text/markdown",
        "contenido": resultado.markdown.read_text(encoding="utf-8"),
        "informe": resultado.informe.read_text(encoding="utf-8"),
        "fidelidad": resultado.fidelidad,
        "paginas": resultado.diagnostico.paginas,
        "tablas": resultado.tablas,
        "tablas_dudosas": resultado.tablas_dudosas,
        "imagenes": resultado.imagenes,
        "avisos": [
            {"tipo": a.tipo, "pagina": a.pagina, "detalle": a.detalle}
            for a in resultado.avisos
        ],
    }

    # Si hay imágenes, el .md solo no sirve: sus enlaces apuntan a assets/.
    # Se manda un zip con todo para que el documento llegue completo.
    assets = salida / "assets"
    if assets.exists() and any(assets.rglob("*")):
        cuerpo["zip_base64"] = base64.b64encode(
            empaquetar(salida, resultado)).decode("ascii")

    return jsonify(cuerpo)


def empaquetar(salida: Path, resultado) -> bytes:
    """Mete el .md, el informe y la carpeta assets en un zip en memoria."""
    memoria = io.BytesIO()
    with zipfile.ZipFile(memoria, "w", zipfile.ZIP_DEFLATED) as z:
        for archivo in salida.rglob("*"):
            if archivo.is_file():
                z.write(archivo, archivo.relative_to(salida))
    return memoria.getvalue()


def convertir_markdown(origen: Path, trabajo: Path):
    """Markdown -> PDF."""
    destino = trabajo / f"{origen.stem}.pdf"
    resultados = md_to_pdf.convertir_lote([(origen, destino)])
    resultado = resultados[0]

    if not resultado.ok:
        return error(resultado.error or "No se pudo generar el PDF.", 500)

    with pymupdf.open(destino) as doc:
        paginas = doc.page_count

    return jsonify({
        "direccion": "md-a-pdf",
        "nombre": destino.name,
        "tipo": "application/pdf",
        "contenido_base64": base64.b64encode(destino.read_bytes()).decode("ascii"),
        # Un PDF generado desde Markdown no pierde nada por el camino: la
        # fidelidad sólo baja si el propio conversor avisó de algo.
        "fidelidad": "media" if resultado.avisos else "alta",
        "paginas": paginas,
        "avisos": [
            {"tipo": "Aviso", "detalle": aviso} for aviso in resultado.avisos
        ],
    })


@app.errorhandler(413)
def demasiado_grande(_):
    return error(f"El archivo supera el límite de "
                 f"{MAX_PDF_BYTES // 1024 // 1024} MB.", 413)


if __name__ == "__main__":
    puerto = int(os.environ.get("PORT", 8080))
    print(f"Convertidor escuchando en http://localhost:{puerto}")
    app.run(host="0.0.0.0", port=puerto, debug=False)
