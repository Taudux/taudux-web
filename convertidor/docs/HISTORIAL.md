# Historial del proyecto

## Las cuatro versiones del motor de PDF

Todo el desarrollo original ocurrió el **22 de mayo de 2026**, en poco más de
media hora. Cada versión cambió el motor que produce el PDF:

| # | Hora | Motor | Estado | Dónde está |
|---|------|-------|--------|------------|
| 1 | ~14:47 | **WeasyPrint 68.1** | Perdida | Sobrevive solo su salida: `ejemplos/ejemplo_resultado.pdf` |
| 2 | 14:57 | **xhtml2pdf** | Conservada | [`historial/v2_xhtml2pdf.py`](../historial/v2_xhtml2pdf.py) |
| 3 | 15:08 | **xhtml2pdf** (ajustes de CSS) | Conservada | [`historial/v3_xhtml2pdf.py`](../historial/v3_xhtml2pdf.py) |
| 4 | 15:23 | **Playwright / Chromium** | **En uso** | [`md_to_pdf.py`](../md_to_pdf.py) |

### v1 — WeasyPrint

Buen maquetador, pero en Windows exige GTK, Pango y Cairo instalados a nivel de
sistema. Ese requisito la descartó.

Su rastro quedó en los metadatos del PDF de ejemplo:

```
producer: WeasyPrint 68.1
```

Fue justamente esa línea la que permitió reconstruir toda esta cronología: el PDF
guardado no correspondía a ninguna versión del código que quedó en disco.

### v2 y v3 — xhtml2pdf

Python puro, sin dependencias de sistema: instala y funciona en Windows. El
precio fue el CSS, del que soporta un subconjunto reducido.

La diferencia entre v2 y v3 es solo tipográfica, un intento de recuperar
legibilidad dentro de esas limitaciones:

| Regla | v2 | v3 |
|---|---|---|
| `code` padding | `1pt 3pt` | `2pt 4pt` |
| `code` font-size | `10pt` | `11pt` |
| `pre` padding | `10pt` | `12pt` |
| `pre` font-size | `9pt` | `11pt` |
| `pre` line-height | `1.3` | `1.5` |

Ninguna de las dos podía renderizar Mermaid: xhtml2pdf no ejecuta JavaScript.

### v4 — Playwright + Chromium

El salto conceptual: en vez de buscar una librería que dibuje PDF, usar un
navegador de verdad y pedirle que imprima. Con eso llegaron de golpe los
diagramas Mermaid, el resaltado de sintaxis real de highlight.js y CSS moderno
sin restricciones.

Es la versión que sigue viva.

---

## Cómo se recuperó el proyecto

**25 de agosto de 2026.** La carpeta del proyecto tenía solo dos archivos
sueltos — `md_to_pdf.py` y `ejemplo_resultado.pdf` — sin documentación ni
contexto, y el recuerdo era el de un conversor de *PDF a Markdown*, la dirección
contraria a la real.

La reconstrucción se apoyó en tres pistas:

1. **Los metadatos del PDF** (`WeasyPrint 68.1`) no coincidían con el código
   presente (Playwright) → tenía que haber versiones intermedias.
2. **La carpeta de Descargas** conservaba `md_to_pdf.py` y `md_to_pdf_1.py`,
   con marcas de tiempo que encajaban justo entre el PDF y el script final.
3. **`%USERPROFILE%\.md_to_pdf_assets`**, con fecha 22-may 15:24, confirmaba que
   la versión con Playwright llegó a ejecutarse de verdad.

Se descartó además que existiera un conversor de PDF a Markdown: la búsqueda por
nombre y por contenido (`pymupdf4llm`, `docling`, `marker-pdf`, `markitdown`) en
todo el disco `D:`, el perfil de usuario, los historiales de sesión y Google
Drive no arrojó nada.

El único proyecto parecido es otro distinto: `AFGI/aplicacion-financiera/tools/pdf extractor`,
un extractor de estados de cuenta bancarios que va de PDF a datos estructurados,
no a Markdown.

---

## Después de la recuperación

En esa misma fecha el proyecto pasó de dos archivos sueltos a algo mantenible:

- Carpeta propia `convertidor/` con estructura y documentación.
- `md_to_pdf.py` refactorizado: se extrajeron `convertir_lote()` y
  `buscar_markdown()` como interfaz pública, de modo que la línea de comandos
  dejara de ser el único punto de entrada.
- `app.py`: aplicación de escritorio en tkinter que reutiliza ese núcleo.
- Acceso directo en el Escritorio y guion de compilación a `.exe`.
- Versiones antiguas conservadas en `historial/` en lugar de dispersas en
  Descargas.

---

## Auditoría de robustez (28 de septiembre de 2026)

Al decidir que la herramienta viviría en taudux.com se auditó el flujo
Markdown → PDF antes de exponerlo. Diez fallos encontrados **probando**, no
leyendo el código. Todos corregidos y reverificados con las mismas pruebas.

| Fallo | Cómo se detectó | Arreglo |
|---|---|---|
| Las imágenes locales salían rotas | Icono de imagen rota en el PDF de prueba | `incrustar_imagenes()` a `data:` URI |
| La app quedaba colgada para siempre si fallaban los assets | Botón en "Convirtiendo…" tras 12 s | `ErrorAssets` en vez de `sys.exit()`, y `except BaseException` en el hilo |
| Archivos homónimos se pisaban en silencio | Dos `README.md` → un solo PDF | `destinos_sin_colision()` + aviso visible |
| `nl2br` metía saltos de línea duros | Párrafo sin rejustificar al ancho de página | Se quitó la extensión |
| Un Mermaid roto costaba 15 s mudos | 1 archivo tardó 16.7 s en vez de 2 s | Espera de 8 s + detección del cartel de error → aviso |
| Faltaban los números de página | Regresión contra la salida de la v1 | `display_header_footer` + `PIE_PAGINA` |
| La caché de assets podía quedar corrupta | Inspección | Descarga atómica (`.parcial` → `replace`) + descarte de truncados |
| "Agregar carpeta" sólo veía `.md` | Encontró 1 de 4 extensiones | `EXTENSIONES_MD` unificada en el núcleo |
| Fuga de pestañas de Chromium al fallar | Inspección | `page.close()` en `finally` |
| `after()` seguía disparando tras cerrar | `TclError` en consola | `after_cancel` en `WM_DELETE_WINDOW` |

Se añadió además un **botón de cancelar** (el lote se detiene al terminar el
archivo en curso) y el **bloqueo de red** por omisión.

De propina, el rendimiento mejoró: **2.03 → 1.77 s por archivo**, al poder
cambiar `networkidle` por `load` una vez que nada sale a la red.
