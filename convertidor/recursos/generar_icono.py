#!/usr/bin/env python3
"""
generar_icono.py - Crea el icono de la aplicación (recursos/md-to-pdf.ico).

Dibuja una hoja de documento con la marca "M↓" y una etiqueta PDF.
Solo hace falta ejecutarlo si quieres regenerar el icono.

Uso:
    python recursos/generar_icono.py

Requiere Pillow:  pip install pillow
"""

from pathlib import Path

from PIL import Image, ImageDraw

AZUL = (52, 152, 219)
AZUL_OSCURO = (41, 128, 185)
ROJO = (214, 51, 132)
BLANCO = (255, 255, 255)
GRIS = (236, 240, 241)

LIENZO = 512  # se dibuja grande y se reduce a cada tamaño del .ico


def dibujar(tam: int) -> Image.Image:
    img = Image.new("RGBA", (tam, tam), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    u = tam / 512  # unidad de escala

    # Hoja de documento con la esquina superior derecha doblada
    izq, arr = 96 * u, 40 * u
    der, aba = 416 * u, 472 * u
    dobles = 96 * u

    hoja = [
        (izq, arr),
        (der - dobles, arr),
        (der, arr + dobles),
        (der, aba),
        (izq, aba),
    ]
    d.polygon(hoja, fill=BLANCO)
    d.line(hoja + [hoja[0]], fill=AZUL_OSCURO, width=max(1, int(8 * u)))

    # El doblez de la esquina
    d.polygon(
        [(der - dobles, arr), (der - dobles, arr + dobles), (der, arr + dobles)],
        fill=GRIS,
        outline=AZUL_OSCURO,
        width=max(1, int(6 * u)),
    )

    # Banda azul: la "M" de Markdown con su flecha hacia abajo
    banda_arr, banda_aba = 150 * u, 268 * u
    d.rounded_rectangle(
        [(140 * u, banda_arr), (372 * u, banda_aba)],
        radius=16 * u,
        fill=AZUL,
    )

    # Trazo de la "M"
    g = max(1, int(20 * u))
    y_alto, y_bajo = 178 * u, 240 * u
    d.line(
        [(176 * u, y_bajo), (176 * u, y_alto), (212 * u, y_bajo),
         (248 * u, y_alto), (248 * u, y_bajo)],
        fill=BLANCO,
        width=g,
        joint="curve",
    )

    # Flecha hacia abajo, junto a la M
    x = 306 * u
    d.line([(x, y_alto), (x, y_bajo)], fill=BLANCO, width=g)
    d.polygon(
        [(x - 26 * u, y_bajo - 10 * u), (x + 26 * u, y_bajo - 10 * u), (x, y_bajo + 26 * u)],
        fill=BLANCO,
    )

    # Etiqueta PDF en rojo, abajo
    et_arr, et_aba = 320 * u, 420 * u
    d.rounded_rectangle(
        [(140 * u, et_arr), (372 * u, et_aba)],
        radius=16 * u,
        fill=ROJO,
    )

    # Las letras "PDF" dibujadas a trazos (sin depender de fuentes del sistema)
    gl = max(1, int(16 * u))
    cy_arr, cy_aba = 344 * u, 396 * u
    alto = cy_aba - cy_arr

    # P
    px = 172 * u
    d.line([(px, cy_arr), (px, cy_aba)], fill=BLANCO, width=gl)
    d.arc(
        [(px - alto / 4, cy_arr), (px + alto / 2, cy_arr + alto / 2)],
        start=-90, end=90, fill=BLANCO, width=gl,
    )

    # D
    dx = 246 * u
    d.line([(dx, cy_arr), (dx, cy_aba)], fill=BLANCO, width=gl)
    d.arc(
        [(dx - alto / 2, cy_arr), (dx + alto / 2, cy_aba)],
        start=-90, end=90, fill=BLANCO, width=gl,
    )

    # F
    fx = 312 * u
    d.line([(fx, cy_arr), (fx, cy_aba)], fill=BLANCO, width=gl)
    d.line([(fx, cy_arr), (fx + 40 * u, cy_arr)], fill=BLANCO, width=gl)
    d.line([(fx, (cy_arr + cy_aba) / 2), (fx + 30 * u, (cy_arr + cy_aba) / 2)],
           fill=BLANCO, width=gl)

    return img


def main():
    destino = Path(__file__).parent / "md-to-pdf.ico"

    base = dibujar(LIENZO)
    tamanos = [16, 24, 32, 48, 64, 128, 256]
    capas = [base.resize((t, t), Image.LANCZOS) for t in tamanos]

    capas[-1].save(destino, format="ICO", sizes=[(t, t) for t in tamanos])
    print(f"Icono generado: {destino}")


if __name__ == "__main__":
    main()
