/*
  La página puente de los decks SUBIDOS. El visor de /slides la carga en su
  <iframe> como `/content/slides/_subida/#<slug>` y espera de ella lo mismo que
  de cualquier deck del repositorio: `window.slidesDeck` —{ total, indice(),
  ir(n) }— y un evento `slides:cambio` en el document en cada cambio de lámina.

  QUÉ HACE, EN ORDEN
  1. Publica `slidesDeck` YA, antes de que el <iframe> termine de cargar: el
     visor lo lee en su evento `load`, y la descarga de abajo es asíncrona.
     Mientras no hay deck, `total` es 0 y `ir()` no hace nada; cuando llega,
     el primer `slides:cambio` le avisa al visor el total y si el deck trae
     sus propios botones.
  2. Busca el deck por su slug en catalogo_slides_subidas() —que ya aplica la
     visibilidad de quien mira— y descarga su HTML del bucket PRIVADO `slides`
     con la sesión de la persona. Sin permiso, no hay fila y no hay descarga.
  3. Lo parsea con DOMParser, que no ejecuta nada, y le quita todo lo que
     pueda ejecutar código (ver subida.logica.js). El deck NUNCA corre su
     propio JavaScript: la navegación, los botones y la pantalla completa son
     de esta página. Por eso sirve para decks de diseño, texto e imágenes, no
     para los que traen gráficas o ejercicios.
  4. Monta sus estilos y su HTML, fuerza `html` y `body` transparentes (el
     fondo del archivo se ignora siempre: detrás va el cielo de la página) y
     conecta las `section.slide` y los botones que el deck traiga.

  EL CIELO. Fuera de pantalla completa el marco del visor es transparente y se
  ve el cielo de la página, que está detrás del iframe. En pantalla completa el
  iframe lo cubre todo y esta página dibuja el suyo (subida.fondo.js), y lo
  pausa al salir o al ocultarse la pestaña.

  EL COLOR-SCHEME. Si el documento del <iframe> y la página que lo contiene
  declaran color-scheme distinto, Chrome pinta un fondo OPACO detrás del
  iframe y tapa el cielo. La página de Slides no declara ninguno (`normal`) y
  esta tampoco: el `color-scheme: dark` que traiga el deck se anula abajo.
*/
(function () {
  const BUCKET = "slides";

  const estadoEl = document.getElementById("subidaEstado");

  function mostrarEstado(mensaje) {
    estadoEl.hidden = false;
    estadoEl.textContent = mensaje;
  }

  function ocultarEstado() {
    estadoEl.hidden = true;
    estadoEl.textContent = "";
  }

  /* ---------- 1. El contrato con el visor, desde el primer momento ---------- */

  let navegacion = null;
  let controlesPropios = false;

  window.slidesDeck = {
    get total() {
      return navegacion ? navegacion.total : 0;
    },
    indice: () => (navegacion ? navegacion.indice() : 0),
    ir: (n) => {
      if (navegacion) navegacion.ir(n);
    },
    get controlesPropios() {
      return controlesPropios;
    },
  };

  // El hash es el slug: si cambia (otro deck subido en el mismo marco), el
  // documento se vuelve a armar desde cero en vez de mezclar dos decks.
  window.addEventListener("hashchange", () => window.location.reload());

  /* ---------- 2. Pantalla completa y cielo ---------- */

  function enPantallaCompleta() {
    try {
      if (document.fullscreenElement) return true;
    } catch {
      // Sin acceso al estado: se asume que no.
    }
    try {
      // El visor pone en pantalla completa su MARCO, que vive en la página de
      // arriba: para este documento `fullscreenElement` sigue en null.
      if (window.parent !== window && window.parent.document.fullscreenElement) return true;
    } catch {
      // Otro origen: no se puede mirar.
    }
    return false;
  }

  function actualizarCielo() {
    const completa = enPantallaCompleta();
    document.body.classList.toggle("en-pantalla-completa", completa);
    if (typeof alternarCieloDeSubida === "function") {
      alternarCieloDeSubida(completa && !document.hidden);
    }
  }

  // Lo que hace el botón de pantalla completa del propio deck: se lo pide al
  // visor (dueño del marco). Sin visor —la página abierta sola— alterna la suya.
  function pedirPantallaCompleta() {
    if (window.parent !== window) {
      try {
        window.parent.document.dispatchEvent(new CustomEvent("slides:alternar-pantalla-completa"));
        return;
      } catch {
        // Sin acceso al visor: se cae al modo solitario.
      }
    }
    try {
      if (document.fullscreenElement) {
        document.exitFullscreen();
        return;
      }
      const pedido = document.documentElement.requestFullscreen();
      if (pedido && pedido.catch) pedido.catch(() => {});
    } catch {
      // El navegador la negó; no hay nada que hacer.
    }
  }

  document.addEventListener("fullscreenchange", actualizarCielo);
  document.addEventListener("visibilitychange", actualizarCielo);
  window.addEventListener("resize", actualizarCielo);
  try {
    if (window.parent !== window) window.parent.document.addEventListener("fullscreenchange", actualizarCielo);
  } catch {
    // Otro origen: el cielo sólo reaccionará al resize.
  }

  /* ---------- 3. Descarga y montaje ---------- */

  async function descargarDeck(slug) {
    let cliente = null;
    try {
      cliente = supabaseClient;
    } catch {
      cliente = null;
    }
    if (!cliente) throw new Error("sin_cliente");

    const catalogo = await cliente.rpc("catalogo_slides_subidas");
    if (catalogo.error) throw new Error("catalogo");
    const fila = (Array.isArray(catalogo.data) ? catalogo.data : []).find((item) => item.slug === slug);
    if (!fila || !fila.archivo_path) throw new Error("no_encontrada");

    // Storage sirve el archivo con `cache-control: max-age=3600`: sin la
    // versión en la URL, el navegador conservaría el HTML viejo hasta una hora
    // después de reemplazarlo. `version_archivo` sube con cada reemplazo (0049)
    // y `?v=` hace que sea otra URL (verificado el 2026-10-07: devuelve el
    // archivo nuevo).
    const descarga = await cliente.storage.from(BUCKET).download(`${fila.archivo_path}?v=${fila.version_archivo || 1}`);
    if (descarga.error || !descarga.data) throw new Error("descarga");
    return { titulo: fila.titulo, texto: await descarga.data.text() };
  }

  function montarDeck(deck) {
    document.head.append(...deck.estilos.map((nodo) => document.importNode(nodo, true)));

    // El fondo del archivo se ignora SIEMPRE y su color-scheme también. Va al
    // final del <head> y con !important: nada del deck puede pisarlo.
    const forzado = document.createElement("style");
    forzado.textContent = "html, body { background: transparent !important; }\n"
      + "html { color-scheme: normal !important; }";
    document.head.append(forzado);

    deck.clasesDelCuerpo.split(/\s+/).filter(Boolean).forEach((clase) => document.body.classList.add(clase));
    document.body.append(...deck.cuerpo.map((nodo) => document.importNode(nodo, true)));
  }

  function conectarDeck() {
    const laminas = document.querySelectorAll("section.slide");
    if (laminas.length === 0) {
      mostrarEstado("Este archivo no trae láminas (section.slide).");
      return;
    }

    // Cada lámina se achica lo justo para entrar entera en el marco, sin barra
    // de scroll (ver escalaParaCaber). Se mide sin zoom y recién ahí se aplica.
    // Si el redondeo del zoom todavía deja algo afuera, se baja un poco más,
    // a lo sumo tres veces.
    function ajustarLamina(lamina) {
      if (!lamina) return;
      lamina.style.zoom = "";
      let escala = escalaParaCaber(lamina.clientHeight, lamina.scrollHeight);
      if (escala >= 1) return;
      lamina.style.zoom = String(escala);
      for (let intento = 0; intento < 3 && lamina.scrollHeight > lamina.clientHeight; intento += 1) {
        const menor = siguienteEscala(escala);
        if (menor === null) break;
        escala = menor;
        lamina.style.zoom = String(escala);
      }
    }
    const ajustarActual = () => ajustarLamina(laminas[navegacion ? navegacion.indice() : 0]);

    let controles = null;
    navegacion = crearNavegacion(laminas, (indice, total) => {
      ajustarLamina(laminas[indice]);
      if (controles) controles.reflejar(indice, total);
      document.dispatchEvent(new CustomEvent(EVENTO_DE_CAMBIO, {
        detail: { indice, total, controlesPropios },
      }));
    });

    controles = conectarControlesDelDeck(document, navegacion, pedirPantallaCompleta);
    controlesPropios = controles.controlesPropios;

    document.addEventListener("keydown", (evento) => {
      if (typeof estaEscribiendoEnCampo === "function" && estaEscribiendoEnCampo(evento.target)) return;
      const accion = accionDeTeclaDeDeck(evento);
      if (!accion) return;
      evento.preventDefault();
      if (accion === "siguiente") navegacion.ir(navegacion.indice() + 1);
      else if (accion === "anterior") navegacion.ir(navegacion.indice() - 1);
      else if (accion === "primera") navegacion.ir(0);
      else navegacion.ir(navegacion.total - 1);
    });

    // Deslizar en pantallas táctiles.
    let inicioX = null;
    document.addEventListener("touchstart", (evento) => { inicioX = evento.touches[0].clientX; }, { passive: true });
    document.addEventListener("touchend", (evento) => {
      if (inicioX === null) return;
      const dx = evento.changedTouches[0].clientX - inicioX;
      if (Math.abs(dx) > 60) navegacion.ir(navegacion.indice() + (dx < 0 ? 1 : -1));
      inicioX = null;
    });

    // Los botones del deck se esconden solos si se deja de mover el mouse.
    if (controlesPropios) {
      const inactividad = crearInactividad(document.body, {
        programar: (funcion, espera) => window.setTimeout(funcion, espera),
        cancelar: (id) => window.clearTimeout(id),
      });
      ["mousemove", "keydown", "touchstart", "focusin"].forEach((nombre) => {
        document.addEventListener(nombre, inactividad.despertar, { passive: true });
      });
      inactividad.despertar();
    }

    navegacion.ir(0);
    actualizarCielo();

    // El marco cambia de tamaño con la ventana y al entrar o salir de
    // pantalla completa; las fuentes web cambian el alto del texto al llegar.
    let cuadroPendiente = 0;
    window.addEventListener("resize", () => {
      cancelAnimationFrame(cuadroPendiente);
      cuadroPendiente = requestAnimationFrame(ajustarActual);
    });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(ajustarActual);
  }

  async function iniciar() {
    const slug = slugDelHash(window.location.hash);
    if (!slug) {
      mostrarEstado("No se indicó qué presentación abrir.");
      return;
    }

    try {
      const { titulo, texto } = await descargarDeck(slug);
      const deck = prepararDeck(texto, new DOMParser());
      if (deck.laminas === 0) {
        mostrarEstado("Este archivo no trae láminas (section.slide).");
        return;
      }
      document.title = `${titulo || deck.titulo || "Presentación"} | Taudux`;
      montarDeck(deck);
      ocultarEstado();
      conectarDeck();
    } catch (error) {
      const noEncontrada = error && error.message === "no_encontrada";
      mostrarEstado(noEncontrada
        ? "No encontramos esa presentación, o no tienes permiso para verla."
        : "No se pudo abrir la presentación. Inténtalo de nuevo.");
    }
  }

  iniciar();
})();
