# Imagen del servicio de conversión (Cloud Run).
#
# Se parte de la imagen oficial de Playwright y no de python:slim porque el
# conversor de Markdown a PDF imprime con Chromium: necesita el navegador y sus
# ~40 librerías de sistema (fuentes, GTK, NSS, audio). Instalarlas a mano sobre
# una base limpia es media pantalla de apt-get que hay que mantener al día cada
# vez que Chromium cambia de dependencias; esta imagen ya viene con la versión
# de navegador que corresponde a la de Playwright, verificada por upstream.
#
# El costo, asumido: la imagen pesa ~1.5 GB frente a los ~300 MB del extractor.
# Es el precio de renderizar diagramas Mermaid, que son JavaScript y sólo un
# navegador de verdad sabe dibujar.
#
# Construir desde ESTA carpeta:
#     docker build -t convertidor convertidor/
FROM mcr.microsoft.com/playwright/python:v1.56.0-noble

# Las dependencias antes que el código: mientras requirements.txt no cambie,
# Docker reutiliza esta capa y el build tarda segundos en vez de minutos.
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt gunicorn

# Sólo lo que el servicio necesita. La app de escritorio, los ejemplos y el
# historial se quedan fuera: no aportan nada en producción y engordan la imagen.
COPY md_to_pdf.py pdf_to_md.py ./
COPY web/ web/

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Usuario sin privilegios: si algo se colara por un archivo malicioso, no corre
# como root. La imagen de Playwright ya trae el usuario `pwuser`.
RUN chown -R pwuser:pwuser /app /home/pwuser
USER pwuser

# Los assets de Mermaid y highlight.js se descargan la primera vez y se cachean
# en $HOME. En Cloud Run cada instancia arranca en frío, así que se hornean en
# la imagen: sin esto, la primera conversión de cada instancia se va a internet
# a buscar 3.5 MB de JavaScript, y si el CDN falla la conversión falla con él.
#
# VA DESPUÉS del USER a propósito: la caché vive en $HOME, así que corriendo
# esto como root acabaría en /root y el servicio, que corre como pwuser, no la
# encontraría. Quedaría una imagen 3.5 MB más grande y sin ninguna ventaja.
RUN python -c "import md_to_pdf; md_to_pdf.asegurar_assets()"

# --timeout 300: un PDF de 100 páginas tarda minutos y el worker no puede
#   morirse a media conversión.
# --workers 1 --threads 4: Chromium es glotón de memoria. Con 2 GiB de RAM, dos
#   procesos con su propio navegador se quedan cortos; un proceso con hilos
#   comparte la instancia del navegador que ya reusa convertir_lote().
CMD exec gunicorn --chdir web --bind :${PORT:-8080} \
    --workers 1 --threads 4 --timeout 300 \
    --access-logfile - --error-logfile - \
    servicio:app
