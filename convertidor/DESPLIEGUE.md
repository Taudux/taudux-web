# Despliegue del convertidor

Cómo poner en producción el servicio que usa la página
[`src/app/features/markdown/`](../src/app/features/markdown/).

La infraestructura es la misma que ya usa el extractor: **el sitio sigue
estático en Vercel y la herramienta vive como servicio aparte en Cloud Run**,
región `northamerica-south1` (Querétaro). El sitio sólo la llama.

**Este servicio no guarda nada**: no necesita Supabase, ni bucket, ni base de
datos, ni cuenta de usuario. Cada petición trabaja en un directorio temporal
que se borra en un `finally`.

---

## Lo que lo hace distinto del extractor

El extractor es Python puro y su imagen pesa ~300 MB. **Esta necesita
Chromium**, porque los diagramas Mermaid son JavaScript y sólo un navegador de
verdad sabe dibujarlos. Eso cambia tres números:

| | Extractor | Convertidor |
|---|---|---|
| Imagen | ~300 MB | **~1.5 GB** |
| Memoria | 512 MiB | **4 GiB** |
| Arranque en frío | ~2 s | **~10 s** |

Son **dos** cosas hambrientas a la vez, no una: Chromium para imprimir, y el
modelo ONNX de análisis de maquetación que PyMuPDF 1.28 carga para detectar
tablas. Comprobado en desarrollo: con ~230 MB libres, cargar el modelo revienta
con `onnxruntime ... bad allocation` y el proceso muere antes de convertir
nada. Por eso 4 GiB y no 2.

Con `--min-instances 0` se paga sólo por uso, a cambio de que la primera
conversión tras un rato de silencio tarde esos ~10 s. Si molesta, `--min-instances 1`
lo elimina y cuesta unos 15-25 USD al mes.

---

## Fase 1 — Construir y desplegar

Desde la raíz del repositorio:

```bash
gcloud run deploy convertidor \
  --source convertidor/ \
  --region northamerica-south1 \
  --platform managed \
  --allow-unauthenticated \
  --memory 4Gi \
  --cpu 2 \
  --timeout 300 \
  --concurrency 4 \
  --min-instances 0 \
  --max-instances 3
```

Por qué esos valores:

- **`--memory 4Gi`** — Chromium con un documento grande abierto ronda 1 GiB, y
  el modelo ONNX de PyMuPDF pide lo suyo aparte. Por debajo de esto el
  contenedor muere a media conversión y Cloud Run devuelve un 500 sin
  explicación.
- **`--concurrency 4`** — coincide con los `--threads 4` de gunicorn. Dejar la
  concurrencia por defecto (80) haría que Cloud Run mande a una instancia mucho
  más trabajo del que su único navegador puede atender.
- **`--timeout 300`** — un PDF de 100 páginas tarda minutos; es el mismo límite
  que gunicorn.
- **`--max-instances 3`** — tope de gasto mientras el servicio es gratuito.

Comprobar que responde:

```bash
curl https://<url-del-servicio>/salud
# {"estado":"ok"}
```

## Fase 2 — Conectar la página

Dos cambios, los dos obligatorios. **Con uno solo la herramienta no funciona.**

**1.** En [`src/app/features/markdown/markdown.js`](../src/app/features/markdown/markdown.js),
poner la URL:

```js
const ENDPOINT_PRODUCCION = 'https://<url-del-servicio>';
```

**2.** En [`vercel.json`](../vercel.json), añadir esa misma URL al `connect-src`
de la Content-Security-Policy, **en las dos reglas** (la general y la de
`/app/features/codigo/r`):

```
connect-src 'self' https://yqkvgfqplmbbcebrivpt.supabase.co https://<url-del-servicio> ...
```

Sin esto el navegador bloquea la petición y la página se apaga sola con el
mensaje de «no disponible», que es justo lo que debe hacer.

**3.** En [`convertidor/web/servicio.py`](web/servicio.py), comprobar que el
dominio del sitio está en `ORIGENES` (ya están `https://taudux.com` y
`https://www.taudux.com`). Ahí se resuelve el CORS.

## Fase 3 — Enlazar desde el sitio

La página existe pero **no está enlazada desde ningún lado**, a propósito:

- Entrada en el menú de Tools.
- `src/sitemap.xml`, o dejarla fuera como el generador de QR (lleva
  `robots: noindex`).

---

## Verificar que quedó bien

Tres pruebas, una por camino:

| Sube | Debe pasar |
|---|---|
| Un `.md` cualquiera | Devuelve un PDF y se ve en el visor incrustado |
| Un PDF con texto | Devuelve Markdown, con semáforo de fidelidad |
| Un PDF escaneado o de banco | **HTTP 422** y la pantalla de «no tiene texto que extraer» |

El tercero es el más importante: es el caso más común en México y tiene
pantalla propia, no un error genérico.

---

## Probar en local antes de desplegar

Sin Docker:

```bash
pip install -r convertidor/requirements.txt
playwright install chromium
PORT=8099 python convertidor/web/servicio.py
```

Y el sitio, en otra terminal:

```bash
node tools/servidor.js        # http://localhost:8181
```

La página detecta sola el servicio en `localhost:8099` y, si no responde, cae a
un modo demostración que **sólo funciona en localhost**. Fuera de local, sin
servicio, la herramienta se apaga: devolverle un resultado de ejemplo a alguien
que subió un documento real sería engañarlo.

Con Docker, igual que lo hará Cloud Run:

```bash
docker build -t convertidor convertidor/
docker run --rm -p 8099:8080 convertidor
```

---

## Límites

Están en `web/servicio.py` y **deben coincidir con los que anuncia la página**:
prometer un límite y aplicar otro es peor que no anunciarlo.

| | Valor |
|---|---|
| PDF | 20 MB, 100 páginas |
| Markdown | 2 MB |

Suben cuando existan los planes de pago. Hoy no hay cuotas por usuario porque
no hay usuarios: el servicio no pide cuenta.
