/*
  Convertidor PDF <-> Markdown.

  La pantalla no guarda nada: no hay sesión, no hay historial y no hay Supabase.
  Todo el estado vive en esta variable y muere al recargar, que es exactamente
  la promesa que le hacemos a quien sube un documento.

  Mientras el servicio de Cloud Run no esté desplegado, ENDPOINT queda vacío y
  la página corre en modo demostración: sirve para iterar el diseño sin esperar
  al backend, y se anuncia para que nadie confunda un ejemplo con una conversión
  de verdad.
*/
(function () {
  'use strict';

  // Cuando el servicio esté desplegado: 'https://<servicio>.run.app'.
  // Hay que añadirlo también al connect-src del CSP en vercel.json.
  const ENDPOINT_PRODUCCION = '';

  // Sirviendo la página desde localhost se asume el servicio en el 8099, para
  // poder probar la conversión de verdad sin desplegar nada. (Se evita el 8080
  // a propósito: en esta máquina ya está tomado.)
  const ENDPOINT_LOCAL = 'http://localhost:8099';

  const EN_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);

  // Se resuelve al cargar: si el servicio responde, se usa; si no, la página
  // cae a la demostración en vez de romperse.
  let ENDPOINT = '';

  const LIMITES = {
    pdf: { bytes: 20 * 1024 * 1024, etiqueta: '20 MB' },
    md: { bytes: 2 * 1024 * 1024, etiqueta: '2 MB' },
  };

  const EXTENSIONES_MD = ['md', 'markdown', 'mdown', 'mkd'];

  // Sólo para el modo demostración; en cuanto ENDPOINT esté configurado, deja
  // de usarse y puede borrarse junto con convertirDemostracion().
  const PDF_DEMOSTRACION = 'JVBERi0xLjcKJcK1wrYKJSBXcml0dGVuIGJ5IE11UERGIDEuMjguMgoKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFIvSW5mbzw8L1Byb2R1Y2VyKE11UERGIDEuMjguMik+Pj4+CmVuZG9iagoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0NvdW50IDIvS2lkc1s0IDAgUiAxMSAwIFJdPj4KZW5kb2JqCgozIDAgb2JqCjw8L0ZvbnQ8PC9oZWx2IDUgMCBSPj4+PgplbmRvYmoKCjQgMCBvYmoKPDwvVHlwZS9QYWdlL01lZGlhQm94WzAgMCA1OTUgODQyXS9Sb3RhdGUgMC9SZXNvdXJjZXMgMyAwIFIvUGFyZW50IDIgMCBSL0NvbnRlbnRzWzYgMCBSIDcgMCBSIDggMCBSIDkgMCBSIDEwIDAgUl0+PgplbmRvYmoKCjUgMCBvYmoKPDwvVHlwZS9Gb250L1N1YnR5cGUvVHlwZTEvQmFzZUZvbnQvSGVsdmV0aWNhL0VuY29kaW5nL1dpbkFuc2lFbmNvZGluZz4+CmVuZG9iagoKNiAwIG9iago8PC9MZW5ndGggMTEzL0ZpbHRlci9GbGF0ZURlY29kZT4+CnN0cmVhbQp42lWKMQpCQRBD+zlFTrDuzO5mEMTigwh2ynZi518ttNDC8zsfKwmEvCTykqmLIocUbvBi6E9Z3efHBxZ5IKkjWUUqitP+D983nDeNXHvxSrXs2Y3No1mIle3nvHIsn1iVJdbBeXvpB9l1OcoXbUEc5AplbmRzdHJlYW0KZW5kb2JqCgo3IDAgb2JqCjw8L0xlbmd0aCA0Ny9GaWx0ZXIvRmxhdGVEZWNvZGU+PgpzdHJlYW0KeJzjKuQyN1IwNzRTyOUyNTIGs3K4jBTKufSMFPTMFPQszBSC3BWCuQK5ALSFCDYKZW5kc3RyZWFtCmVuZG9iagoKOCAwIG9iago8PC9MZW5ndGggMTI4L0ZpbHRlci9GbGF0ZURlY29kZT4+CnN0cmVhbQp42kVLvQqCQQzb+xR9Ar3eT4ogDoII36bcJk5yp4MOOvj8xuMTadOmTSJP2VYxDSxTjwqiPmR5a/e3GnnXRZr7uP/z11VP61xwicETikcHVkhEjwEZhTOho/H/VYeCRnfmzrDhN7raSBRPVOyXQsG46eyxbc51kl2Vg3wAPhUnRgplbmRzdHJlYW0KZW5kb2JqCgo5IDAgb2JqCjw8L0xlbmd0aCAxMjAvRmlsdGVyL0ZsYXRlRGVjb2RlPj4Kc3RyZWFtCnjaXYqxCgJhDIP3PkWfQP/22pQDcRBEcFO6idPxnw466ODzW0QQJCF8CaEHbZKEW0k4lGHBeafltd9eLMo582L4+rj78fPCp5VJSDhGbTHAKwEPhRRZVPdmZqimcAgmnYpbUWBE//wa5tC/ta/Puadt0oHem8oibwplbmRzdHJlYW0KZW5kb2JqCgoxMCAwIG9iago8PC9MZW5ndGggNzMvRmlsdGVyL0ZsYXRlRGVjb2RlPj4Kc3RyZWFtCnja4yrkcgrhMlQwAEJDBSMLUwUTI4WQXC79jNScMgVLhZA0BT1TKApyR7CL0hWibYwNjQyM0owMjI3sYkO8uFxDuAK5ALjvEWoKZW5kc3RyZWFtCmVuZG9iagoKMTEgMCBvYmoKPDwvVHlwZS9QYWdlL01lZGlhQm94WzAgMCA1OTUgODQyXS9Sb3RhdGUgMC9SZXNvdXJjZXMgMyAwIFIvUGFyZW50IDIgMCBSL0NvbnRlbnRzWzYgMCBSIDcgMCBSIDggMCBSIDkgMCBSIDEyIDAgUl0+PgplbmRvYmoKCjEyIDAgb2JqCjw8L0xlbmd0aCA3My9GaWx0ZXIvRmxhdGVEZWNvZGU+PgpzdHJlYW0KeNrjKuRyCuEyVDAAQkMFIwtTBRMjhZBcLv2M1JwyBUuFkDQFPVMoCnJHsIvSFaJtjI2MDIzSjAyMjexiQ7y4XEO4ArkAuQIRawplbmRzdHJlYW0KZW5kb2JqCgp4cmVmCjAgMTMKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDQyIDAwMDAwIG4gCjAwMDAwMDAxMjAgMDAwMDAgbiAKMDAwMDAwMDE3OSAwMDAwMCBuIAowMDAwMDAwMjIwIDAwMDAwIG4gCjAwMDAwMDAzNTIgMDAwMDAgbiAKMDAwMDAwMDQ0MSAwMDAwMCBuIAowMDAwMDAwNjIzIDAwMDAwIG4gCjAwMDAwMDA3MzggMDAwMDAgbiAKMDAwMDAwMDkzNSAwMDAwMCBuIAowMDAwMDAxMTI0IDAwMDAwIG4gCjAwMDAwMDEyNjYgMDAwMDAgbiAKMDAwMDAwMTM5OSAwMDAwMCBuIAoKdHJhaWxlcgo8PC9TaXplIDEzL1Jvb3QgMSAwIFIvSURbPEMyOUM1NkMzQTgxN0MzOUVDM0E4MjdDMjk0QzJBODBBPjwzMTk3MjYxQkUwMkY2N0UzQTg1Mzc4OUFCMTVGODk0ND5dPj4Kc3RhcnR4cmVmCjE1NDEKJSVFT0YK';

  const el = (id) => document.getElementById(id);

  const nodos = {
    soltar: el('mdSoltar'),
    input: el('mdArchivo'),
    vacio: el('mdSoltarVacio'),
    elegido: el('mdSoltarElegido'),
    nombre: el('mdNombre'),
    datos: el('mdDatos'),
    direccion: el('mdDireccion'),
    errorArchivo: el('mdErrorArchivo'),
    sinServicio: el('mdSinServicio'),
    procesar: el('mdProcesar'),
    otro: el('mdOtro'),
    progreso: el('mdProgreso'),
    barra: el('mdBarra'),
    barraRelleno: el('mdBarraRelleno'),
    progresoCifra: el('mdProgresoCifra'),
    progresoNumero: el('mdProgresoNumero'),
    progresoTexto: el('mdProgresoTexto'),
    resultado: el('mdResultado'),
    semaforo: el('mdSemaforo'),
    descargar: el('mdDescargar'),
    copiar: el('mdCopiar'),
    descargarZip: el('mdDescargarZip'),
    informe: el('mdInforme'),
    vista: el('mdVista'),
    vistaTexto: el('mdVistaTexto'),
    render: el('mdRender'),
    visorPdf: el('mdVisorPdf'),
    pestanas: el('mdPestanas'),
    pestanaVista: el('mdPestanaVista'),
    pestanaCodigo: el('mdPestanaCodigo'),
    pantallaCompleta: el('mdPantallaCompleta'),
    datosLista: el('mdDatosLista'),
    avisos: el('mdAvisos'),
    rechazo: el('mdRechazo'),
    rechazoDetalle: el('mdRechazoDetalle'),
    rechazoVolver: el('mdRechazoVolver'),
    fallo: el('mdFallo'),
    falloDetalle: el('mdFalloDetalle'),
    falloVolver: el('mdFalloVolver'),
  };

  let archivo = null;
  let direccion = null;      // 'pdf-a-md' | 'md-a-pdf'
  let resultado = null;
  let descargado = false;
  let urlPrevia = null;      // blob del PDF mostrado, para poder liberarlo
  let disponible = true;     // false si no hay servicio y no estamos en local

  // ─── Utilidades ──────────────────────────────────────────────────────── //

  function extension(nombre) {
    const partes = nombre.toLowerCase().split('.');
    return partes.length > 1 ? partes.pop() : '';
  }

  function tamanoLegible(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function avisar(mensaje) {
    if (typeof window.mostrarToast === 'function') {
      window.mostrarToast(mensaje);
    }
  }

  /*
    Se pregunta una sola vez, al cargar, si hay servicio detrás. Así la persona
    no descubre a mitad de una conversión que no había nadie escuchando, y en
    local basta con levantar el servicio para que la página deje de simular.

    Fuera de local, si no hay servicio la herramienta se APAGA. La demostración
    existe para trabajar el diseño sin backend; devolverle un resultado
    inventado a alguien que subió un documento de verdad sería engañarlo.
  */
  (async function resolverEndpoint() {
    const candidato = EN_LOCAL ? ENDPOINT_LOCAL : ENDPOINT_PRODUCCION;

    if (candidato) {
      try {
        const r = await fetch(`${candidato}/salud`, { method: 'GET' });
        if (r.ok) ENDPOINT = candidato;
      } catch (e) {
        /* no responde: se resuelve abajo */
      }
    }

    if (!ENDPOINT && !EN_LOCAL) {
      disponible = false;
      mostrar(nodos.sinServicio, true);
      nodos.procesar.disabled = true;
      nodos.soltar.setAttribute('aria-disabled', 'true');
    }
  }());

  function mostrar(nodo, visible) {
    if (nodo) nodo.hidden = !visible;
  }

  // ─── Selección de archivo ────────────────────────────────────────────── //

  function validar(f) {
    const ext = extension(f.name);

    if (ext === 'pdf') {
      if (f.size > LIMITES.pdf.bytes) {
        return { ok: false, error: `El PDF pesa ${tamanoLegible(f.size)} y el ` +
          `límite es ${LIMITES.pdf.etiqueta}.` };
      }
      return { ok: true, direccion: 'pdf-a-md' };
    }

    if (EXTENSIONES_MD.includes(ext)) {
      if (f.size > LIMITES.md.bytes) {
        return { ok: false, error: `El Markdown pesa ${tamanoLegible(f.size)} y ` +
          `el límite es ${LIMITES.md.etiqueta}.` };
      }
      return { ok: true, direccion: 'md-a-pdf' };
    }

    return { ok: false, error: `No reconocemos la extensión «.${ext}». ` +
      `Sube un PDF o un archivo Markdown (.md, .markdown, .mdown, .mkd).` };
  }

  function elegir(f) {
    if (!f) return;

    const veredicto = validar(f);
    if (!veredicto.ok) {
      archivo = null;
      direccion = null;
      nodos.procesar.disabled = true;
      nodos.errorArchivo.textContent = veredicto.error;
      mostrar(nodos.errorArchivo, true);
      nodos.soltar.dataset.elegido = 'false';
      mostrar(nodos.vacio, true);
      mostrar(nodos.elegido, false);
      return;
    }

    archivo = f;
    direccion = veredicto.direccion;
    mostrar(nodos.errorArchivo, false);

    nodos.nombre.textContent = f.name;
    nodos.datos.textContent = tamanoLegible(f.size);
    nodos.direccion.textContent = direccion === 'pdf-a-md'
      ? 'PDF → Markdown'
      : 'Markdown → PDF';

    nodos.soltar.dataset.elegido = 'true';
    mostrar(nodos.vacio, false);
    mostrar(nodos.elegido, true);
    mostrar(nodos.otro, true);
    // Si el servicio no responde, elegir archivo no debe reactivar el botón.
    nodos.procesar.disabled = !disponible;
  }

  nodos.input.addEventListener('change', (e) => elegir(e.target.files[0]));
  nodos.soltar.addEventListener('click', () => nodos.input.click());

  // Arrastrar no puede ser el único camino: el div es role="button" y responde
  // a Enter y espacio como cualquier control.
  nodos.soltar.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      nodos.input.click();
    }
  });

  ['dragenter', 'dragover'].forEach((evento) => {
    nodos.soltar.addEventListener(evento, (e) => {
      e.preventDefault();
      nodos.soltar.dataset.encima = 'true';
    });
  });

  ['dragleave', 'drop'].forEach((evento) => {
    nodos.soltar.addEventListener(evento, (e) => {
      e.preventDefault();
      nodos.soltar.dataset.encima = 'false';
    });
  });

  nodos.soltar.addEventListener('drop', (e) => {
    if (e.dataTransfer.files.length) elegir(e.dataTransfer.files[0]);
  });

  nodos.otro.addEventListener('click', (e) => {
    e.stopPropagation();
    nodos.input.click();
  });

  // ─── Progreso ────────────────────────────────────────────────────────── //

  function avance(porcentaje, texto) {
    if (porcentaje === null) {
      // Sin cifra fiable: se esconde en vez de inventar un número.
      nodos.barra.dataset.indeterminada = 'true';
      nodos.barra.removeAttribute('aria-valuenow');
      mostrar(nodos.progresoCifra, false);
    } else {
      nodos.barra.dataset.indeterminada = 'false';
      nodos.barraRelleno.style.inlineSize = `${porcentaje}%`;
      nodos.barra.setAttribute('aria-valuenow', String(Math.round(porcentaje)));
      nodos.progresoNumero.textContent = String(Math.round(porcentaje));
      mostrar(nodos.progresoCifra, true);
    }
    if (texto) nodos.progresoTexto.textContent = texto;
  }

  // ─── Procesar ────────────────────────────────────────────────────────── //

  nodos.procesar.addEventListener('click', async () => {
    if (!archivo || !disponible) return;

    mostrar(nodos.resultado, false);
    mostrar(nodos.rechazo, false);
    mostrar(nodos.fallo, false);
    mostrar(nodos.progreso, true);
    nodos.procesar.disabled = true;
    avance(null, 'Subiendo el documento…');

    try {
      const datos = ENDPOINT
        ? await convertirEnServidor(archivo)
        : await convertirDemostracion(archivo, direccion);

      mostrar(nodos.progreso, false);

      if (datos.error === 'rasterizado') {
        nodos.rechazoDetalle.textContent = datos.detalle || '';
        mostrar(nodos.rechazo, true);
        nodos.rechazo.focus();
        return;
      }

      pintarResultado(datos);
    } catch (e) {
      mostrar(nodos.progreso, false);
      nodos.falloDetalle.textContent = e.message ||
        'Hubo un problema al procesar el archivo. Inténtalo de nuevo.';
      mostrar(nodos.fallo, true);
      nodos.fallo.focus();
    } finally {
      nodos.procesar.disabled = false;
    }
  });

  /*
    Contrato con el servicio (Cloud Run). Se manda el archivo tal cual y se
    recibe todo el resultado en un JSON, para que la página no tenga que
    encadenar peticiones ni conocer rutas de archivos en el servidor.
  */
  async function convertirEnServidor(f) {
    const cuerpo = new FormData();
    cuerpo.append('archivo', f);

    avance(null, 'Convirtiendo…');
    const respuesta = await fetch(`${ENDPOINT}/convertir`, {
      method: 'POST',
      body: cuerpo,
    });

    const datos = await respuesta.json().catch(() => null);

    if (respuesta.status === 422 && datos) return datos;   // rechazo previsto
    if (!respuesta.ok) {
      throw new Error((datos && datos.detalle) ||
        `El servicio respondió ${respuesta.status}.`);
    }
    return datos;
  }

  /*
    Modo demostración: sólo se usa cuando no hay ENDPOINT configurado. Simula el
    avance y devuelve un resultado de ejemplo para poder trabajar la pantalla
    antes de que exista el servicio.
  */
  async function convertirDemostracion(f, dir) {
    avisar('Modo demostración: el servicio todavía no está conectado.');

    const paginas = 8;
    for (let p = 1; p <= paginas; p += 1) {
      await new Promise((r) => setTimeout(r, 180));
      avance((p / paginas) * 100, `Procesando página ${p} de ${paginas}…`);
    }

    if (dir === 'md-a-pdf') {
      return {
        direccion: dir,
        nombre: f.name.replace(/\.[^.]+$/, '.pdf'),
        tipo: 'application/pdf',
        // PDF mínimo de dos páginas, sólo para que se pueda ver cómo queda el
        // visor incrustado antes de que exista el servicio.
        contenido_base64: PDF_DEMOSTRACION,
        fidelidad: 'alta',
        paginas: 2,
        avisos: [],
      };
    }

    return {
      direccion: dir,
      nombre: f.name.replace(/\.[^.]+$/, '.md'),
      tipo: 'text/markdown',
      contenido: '# Documento de ejemplo\n\n' +
        'Este texto es una demostración: el servicio de conversión todavía no ' +
        'está conectado.\n\n' +
        '## Tabla detectada\n\n' +
        '| Concepto | Monto |\n|---|---|\n| Prima anual | $12,450.00 |\n' +
        '| Recargo | $1,120.50 |\n\n' +
        '> ⚠️ **Diagrama no convertible** — página 4. ' +
        'Se guardó como imagen: `assets/pagina-004-diagrama-1.png`\n',
      fidelidad: 'media',
      paginas,
      tablas: 3,
      tablas_dudosas: 1,
      imagenes: 2,
      avisos: [
        { tipo: 'Diagrama no convertible', pagina: 4,
          detalle: 'Se guardó como imagen en la carpeta assets.' },
        { tipo: 'Tabla de baja confianza', pagina: 6,
          detalle: 'Filas con distinto número de columnas. Verifica las cifras ' +
            'contra el PDF original.' },
      ],
    };
  }

  // ─── Resultado ───────────────────────────────────────────────────────── //

  const ETIQUETA_FIDELIDAD = {
    alta: 'Fidelidad alta',
    buena: 'Fidelidad buena',
    media: 'Fidelidad media — revisa lo marcado',
  };

  function pintarResultado(datos) {
    resultado = datos;
    descargado = false;

    const nivel = datos.fidelidad || 'buena';
    nodos.semaforo.dataset.nivel = nivel;
    nodos.semaforo.textContent = ETIQUETA_FIDELIDAD[nivel] || 'Convertido';

    const esTexto = Boolean(datos.contenido);
    // El portapapeles sólo tiene sentido con texto: un PDF no se copia como
    // cadena.
    mostrar(nodos.copiar, esTexto);
    pintarVista(datos, esTexto);

    mostrar(nodos.descargarZip, Boolean(datos.zip_base64));
    mostrar(nodos.informe, Boolean(datos.informe));

    pintarDatos(datos);
    pintarAvisos(datos.avisos || []);

    mostrar(nodos.resultado, true);
    nodos.resultado.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /*
    La hoja de estilos de la vista renderizada. Va embebida en el srcdoc del
    iframe porque el iframe está en sandbox y tiene origen opaco: no puede
    cargar una hoja de este sitio. Es una versión reducida del CSS que usa el
    conversor para generar el PDF, para que lo que se ve aquí se parezca a lo
    que se descarga.
  */
  const CSS_VISTA = `
    body { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
           font-size: 15px; line-height: 1.7; color: #2c3e50; margin: 0;
           padding: 2rem; background: #fff; }
    h1 { font-size: 1.9em; border-bottom: 3px solid #3498db; padding-bottom: .3em; }
    h2 { font-size: 1.5em; border-bottom: 1px solid #bdc3c7; padding-bottom: .2em; }
    h1, h2, h3, h4 { color: #1a202c; margin: 1.4em 0 .5em; line-height: 1.3; }
    p { margin: .7em 0; }
    a { color: #2980b9; }
    code { background: #f1f3f5; padding: 2px 6px; border-radius: 4px;
           color: #d63384; font-size: .9em;
           font-family: Consolas, Menlo, monospace; }
    pre { background: #1e1e1e; color: #d4d4d4; border-radius: 8px; padding: 16px;
          overflow-x: auto; }
    pre code { background: none; color: inherit; padding: 0; }
    blockquote { border-left: 4px solid #3498db; background: #ecf0f1; color: #555;
                 margin: 1em 0; padding: .5em 1em; font-style: italic; }
    table { border-collapse: collapse; width: 100%; margin: 1em 0; }
    th, td { border: 1px solid #bdc3c7; padding: .5em .8em; text-align: left; }
    th { background: #3498db; color: #fff; }
    tr:nth-child(even) { background: #f8f9fa; }
    img { max-width: 100%; height: auto; }
    hr { border: none; border-top: 2px solid #bdc3c7; margin: 2em 0; }
  `;

  /*
    Mostrar el resultado tal como quedó, que es la única forma de que la
    persona juzgue si le sirve antes de descargarlo.

      - Markdown → PDF: se incrusta el PDF y lo pinta el visor del navegador.
      - PDF → Markdown: se renderiza el Markdown, con la opción de ver el
        código fuente en la otra pestaña.
  */
  function pintarVista(datos, esTexto) {
    if (urlPrevia) {
      URL.revokeObjectURL(urlPrevia);
      urlPrevia = null;
    }

    // Markdown → PDF: el propio PDF es la vista previa, en su iframe sin
    // sandbox para que el visor del navegador pueda dibujarlo.
    if (!esTexto && datos.contenido_base64) {
      urlPrevia = URL.createObjectURL(
        desdeBase64(datos.contenido_base64, 'application/pdf'));
      // #view=FitH le pide al visor que ajuste la hoja al ancho disponible.
      // Sin esto abre al 100 % y la página sale cortada por el lado derecho.
      nodos.visorPdf.src = `${urlPrevia}#view=FitH`;
      mostrar(nodos.visorPdf, true);
      mostrar(nodos.render, false);
      mostrar(nodos.vistaTexto, false);
      mostrar(nodos.pestanas, false);
      mostrar(nodos.vista, true);
      return;
    }

    mostrar(nodos.visorPdf, false);
    nodos.visorPdf.removeAttribute('src');

    if (!esTexto) {
      // Sin contenido que enseñar (por ejemplo, en modo demostración)
      mostrar(nodos.vista, false);
      return;
    }

    // PDF → Markdown
    nodos.vistaTexto.textContent = datos.contenido;
    nodos.render.srcdoc = typeof window.marked === 'undefined'
      ? ''
      : `<!doctype html><html lang="es"><head><meta charset="utf-8">` +
        `<style>${CSS_VISTA}</style></head><body>` +
        window.marked.parse(datos.contenido) +
        `</body></html>`;

    // Si marked no cargó, se enseña el código: mejor eso que un marco vacío.
    const hayRender = Boolean(nodos.render.srcdoc);
    mostrar(nodos.pestanas, hayRender);
    seleccionarPestana(hayRender ? 'vista' : 'codigo');
    mostrar(nodos.vista, true);
  }

  function seleccionarPestana(cual) {
    const esVista = cual === 'vista';
    nodos.pestanaVista.setAttribute('aria-selected', String(esVista));
    nodos.pestanaCodigo.setAttribute('aria-selected', String(!esVista));
    mostrar(nodos.render, esVista);
    mostrar(nodos.vistaTexto, !esVista);
  }

  nodos.pestanaVista.addEventListener('click', () => seleccionarPestana('vista'));
  nodos.pestanaCodigo.addEventListener('click', () => seleccionarPestana('codigo'));

  function pintarDatos(datos) {
    const filas = [['Páginas', datos.paginas]];
    if (datos.tablas !== undefined) filas.push(['Tablas', datos.tablas]);
    if (datos.tablas_dudosas !== undefined) {
      filas.push(['Tablas dudosas', datos.tablas_dudosas]);
    }
    if (datos.imagenes !== undefined) filas.push(['Imágenes', datos.imagenes]);
    filas.push(['Avisos', (datos.avisos || []).length]);

    nodos.datosLista.textContent = '';
    filas.forEach(([titulo, valor]) => {
      if (valor === undefined || valor === null) return;
      const caja = document.createElement('div');
      caja.className = 'md__dato';
      const dt = document.createElement('dt');
      dt.textContent = titulo;
      const dd = document.createElement('dd');
      dd.textContent = String(valor);
      caja.append(dt, dd);
      nodos.datosLista.append(caja);
    });
  }

  function pintarAvisos(avisos) {
    nodos.avisos.textContent = '';
    mostrar(nodos.avisos, avisos.length > 0);

    avisos.forEach((aviso) => {
      const li = document.createElement('li');
      const fuerte = document.createElement('strong');
      // Los avisos de Markdown → PDF no tienen número de página: son del
      // documento entero.
      fuerte.textContent = aviso.pagina
        ? `Página ${aviso.pagina} — ${aviso.tipo}: `
        : `${aviso.tipo}: `;
      li.append(fuerte, document.createTextNode(aviso.detalle || ''));
      nodos.avisos.append(li);
    });
  }

  // ─── Descargas ───────────────────────────────────────────────────────── //

  function bajar(contenido, nombre, tipo) {
    const blob = contenido instanceof Blob
      ? contenido
      : new Blob([contenido], { type: tipo || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = nombre;
    document.body.append(enlace);
    enlace.click();
    enlace.remove();
    // Se libera en el siguiente turno para no cortar la descarga en curso.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    descargado = true;
  }

  function desdeBase64(base64, tipo) {
    const binario = atob(base64);
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
    return new Blob([bytes], { type: tipo });
  }

  nodos.descargar.addEventListener('click', () => {
    if (!resultado) return;
    if (resultado.contenido) {
      bajar(resultado.contenido, resultado.nombre, 'text/markdown;charset=utf-8');
    } else if (resultado.contenido_base64) {
      bajar(desdeBase64(resultado.contenido_base64, resultado.tipo), resultado.nombre);
    } else {
      avisar('En modo demostración no hay archivo real que descargar.');
    }
  });

  nodos.descargarZip.addEventListener('click', () => {
    if (!resultado || !resultado.zip_base64) return;
    bajar(desdeBase64(resultado.zip_base64, 'application/zip'),
      resultado.nombre.replace(/\.[^.]+$/, '.zip'));
  });

  nodos.informe.addEventListener('click', () => {
    if (!resultado || !resultado.informe) return;
    bajar(resultado.informe,
      resultado.nombre.replace(/\.[^.]+$/, '.informe.md'),
      'text/markdown;charset=utf-8');
  });

  nodos.copiar.addEventListener('click', async () => {
    if (!resultado || !resultado.contenido) return;
    try {
      await navigator.clipboard.writeText(resultado.contenido);
      descargado = true;
      avisar('Markdown copiado al portapapeles.');
    } catch (e) {
      avisar('El navegador no dejó copiar. Usa el botón de descargar.');
    }
  });

  // ─── Vista a pantalla completa ───────────────────────────────────────── //

  nodos.pantallaCompleta.addEventListener('click', () => {
    const completa = nodos.vista.classList.toggle('md__vista--completa');
    nodos.pantallaCompleta.textContent = completa ? 'Salir' : 'Pantalla completa';
    if (completa) nodos.vistaTexto.focus();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nodos.vista.classList.contains('md__vista--completa')) {
      nodos.vista.classList.remove('md__vista--completa');
      nodos.pantallaCompleta.textContent = 'Pantalla completa';
      nodos.pantallaCompleta.focus();
    }
  });

  // ─── Volver a empezar ────────────────────────────────────────────────── //

  function reiniciar() {
    mostrar(nodos.rechazo, false);
    mostrar(nodos.fallo, false);
    nodos.input.value = '';
    nodos.input.click();
  }

  nodos.rechazoVolver.addEventListener('click', reiniciar);
  nodos.falloVolver.addEventListener('click', reiniciar);

  /*
    Última red de seguridad de la promesa de no guardar nada: si hay un
    resultado sin descargar, el navegador pregunta antes de cerrar. No podemos
    recuperarlo después, así que el único momento de avisar es este.
  */
  window.addEventListener('beforeunload', (e) => {
    if (resultado && !descargado) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}());
