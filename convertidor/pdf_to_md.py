#!/usr/bin/env python3
"""
pdf_to_md.py - Convierte PDF a Markdown priorizando texto y tablas.

La conversión inversa no es simétrica: un PDF no guarda "esto es un título" ni
"esto es una tabla", sino glifos con coordenadas. La estructura hay que
inferirla, y a veces se infiere mal.

De ahí la regla que gobierna este módulo:

    El error más caro no es perder un elemento, es convertirlo mal y que
    parezca correcto.

Una tabla mal parseada con las cifras corridas es peor que ninguna tabla. Por
eso cada elemento cae en una de tres categorías explícitas:

    CONVERTIR  texto, títulos, listas, tablas
    EXTRAER    imágenes, diagramas y fórmulas -> archivo en assets/ + aviso
    DESCARTAR  encabezados, pies y numeración de página

Todo lo que se degrada deja rastro en dos sitios: un aviso visible en el punto
exacto del Markdown, y un informe de fidelidad aparte.

Limitaciones conocidas
----------------------
La detección de diagramas es heurística y está calibrada para **no dar falsos
positivos**, aun a costa de perder alguno. La razón es de diseño: si marcamos
como "diagrama" el fondo de cada cita y la cuadrícula de cada tabla, el usuario
deja de leer los avisos y el sistema entero pierde su valor. Un diagrama no
detectado sólo significa que no aparece su aviso; el texto de la página se
extrae igual.

Lo que este módulo **no** hace todavía:

  - OCR. Un PDF sin capa de texto se rechaza, no se intenta.
  - Orden de lectura en documentos a varias columnas.
  - Recuperar fórmulas como LaTeX ni diagramas como código.

Uso:
    python pdf_to_md.py <archivo.pdf | carpeta> [-o <carpeta_salida>]

Instalación:
    pip install pymupdf4llm
"""

import argparse
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

import pymupdf
import pymupdf4llm


# --------------------------------------------------------------------------- #
# Clasificación del PDF de entrada
# --------------------------------------------------------------------------- #

NATIVO = "nativo"            # tiene capa de texto: se puede convertir
MIXTO = "mixto"              # algunas páginas con texto, otras no
RASTERIZADO = "rasterizado"  # es una imagen: haría falta OCR

# Una página con menos caracteres que esto se considera sin texto útil.
MIN_CARACTERES_PAGINA = 50

# Por debajo de esta proporción de páginas con texto, el PDF se rechaza.
UMBRAL_RASTERIZADO = 0.20

# Una región de dibujo vectorial más pequeña que esto no merece extraerse.
# Baja a propósito: un flowchart de dos cajas ocupa menos del 1 % de la página,
# y con un umbral del 4 % se perdían los diagramas pequeños.
MIN_AREA_DIAGRAMA = 0.005    # 0.5 % de la página


@dataclass
class Aviso:
    """Algo que no se pudo convertir con fidelidad."""
    tipo: str
    pagina: int
    detalle: str

    def como_markdown(self) -> str:
        return f"> ⚠️ **{self.tipo}** — página {self.pagina}. {self.detalle}"


@dataclass
class Diagnostico:
    """Resultado del triaje previo. Decide si vale la pena intentar convertir."""
    clase: str
    paginas: int
    paginas_con_texto: int
    caracteres: int
    productor: str = ""

    @property
    def cobertura(self) -> float:
        return self.paginas_con_texto / self.paginas if self.paginas else 0.0

    @property
    def convertible(self) -> bool:
        return self.clase != RASTERIZADO

    def explicacion(self) -> str:
        if self.clase == NATIVO:
            return (f"PDF con capa de texto en las {self.paginas} páginas. "
                    f"Se puede convertir.")
        if self.clase == MIXTO:
            sin_texto = self.paginas - self.paginas_con_texto
            return (f"PDF mixto: {self.paginas_con_texto} de {self.paginas} "
                    f"páginas tienen texto. Las otras {sin_texto} son imágenes "
                    f"y saldrán vacías: harían falta OCR para recuperarlas.")
        return (f"Este PDF no tiene capa de texto: sus {self.paginas} páginas "
                f"son imágenes. Para software es una fotografía, no un "
                f"documento. Convertirlo requeriría OCR, que este conversor no "
                f"hace todavía.")


