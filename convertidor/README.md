# Convertidor PDF ⇄ Markdown

Convierte **Markdown a PDF** con estilos cuidados, diagramas Mermaid
renderizados y resaltado de sintaxis, y **PDF a Markdown** conservando el texto
y las tablas.

Cuatro formas de usarlo, todas sobre el mismo núcleo:

| | Dónde | Para qué |
|---|---|---|
| **Servicio HTTP** | [`web/servicio.py`](web/servicio.py) | Lo que consume la página del sitio; se despliega en Cloud Run |
| **Página del sitio** | [`src/app/features/markdown/`](../src/app/features/markdown/) | La herramienta pública de taudux.com |
| **App de escritorio** | [`app.py`](app.py) | Ventana local: eliges archivos y conviertes |
| **Línea de comandos** | [`md_to_pdf.py`](md_to_pdf.py) · [`pdf_to_md.py`](pdf_to_md.py) | Carpetas completas, automatización |

Para ponerlo en producción: **[DESPLIEGUE.md](DESPLIEGUE.md)**.

---

## Qué produce

| Elemento Markdown | Resultado en el PDF |
|---|---|
| Encabezados | Jerarquía tipográfica con líneas divisorias en `#` y `##` |
| Bloques de código | Tema oscuro estilo VS Code Dark+ con resaltado por lenguaje |
| Código inline | Fondo gris claro, texto magenta |
| Tablas | Encabezado azul, filas alternadas, sin cortes entre páginas |
| Citas | Barra azul lateral y fondo gris |
| ` ```mermaid ` | **Diagrama renderizado como imagen vectorial** |
| Imágenes locales | Se incrustan en el PDF; queda autocontenido |
| Enlaces, listas | Estilo limpio, ancho controlado |

Formato de página: A4, márgenes de 2 cm × 1.8 cm, con **número de página** al pie.

La conversión corre **sin red**: nada depende de que un CDN responda, y un `.md`
ajeno no puede hacer que el navegador salga a internet. Las imágenes que apunten
a una URL saldrán rotas y la app te lo avisa.

Hay un ejemplo listo para probar en [`ejemplos/ejemplo.md`](ejemplos/ejemplo.md),
junto con su salida original en `ejemplos/ejemplo_resultado.pdf`.

---

## Instalación

Una sola vez:

```bash
pip install -r requirements.txt
playwright install chromium
```

Después, para crear el acceso directo en el Escritorio:

```bash
powershell -ExecutionPolicy Bypass -File .\crear_acceso_directo.ps1
```

Eso deja un icono **"Markdown a PDF"** en el Escritorio que abre la aplicación
sin ventana de consola.

---

## Uso: aplicación de escritorio

Doble clic en el acceso directo del Escritorio (o ejecuta `python app.py`).

La ventana tiene tres secciones:

1. **Archivos a convertir** — `Agregar archivos…` para elegir uno o varios `.md`,
   o `Agregar carpeta…` para cargar todos los de una carpeta de golpe.
2. **Dónde guardar los PDF** — junto al original, o en una carpeta que elijas.
3. **Opciones** — incluir subcarpetas, abrir la carpeta al terminar, y CSS propio.

Pulsa **Convertir a PDF**. El registro inferior muestra el avance archivo por
archivo; la conversión corre en segundo plano, así que la ventana no se congela.

> La primera conversión tarda unos segundos más: descarga y guarda en caché
> `mermaid.min.js` y `highlight.min.js` en `%USERPROFILE%\.md_to_pdf_assets`.
> A partir de ahí funciona sin conexión.

---

## La dirección inversa: PDF → Markdown

[`pdf_to_md.py`](pdf_to_md.py) hace el camino contrario. No es simétrico: un PDF
no guarda "esto es un título" ni "esto es una tabla", sino glifos con
coordenadas, así que la estructura hay que inferirla. La regla que gobierna el
módulo:

> El error más caro no es perder un elemento, es convertirlo mal y que parezca
> correcto.

Por eso cada elemento cae en una de tres categorías, y **todo lo que se degrada
deja rastro** en dos sitios: un aviso visible en el punto exacto del Markdown, y
un informe de fidelidad aparte.

| Elemento | Política |
|---|---|
| Texto, títulos, listas | Convertir |
| **Tablas** | Convertir, **verificar** y marcar las de baja confianza |
| Imágenes | Extraer a `assets/` y enlazar |
| Diagramas y fórmulas | **No convertir**: extraer como imagen + aviso |
| Encabezados y pies | Descartar |
| PDF sin capa de texto | **Rechazar** con un mensaje claro (haría falta OCR) |

```bash
pip install pymupdf4llm
python pdf_to_md.py documento.pdf -o ./salidas
```

Produce `documento.md`, `documento.informe.md` y una carpeta `assets/`.

El triaje previo es la comprobación más rentable: un PDF rasterizado se rechaza
en dos segundos en vez de devolver un Markdown vacío al cabo de un minuto.

## Uso: línea de comandos

```bash
python md_to_pdf.py <carpeta_entrada> [-o <carpeta_salida>] [-r] [--css <archivo.css>]
```

| Opción | Qué hace |
|---|---|
| `-o`, `--output` | Carpeta destino (por defecto, la misma que la de entrada) |
| `-r`, `--recursive` | Incluye los `.md` de las subcarpetas, conservando la estructura |
| `--css` | Reemplaza la hoja de estilos por una propia |

Ejemplos:

```bash
python md_to_pdf.py ./docs
```

```bash
python md_to_pdf.py ./docs -o ./pdfs -r
```

---

## Generar un `.exe` independiente

Solo hace falta si quieres llevarte la aplicación a otra computadora:

```bash
build_exe.bat
```

Deja el resultado en `dist\Markdown a PDF\Markdown a PDF.exe`.

**Importante:** el `.exe` no incluye Chromium (pesa ~150 MB y Playwright lo
gestiona aparte). En la computadora destino hay que correr una vez
`playwright install chromium`. Para uso local no necesitas el `.exe`: el acceso
directo del Escritorio hace lo mismo.

---

## Estructura del proyecto

```
convertidor/
├── app.py                     Aplicación de escritorio (tkinter)
├── md_to_pdf.py               Núcleo de conversión + interfaz de línea de comandos
├── requirements.txt
├── Markdown a PDF.bat         Lanzador con consola visible (para diagnosticar)
├── crear_acceso_directo.ps1   Crea el icono en el Escritorio
├── build_exe.bat              Compila el .exe con PyInstaller
├── docs/
│   ├── USO.md                 Guía detallada y solución de problemas
│   ├── ARQUITECTURA.md        Cómo funciona por dentro
│   └── HISTORIAL.md           Las cuatro versiones del motor de PDF
├── ejemplos/
│   ├── ejemplo.md
│   └── ejemplo_resultado.pdf
├── historial/                 Versiones anteriores conservadas
├── recursos/                  Icono de la aplicación
└── salidas/                   Carpeta sugerida para los PDF generados
```

---

## Documentación

- [docs/USO.md](docs/USO.md) — guía paso a paso y solución de problemas
- [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) — el flujo interno y por qué Playwright
- [docs/HISTORIAL.md](docs/HISTORIAL.md) — la evolución del proyecto
