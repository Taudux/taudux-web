/*
  La página de Slides: pinta el catálogo de presentaciones y el visor. El
  catálogo lo pide a cargarCatalogoDeSlides() (slides.service.js) y la lógica
  pura (acotar el índice, mapear teclas, normalizar el índice y una entrada
  del manifiesto) sale de slides.logica.js. Acá sólo hay DOM.

  El hash es la fuente de verdad de qué se ve: `#/<slug>` abre esa
  presentación en el visor, cualquier otra cosa (incluido vacío) muestra el
  catálogo. Es el mismo patrón que colaboradores.js usa para su perfil. No hay
  botón de volver: el visor deja toda la ventana a la diapositiva, y al
  catálogo se regresa con "atrás" o con "Slides" en el menú.

  Cada presentación es HOY un deck autocontenido: un único HTML con todas sus
  diapositivas como `<section class="slide">`, que corre dentro de un
  <iframe> del mismo origen y expone `window.slidesDeck` — `{ total,
  indice(), ir(n) }` — más un evento `slides:cambio` en cada cambio de
  diapositiva (ver deck.js de cada carpeta). El visor sólo carga el <iframe>
  UNA VEZ por presentación (con `location.replace`, nunca `iframe.src`: ver
  cargarPresentacionEnIframe); moverse entre diapositivas de la MISMA
  presentación no recarga nada, llama a `slidesDeck.ir(n)` del propio deck.

  El teclado se conecta dos veces, con responsabilidades que no se pisan:
  - en `document` (la página): flechas, PageUp/Down, espacio, Home/End y F,
    mientras el foco esté afuera del <iframe>.
  - en el `document` DEL IFRAME, después de cada `load`: sólo F. Las flechas
    de ahí adentro ya las escucha el propio deck (ver deck.js); escucharlas
    también acá las movería DOS veces por cada tecla.

  Si el deck no expone `slidesDeck` (un HTML que no sigue el contrato), el
  visor lo muestra igual: los botones de navegación quedan deshabilitados y
  el contador se queda vacío, pero pantalla completa sigue andando.
*/
(function () {
  const AVISOS = {
    cargando: "Cargando presentaciones…",
    error: "No se pudieron cargar las presentaciones. Reintenta cuando tengas conexión.",
    vacio: "Todavía no hay presentaciones para mostrar.",
  };

  /* `#/<slug>` -> "slug", o "" si el hash no tiene esa forma. Mismo formato
     que notas.arbol.js, simplificado: acá no hay vistas ni segmentos, sólo
     qué presentación abrir. */
  function slugDesdeHash(hash) {
    const crudo = typeof hash === "string" ? hash.trim().replace(/^#/, "") : "";
    const partes = crudo.split("/").map((parte) => parte.trim().toLowerCase()).filter(Boolean);
    return partes[0] || "";
  }

  function iniciar() {
    // Sin la lógica pura no hay nada que pintar de forma confiable; el HTML
    // estático ya muestra el catálogo vacío, que es mejor que un error a
    // mitad de render.
    if (typeof normalizarPresentacion !== "function") return undefined;

    const porId = (id) => document.getElementById(id);
    const el = {
      catalogo: porId("slidesCatalogo"),
      visor: porId("slidesVisor"),
      aviso: porId("slidesAviso"),
      avisoMensaje: porId("slidesAvisoMensaje"),
      reintentar: porId("slidesReintentar"),
      grilla: porId("slidesGrilla"),
      visorTitulo: porId("slidesVisorTitulo"),
      contador: porId("slidesContador"),
      marco: porId("slidesMarco"),
      iframe: porId("slidesIframe"),
      anterior: porId("slidesAnterior"),
      siguiente: porId("slidesSiguiente"),
      pantallaCompleta: porId("slidesPantallaCompleta"),
    };

    if (Object.values(el).some((nodo) => !nodo)) return undefined;

    // El catálogo cargado (entradas ya normalizadas y válidas) y qué se está
    // mostrando ahora mismo. `totalActual` e `indiceActual` los manda el
    // propio deck (por `slidesDeck` al conectar y por el evento
    // `slides:cambio` después); mientras no haya deck conectado quedan en 0.
    let catalogo = [];
    let presentacionActual = null;
    let indiceActual = 0;
    let totalActual = 0;
    let deckConectado = false;
    let conectada = false;

    el.reintentar.addEventListener("click", reintentarCarga);
    el.anterior.addEventListener("click", () => irA(indiceActual - 1));
    el.siguiente.addEventListener("click", () => irA(indiceActual + 1));
    el.pantallaCompleta.addEventListener("click", alternarPantallaCompleta);
    el.iframe.addEventListener("load", manejarCargaDelIframe);
    document.addEventListener("keydown", (evento) => manejarTecla(evento, evento.target));

    return cargarCatalogo();

    /* ---------- Carga del catálogo ---------- */

    async function cargarCatalogo() {
      el.reintentar.disabled = true;
      el.grilla.setAttribute("aria-busy", "true");
      mostrarAviso(AVISOS.cargando, { error: false });

      let resultado = null;
      try {
        resultado = await cargarCatalogoDeSlides();
      } catch {
        // El servicio nunca lanza: esto es su script que no llegó a cargar.
      } finally {
        el.grilla.setAttribute("aria-busy", "false");
        el.reintentar.disabled = false;
      }

      if (!resultado || !resultado.ok) {
        montarCatalogo([]);
        mostrarAviso(AVISOS.error, { error: true });
        el.reintentar.hidden = false;
        return false;
      }

      // Cada entrada se normaliza y las que no pasan la validación se
      // descartan: una presentación rota no debe tumbar a las demás. El
      // servicio ya arma `url`; acá sólo se conserva si la entrada es válida.
      const normalizadas = (resultado.catalogo || [])
        .map((entrada) => {
          const resultadoEntrada = normalizarPresentacion(entrada && entrada.slug, entrada);
          if (!resultadoEntrada.ok) return null;
          return { ...resultadoEntrada.presentacion, url: entrada.url };
        })
        .filter(Boolean);

      montarCatalogo(normalizadas);
      el.reintentar.hidden = true;

      if (normalizadas.length === 0) mostrarAviso(AVISOS.vacio, { error: false });
      else ocultarAviso();

      if (!conectada) {
        conectada = true;
        ponerCatalogoDetras();
        window.addEventListener("hashchange", aplicarHash);
      }

      aplicarHash();
      return true;
    }

    async function reintentarCarga() {
      const cargada = await cargarCatalogo();
      if (!cargada) el.aviso.focus();
    }

    function mostrarAviso(mensaje, { error }) {
      el.aviso.hidden = false;
      el.aviso.classList.toggle("slides__aviso--error", error);
      escribir(el.avisoMensaje, mensaje);
    }

    function ocultarAviso() {
      el.aviso.hidden = true;
      el.aviso.classList.remove("slides__aviso--error");
      escribir(el.avisoMensaje, "");
    }

    /* ---------- Construcción del catálogo (una vez por carga) ---------- */

    function montarCatalogo(lista) {
      catalogo = lista;
      el.grilla.replaceChildren(...catalogo.map(crearCelda));
    }

    // Sin conteo de diapositivas: eso sólo lo sabe el deck una vez cargado, y
    // el catálogo no lo carga sólo para mostrar una cifra.
    function crearCelda(presentacion) {
      const celda = document.createElement("li");
      celda.className = "slides__celda";

      const boton = document.createElement("button");
      boton.type = "button";
      boton.className = "slides__tarjeta";
      boton.setAttribute("aria-label", `Abrir ${presentacion.titulo}`);
      boton.addEventListener("click", () => abrirDesdeCatalogo(presentacion.slug));

      const titulo = document.createElement("h2");
      titulo.className = "slides__tarjeta-titulo";
      titulo.textContent = presentacion.titulo;
      boton.append(titulo);

      if (presentacion.descripcion) {
        const descripcion = document.createElement("p");
        descripcion.className = "slides__tarjeta-descripcion";
        descripcion.textContent = presentacion.descripcion;
        boton.append(descripcion);
      }

      celda.append(boton);
      return celda;
    }

    /* ---------- Hash: qué se ve ---------- */

    /*
      "Atrás" desde el visor tiene que llevar al catálogo, siempre. Cada
      entrada del historial que abre el visor lleva la marca
      `{ slidesVisor: true }`; si la página arranca en `#/<slug>` sin esa
      marca (un enlace directo), se entró de afuera y detrás no hay catálogo:
      se reescribe la entrada actual como catálogo y se apila el visor
      encima. Con la marca (una recarga) no se toca nada, para no duplicar el
      catálogo en el historial.
    */
    function ponerCatalogoDetras() {
      const slug = slugDesdeHash(window.location.hash);
      if (!slug || !catalogo.some((item) => item.slug === slug)) return;
      if (window.history.state && window.history.state.slidesVisor) return;
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      window.history.pushState({ slidesVisor: true }, "", `#/${slug}`);
    }

    // pushState no dispara `hashchange`, por eso se aplica a mano.
    function abrirDesdeCatalogo(slug) {
      window.history.pushState({ slidesVisor: true }, "", `#/${slug}`);
      aplicarHash();
    }

    function aplicarHash() {
      const slug = slugDesdeHash(window.location.hash);
      const presentacion = slug ? catalogo.find((item) => item.slug === slug) : null;
      if (presentacion) abrirVisor(presentacion);
      else cerrarVisor();
    }

    function abrirVisor(presentacion) {
      const esNueva = presentacionActual?.slug !== presentacion.slug;
      presentacionActual = presentacion;

      el.catalogo.hidden = true;
      el.visor.hidden = false;

      if (esNueva) cargarPresentacionEnIframe(presentacion);
      if (esNueva) el.visorTitulo.focus();
    }

    function cerrarVisor() {
      if (!presentacionActual) { el.catalogo.hidden = false; el.visor.hidden = true; return; }
      presentacionActual = null;
      deckConectado = false;
      // Navegar a about:blank descarga el deck (para sus gráficas y su
      // animación de fondo, si tuviera) en vez de dejarlo corriendo oculto.
      try {
        el.iframe.contentWindow.location.replace("about:blank");
      } catch {
        // Mismo origen siempre en este visor; si algún día no lo fuera, no
        // pasa nada por no poder descargarlo a mano.
      }
      el.catalogo.hidden = false;
      el.visor.hidden = true;
    }

    /* ---------- Carga del deck en el <iframe> ---------- */

    // Una presentación se carga UNA sola vez en el <iframe>: moverse entre
    // sus diapositivas después es cosa de `slidesDeck.ir(n)`, no de volver a
    // navegar. `location.replace` y no `iframe.src`: asignar `src` apila una
    // entrada en el historial por cada carga, y "atrás" retrocedía ahí en vez
    // de volver al catálogo.
    function cargarPresentacionEnIframe(presentacion) {
      indiceActual = 0;
      totalActual = 0;
      deckConectado = false;
      escribir(el.visorTitulo, presentacion.titulo);
      escribir(el.contador, "");
      el.iframe.title = presentacion.titulo;
      actualizarControles();
      el.iframe.contentWindow.location.replace(presentacion.url);
    }

    // Cada `load` reemplaza el documento entero del <iframe>, y con él,
    // cualquier listener agregado en la carga anterior — no hace falta
    // desconectar nada a mano. También dispara al cerrar el visor (navegar a
    // about:blank), por eso el primer chequeo.
    function manejarCargaDelIframe() {
      if (!presentacionActual) return;

      let ventana = null;
      try {
        ventana = el.iframe.contentWindow;
      } catch {
        ventana = null;
      }
      if (!ventana) return;

      try {
        ventana.addEventListener("keydown", (evento) => manejarTeclaDelIframe(evento, evento.target));
        ventana.document.addEventListener("slides:cambio", recibirCambioDeDeck);
      } catch {
        // Un origen distinto (no debería pasar acá) se queda sin teclado ni
        // contador dentro del iframe; los botones de la página siguen
        // deshabilitados, como con cualquier deck sin `slidesDeck`.
      }

      const deck = ventana.slidesDeck;
      if (deck && typeof deck.ir === "function" && typeof deck.indice === "function") {
        indiceActual = indiceAcotado(deck.indice(), deck.total);
        totalActual = Number.isFinite(deck.total) ? deck.total : 0;
        deckConectado = true;
      } else {
        indiceActual = 0;
        totalActual = 0;
        deckConectado = false;
      }
      actualizarControles();
    }

    function recibirCambioDeDeck(evento) {
      if (!presentacionActual) return;
      const detalle = (evento && evento.detail) || {};
      if (Number.isFinite(detalle.total)) totalActual = detalle.total;
      indiceActual = indiceAcotado(detalle.indice, totalActual);
      actualizarControles();
    }

    function actualizarControles() {
      escribir(el.contador, totalActual > 0 ? `${indiceActual + 1} / ${totalActual}` : "");
      if (presentacionActual) {
        el.iframe.title = totalActual > 0
          ? `${presentacionActual.titulo}: diapositiva ${indiceActual + 1} de ${totalActual}`
          : presentacionActual.titulo;
      }
      el.anterior.disabled = !deckConectado || indiceActual <= 0;
      el.siguiente.disabled = !deckConectado || totalActual <= 0 || indiceActual >= totalActual - 1;
    }

    /* ---------- Navegación entre diapositivas de la MISMA presentación ---------- */

    // Nunca recarga el <iframe>: le pide al deck que se mueva. El propio
    // deck dispara `slides:cambio` al terminar show(), que es lo que
    // actualiza `indiceActual` y los controles — acá no hace falta
    // adelantarse a eso.
    function irA(indicePropuesto) {
      if (!presentacionActual || !deckConectado) return;
      const acotado = indiceAcotado(indicePropuesto, totalActual);
      if (acotado === indiceActual) return;

      let ventana = null;
      try {
        ventana = el.iframe.contentWindow;
      } catch {
        ventana = null;
      }
      if (!ventana || !ventana.slidesDeck) return;
      ventana.slidesDeck.ir(acotado);
    }

    /* ---------- Teclado de la página (afuera del <iframe>) ---------- */

    function manejarTecla(evento, elementoObjetivo) {
      if (!presentacionActual) return;
      const accion = accionParaTecla(evento.key, elementoObjetivo);
      if (!accion) return;

      evento.preventDefault();
      if (accion === "siguiente") irA(indiceActual + 1);
      else if (accion === "anterior") irA(indiceActual - 1);
      else if (accion === "primera") irA(0);
      else if (accion === "ultima") irA(totalActual - 1);
      else if (accion === "pantalla-completa") alternarPantallaCompleta();
    }

    /* ---------- Teclado DENTRO del <iframe>: sólo F ----------
       Las flechas, Home, End, PageUp/Down y espacio ya las escucha el propio
       deck (ver deck.js de cada carpeta) para moverse entre sus
       diapositivas; escucharlas también acá las movería dos veces por cada
       tecla. Se reutiliza accionParaTecla (mismo mapa que la página) y se
       descarta cualquier acción que no sea pantalla completa. */
    function manejarTeclaDelIframe(evento, elementoObjetivo) {
      const accion = accionParaTecla(evento.key, elementoObjetivo);
      if (accion !== "pantalla-completa") return;
      evento.preventDefault();
      alternarPantallaCompleta();
    }

    /* ---------- Pantalla completa ---------- */

    function alternarPantallaCompleta() {
      if (document.fullscreenElement) {
        document.exitFullscreen?.();
        return;
      }
      const solicitar = el.marco.requestFullscreen || el.marco.webkitRequestFullscreen;
      solicitar?.call(el.marco);
    }
  }

  function escribir(nodo, texto) {
    if (nodo.textContent !== texto) nodo.textContent = texto;
  }

  document.addEventListener("DOMContentLoaded", iniciar);
})();