@dataclass
class ResultadoConversion:
    """Qué se produjo y qué se perdió."""
    origen: Path
    markdown: Path = None
    informe: Path = None
    diagnostico: Diagnostico = None
    avisos: list = field(default_factory=list)
    tablas: int = 0
    tablas_dudosas: int = 0
    imagenes: int = 0
    ok: bool = False
    motivo_rechazo: str = ""

    @property
    def fidelidad(self) -> str:
        """Una etiqueta honesta de cuánto confiar en el resultado."""
        if not self.ok:
            return "no convertido"
        if not self.avisos:
            return "alta"
        if self.tablas_dudosas or any(
                a.tipo.startswith(("Diagrama", "Página sin texto")) for a in self.avisos):
            return "media"
        return "buena"


# --------------------------------------------------------------------------- #
# Fase 0 - Triaje
# --------------------------------------------------------------------------- #

def diagnosticar(ruta_pdf: Path) -> Diagnostico:
    """
    Decide si el PDF tiene capa de texto antes de intentar nada.

    Es la comprobación más rentable del módulo: un PDF rasterizado no se puede
    convertir por más que se insista, y decirlo en dos segundos es mucho mejor
    que devolver un Markdown vacío al cabo de un minuto.
    """
    with pymupdf.open(ruta_pdf) as doc:
        paginas = doc.page_count
        productor = (doc.metadata or {}).get("producer", "") or ""

        con_texto = 0
        caracteres = 0
        for pagina in doc:
            texto = pagina.get_text().strip()
            caracteres += len(texto)
            if len(texto) >= MIN_CARACTERES_PAGINA:
                con_texto += 1

    cobertura = con_texto / paginas if paginas else 0.0
    if cobertura <= UMBRAL_RASTERIZADO:
        clase = RASTERIZADO
    elif cobertura < 0.95:
        clase = MIXTO
    else:
        clase = NATIVO

    return Diagnostico(clase, paginas, con_texto, caracteres, productor)


# --------------------------------------------------------------------------- #
# Fase 2 - Confianza de las tablas
# --------------------------------------------------------------------------- #

def evaluar_tabla(tabla) -> tuple:
    """
    Puntúa una tabla detectada. Devuelve (confiable: bool, motivos: [str]).

    No mide si la tabla "se ve bien", sino si su estructura es coherente: una
    tabla real tiene el mismo número de celdas por fila y pocas celdas vacías.
    Cuando eso no se cumple, casi siempre es que el detector agrupó texto que
    no era una tabla, o que perdió una columna por el camino.
    """
    motivos = []
    try:
        filas = tabla.extract()
    except Exception as e:
        return False, [f"no se pudo extraer: {e}"]

    if not filas:
        return False, ["la tabla salió vacía"]

    anchos = {len(f) for f in filas}
    if len(anchos) > 1:
        motivos.append(
            f"filas con distinto número de columnas ({sorted(anchos)})")

    if max(anchos) < 2:
        motivos.append("una sola columna: probablemente no es una tabla")

    celdas = [c for f in filas for c in f]
    vacias = sum(1 for c in celdas if c is None or not str(c).strip())
    if celdas and vacias / len(celdas) > 0.35:
        motivos.append(f"{round(100 * vacias / len(celdas))} % de celdas vacías")

    if len(filas) < 2:
        motivos.append("sólo una fila")

    return (not motivos), motivos


# --------------------------------------------------------------------------- #
# Fase 3 - Diagramas y dibujos vectoriales
# --------------------------------------------------------------------------- #

# Un trazo más fino que esto es una raya (borde de tabla, subrayado, filete),
# no una figura.
GROSOR_MINIMO_FIGURA = 4     # puntos

# Cuántas figuras (cajas, no rayas) hacen falta para considerar que hay un
# diagrama. Dos bastan: un flowchart mínimo es "A -> B".
MIN_FIGURAS_DIAGRAMA = 2

# Si la región abarca más que esto, es la página entera y no una figura.
MAX_AREA_DIAGRAMA = 0.80

# Qué proporción del texto de la página puede caer dentro de la región. Si la
# región contiene casi todo el texto, lo que hemos encontrado es la página y no
# una figura. Se mide en proporción y no en densidad por punto cuadrado porque
# la densidad depende del tamaño: en un diagrama pequeño las etiquetas la
# disparan y el filtro descartaba justo los diagramas que debía conservar.
MAX_PROPORCION_TEXTO = 0.5

# Qué parte de la región puede ocupar una sola forma. Por encima de esto se
# trata de un fondo (cita, bloque de código, recuadro) y no de un diagrama.
MAX_FRACCION_UNA_FORMA = 0.7


def en_banda_de_tabla(rect, tablas: list) -> bool:
    """
    ¿Este trazo forma parte de una tabla?

    No basta con mirar si cae dentro del rectángulo que devuelve `find_tables()`:
    ese rectángulo se ajusta al *texto* de las celdas, mientras que el relleno
    de color de las filas suele ser más ancho y sobresalir por los lados.
    Comprobado: en una tabla cuyo bbox era x=61..368, las bandas de color
    llegaban a x=545 y se escapaban del filtro.

    Por eso se compara la franja vertical: si el trazo vive a la altura de una
    tabla, es de la tabla.
    """
    for tabla in tablas:
        alto = rect.y1 - rect.y0
        if alto <= 0:
            continue
        solape = min(rect.y1, tabla.y1) - max(rect.y0, tabla.y0)
        if solape > 0.5 * alto:
            return True
    return False


def regiones_vectoriales(pagina, excluir: list = None) -> list:
    """
    Localiza zonas de dibujo vectorial que probablemente sean un diagrama,
    una gráfica o una fórmula.

    No se intenta convertirlas: como Markdown serían una invención. Se
    rasterizan y se enlazan, que es lo único honesto que se puede hacer.

    El filtrado es deliberadamente severo. Un aviso de más es tan dañino como
    uno de menos: si marcamos como "diagrama" los bordes de cada tabla, el
    usuario deja de leer los avisos y el sistema entero pierde su valor. Por eso
    se descartan (a) los trazos finos, que son rayas y no figuras, y (b) todo lo
    que caiga dentro de una tabla ya detectada.
    """
    excluir = excluir or []
    area_pagina = abs(pagina.rect)
    if not area_pagina:
        return []

    trazos, figuras = [], []
    for dibujo in pagina.get_drawings():
        rect = dibujo.get("rect")
        if not rect or rect.is_empty or rect.is_infinite:
            continue
        # ¿pertenece a una tabla? entonces es su cuadrícula o el relleno de sus
        # filas, no un diagrama.
        if en_banda_de_tabla(rect, excluir):
            continue
        trazos.append(rect)
        # Los trazos finos (conectores, filetes) cuentan para agrupar, pero no
        # como "figura": un diagrama necesita cajas, no sólo rayas.
        if rect.height >= GROSOR_MINIMO_FIGURA and rect.width >= GROSOR_MINIMO_FIGURA:
            figuras.append(rect)

    if len(figuras) < MIN_FIGURAS_DIAGRAMA:
        return []

    texto_pagina = len(pagina.get_text().strip())
    regiones = []
    for grupo in agrupar_rectangulos(trazos):
        # Un diagrama es un grupo de trazos vecinos, no todo lo que hay en la
        # página. Unirlo todo en un solo rectángulo hacía que un diagrama
        # pequeño se fundiera con los rellenos de las tablas y las citas, y el
        # resultado era "la página entera es un diagrama".
        dentro = [f for f in figuras if abs(f & grupo) > 0.5 * abs(f)]
        if len(dentro) < MIN_FIGURAS_DIAGRAMA:
            continue

        grupo &= pagina.rect
        if grupo.is_empty:
            continue

        # Si una sola forma cubre casi toda la región, no es un diagrama: es un
        # fondo con texto encima (una cita, un bloque de código, un recuadro
        # destacado). Un diagrama reparte su área entre varias formas.
        if max(abs(f) for f in dentro) > MAX_FRACCION_UNA_FORMA * abs(grupo):
            continue

        proporcion = abs(grupo) / area_pagina
        if proporcion < MIN_AREA_DIAGRAMA or proporcion > MAX_AREA_DIAGRAMA:
            continue

        # El discriminante decisivo: qué parte del texto de la página cae aquí
        # dentro. Un diagrama tiene etiquetas; una página tiene el documento.
        if texto_pagina:
            dentro = len(pagina.get_text("text", clip=grupo).strip())
            if dentro / texto_pagina > MAX_PROPORCION_TEXTO:
                continue

        regiones.append(grupo)

    return regiones


def agrupar_rectangulos(rects: list, margen: float = 18.0) -> list:
    """
    Agrupa rectángulos vecinos en regiones. Dos rectángulos caen en el mismo
    grupo si se tocan al ensancharlos `margen` puntos por cada lado.
    """
    grupos = []
    for rect in rects:
        crecido = pymupdf.Rect(rect) + (-margen, -margen, margen, margen)
        fusionados = [g for g in grupos if g.intersects(crecido)]

        if not fusionados:
            grupos.append(pymupdf.Rect(rect))
            continue

        # Absorbe todos los grupos que este rectángulo acaba de conectar
        unido = pymupdf.Rect(rect)
        for g in fusionados:
            unido |= g
            grupos.remove(g)
        grupos.append(unido)

    return grupos


# --------------------------------------------------------------------------- #
# Limpieza del Markdown que produce el extractor
# --------------------------------------------------------------------------- #

def limpiar_markdown(texto: str, carpeta_assets: Path, prefijo_relativo: str) -> str:
    """
    Corrige los defectos conocidos de la extracción automática.

    Son tres, y los tres se ven feo en cuanto abres el archivo: rutas de imagen
    absolutas (que sólo funcionan en esta computadora), títulos envueltos en
    negrita redundante, y viñetas vacías sobrantes de los glifos del PDF.
    """
    # 1. Rutas absolutas -> relativas al .md
    absoluta = str(carpeta_assets).replace("\\", "/")
    texto = texto.replace(absoluta + "/", prefijo_relativo + "/")
    texto = texto.replace(absoluta, prefijo_relativo)

    lineas = []
    for linea in texto.splitlines():
        linea = linea.rstrip()

        # 2. "# **Título**" -> "# Título"
        encabezado = re.match(r"^(#{1,6})\s+\*\*(.+?)\*\*\s*$", linea)
        if encabezado:
            linea = f"{encabezado.group(1)} {encabezado.group(2).strip()}"

        # 3. Viñetas y numeraciones vacías
        if re.match(r"^\s*([-*+]|\d+\.)\s*$", linea):
            continue

        lineas.append(linea)

    # 4. Nunca más de una línea en blanco seguida
    salida = []
    blancos = 0
    for linea in lineas:
        if linea.strip():
            blancos = 0
            salida.append(linea)
        else:
            blancos += 1
            if blancos < 2:
                salida.append("")

    return "\n".join(salida).strip()


def rasterizar(pagina, rect, destino: Path, dpi: int = 150) -> bool:
    """Guarda una región de la página como PNG."""
    try:
        destino.parent.mkdir(parents=True, exist_ok=True)
        pagina.get_pixmap(clip=rect, dpi=dpi).save(destino)
        return True
    except Exception:
        return False


# --------------------------------------------------------------------------- #
# Conversión
# --------------------------------------------------------------------------- #

def convertir(
    ruta_pdf: Path,
    carpeta_salida: Path = None,
    avisos_visibles: bool = True,
    dpi_imagenes: int = 150,
) -> ResultadoConversion:
    """
    Convierte un PDF a Markdown aplicando la política de fidelidad.

    avisos_visibles: si es True, los avisos se insertan como cita (visible al
    renderizar). Si es False, se insertan como comentario HTML.

    Devuelve un ResultadoConversion. Nunca lanza por un PDF malo: el motivo
    viene en `motivo_rechazo`.
    """
    ruta_pdf = Path(ruta_pdf)
    carpeta_salida = Path(carpeta_salida) if carpeta_salida else ruta_pdf.parent
    resultado = ResultadoConversion(origen=ruta_pdf)

    # --- Fase 0: triaje -----------------------------------------------------
    try:
        diagnostico = diagnosticar(ruta_pdf)
    except Exception as e:
        resultado.motivo_rechazo = f"No se pudo abrir el PDF: {e}"
        return resultado

    resultado.diagnostico = diagnostico

    if not diagnostico.convertible:
        resultado.motivo_rechazo = diagnostico.explicacion()
        return resultado

    carpeta_assets = carpeta_salida / "assets" / ruta_pdf.stem
    avisos = []

    # --- Fase 1: texto, títulos, listas y tablas ----------------------------
    try:
        paginas = pymupdf4llm.to_markdown(
            str(ruta_pdf),
            page_chunks=True,
            write_images=True,
            image_path=str(carpeta_assets),
            image_format="png",
            dpi=dpi_imagenes,
            # margins recorta encabezados y pies: son ruido repetido en cada
            # página que ensucia el Markdown sin aportar nada.
            margins=(0, 40, 0, 40),
            table_strategy="lines_strict",
            show_progress=False,
        )
    except Exception as e:
        resultado.motivo_rechazo = f"Falló la extracción: {e}"
        return resultado

    # --- Fases 2 y 3: auditar tablas y extraer diagramas --------------------
    partes = []
    with pymupdf.open(ruta_pdf) as doc:
        for indice, chunk in enumerate(paginas):
            numero = indice + 1
            pagina = doc[indice]
            texto_md = (chunk.get("text") or "").strip()
            avisos_pagina = []

            # Página sin texto dentro de un PDF mixto
            if len(pagina.get_text().strip()) < MIN_CARACTERES_PAGINA:
                avisos_pagina.append(Aviso(
                    "Página sin texto", numero,
                    "Es una imagen escaneada; su contenido no se recuperó. "
                    "Haría falta OCR."))

            # Tablas: se auditan con PyMuPDF, no se confía a ciegas
            rects_tablas = []
            for n, tabla in enumerate(pagina.find_tables().tables, start=1):
                resultado.tablas += 1
                rects_tablas.append(pymupdf.Rect(tabla.bbox))
                confiable, motivos = evaluar_tabla(tabla)
                if not confiable:
                    resultado.tablas_dudosas += 1
                    avisos_pagina.append(Aviso(
                        "Tabla de baja confianza", numero,
                        f"Tabla {n}: {'; '.join(motivos)}. "
                        f"Verifica las cifras contra el PDF original."))

            # Diagramas y fórmulas: se extraen, no se convierten. Se le pasan
            # las tablas ya detectadas para que no confunda su cuadrícula con
            # un diagrama.
            for n, region in enumerate(
                    regiones_vectoriales(pagina, rects_tablas), start=1):
                nombre = f"pagina-{numero:03d}-diagrama-{n}.png"
                if rasterizar(pagina, region, carpeta_assets / nombre, dpi_imagenes):
                    resultado.imagenes += 1
                    relativa = f"assets/{ruta_pdf.stem}/{nombre}"
                    avisos_pagina.append(Aviso(
                        "Diagrama no convertible", numero,
                        f"Se guardó como imagen: `{relativa}`"))
                    texto_md += f"\n\n![Diagrama de la página {numero}]({relativa})"

            if texto_md:
                partes.append(texto_md)

            for aviso in avisos_pagina:
                partes.append(
                    aviso.como_markdown() if avisos_visibles
                    else f"<!-- {aviso.tipo} (pág. {aviso.pagina}): {aviso.detalle} -->")
            avisos.extend(avisos_pagina)

    if carpeta_assets.exists():
        resultado.imagenes = len(list(carpeta_assets.glob("*.png")))
    resultado.avisos = avisos

    # --- Escribir la salida -------------------------------------------------
    carpeta_salida.mkdir(parents=True, exist_ok=True)
    resultado.markdown = carpeta_salida / f"{ruta_pdf.stem}.md"

    cuerpo = limpiar_markdown(
        "\n\n".join(partes),
        carpeta_assets.resolve(),
        f"assets/{ruta_pdf.stem}",
    )
    resultado.markdown.write_text(cuerpo + "\n", encoding="utf-8")

    # `ok` antes de componer el informe: la etiqueta de fidelidad lo consulta, y
    # al revés el informe salía siempre como "no convertido".
    resultado.ok = True

    resultado.informe = carpeta_salida / f"{ruta_pdf.stem}.informe.md"
    resultado.informe.write_text(componer_informe(resultado), encoding="utf-8")

    return resultado


def componer_informe(r: ResultadoConversion) -> str:
    """El informe de fidelidad: qué se convirtió, qué se degradó y dónde."""
    d = r.diagnostico
    lineas = [
        f"# Informe de conversión — {r.origen.name}",
        "",
        f"**Fidelidad: {r.fidelidad}**",
        "",
        "| | |",
        "|---|---|",
        f"| Origen | `{r.origen.name}` |",
        f"| Tipo de PDF | {d.clase} ({d.paginas_con_texto}/{d.paginas} páginas con texto) |",
        f"| Productor | {d.productor or '(no declarado)'} |",
        f"| Tablas encontradas | {r.tablas} |",
        f"| Tablas de baja confianza | {r.tablas_dudosas} |",
        f"| Imágenes extraídas | {r.imagenes} |",
        f"| Avisos | {len(r.avisos)} |",
        "",
        "## Qué se convirtió y qué no",
        "",
        "| Elemento | Política |",
        "|---|---|",
        "| Texto, títulos, listas | Convertido |",
        "| Tablas | Convertidas y verificadas; las dudosas van marcadas |",
        "| Imágenes | Extraídas a `assets/` y enlazadas |",
        "| Diagramas y fórmulas | **No convertidos**: extraídos como imagen |",
        "| Encabezados y pies | Descartados |",
        "",
    ]

    if r.avisos:
        lineas += ["## Avisos, por página", ""]
        for aviso in sorted(r.avisos, key=lambda a: a.pagina):
            lineas.append(f"- **Página {aviso.pagina}** — {aviso.tipo}: {aviso.detalle}")
        lineas.append("")
    else:
        lineas += ["## Avisos", "",
                   "Ninguno. No se detectó degradación en la conversión.", ""]

    lineas += [
        "---",
        "",
        "Generado por `pdf_to_md.py`. Las tablas marcadas como de baja "
        "confianza **deben verificarse contra el PDF original** antes de usar "
        "sus cifras.",
    ]
    return "\n".join(lineas)


# --------------------------------------------------------------------------- #
# Línea de comandos
# --------------------------------------------------------------------------- #

def main():
    parser = argparse.ArgumentParser(
        description="Convierte PDF a Markdown priorizando texto y tablas.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("entrada", type=Path,
                        help="Archivo .pdf o carpeta con varios")
    parser.add_argument("-o", "--output", type=Path, default=None,
                        help="Carpeta de salida (por defecto, la de entrada)")
    parser.add_argument("--comentarios", action="store_true",
                        help="Insertar los avisos como comentarios HTML "
                             "invisibles en vez de citas visibles")
    args = parser.parse_args()

    if not args.entrada.exists():
        print(f"Error: '{args.entrada}' no existe.", file=sys.stderr)
        sys.exit(1)

    if args.entrada.is_dir():
        pdfs = sorted(args.entrada.glob("*.pdf"))
        if not pdfs:
            print(f"No se encontraron PDFs en '{args.entrada}'.")
            sys.exit(0)
    else:
        pdfs = [args.entrada]

    salida = args.output or (args.entrada if args.entrada.is_dir()
                             else args.entrada.parent)

    print(f"Convirtiendo {len(pdfs)} PDF(s)...\n")
    convertidos = rechazados = 0

    for indice, pdf in enumerate(pdfs, start=1):
        print(f"[{indice}/{len(pdfs)}] {pdf.name}")
        r = convertir(pdf, salida, avisos_visibles=not args.comentarios)

        if not r.ok:
            rechazados += 1
            print(f"    RECHAZADO: {r.motivo_rechazo}\n")
            continue

        convertidos += 1
        print(f"    OK -> {r.markdown.name}  (fidelidad: {r.fidelidad})")
        print(f"    tablas: {r.tablas} ({r.tablas_dudosas} dudosas)  "
              f"imágenes: {r.imagenes}  avisos: {len(r.avisos)}")
        print(f"    informe -> {r.informe.name}\n")

    print("=" * 55)
    print(f"Convertidos: {convertidos}   Rechazados: {rechazados}")


if __name__ == "__main__":
    main()
