/*
  La página de colaboradores: pinta el roster y la ficha de perfil. La lista la
  pide a listarColaboradores() (colaboradores.service.js) y la lógica pura
  (numeración, enlaces seguros, quién tiene perfil) sale de
  colaboradores.datos.js. Acá sólo hay DOM.

  Un único estado y una única función que deriva la pantalla de él. Los
  manejadores de eventos NO tocan el DOM: cambian el estado y llaman a pintar().
  El perfil abierto vive en el hash (#/<slug>), que es quien manda sobre la
  vista; la navegación con flechas, que llega después, entra como una fuente
  más de cambio de estado sin tocar el pintado.

  La base entrega, además del nombre y el slug, la ficha pública de cada
  persona (0039). Quien todavía no llenó la suya la trae en null: aparece en
  el roster, pero no abre perfil; su ficha sólo se elige y la vista previa
  muestra su nombre.

  La foto (0050) es opcional: quien la tiene la muestra en su ficha, en la vista
  previa y en el perfil, y quien no, conserva la inicial de
  siempre. Si el navegador no logra cargarla (el archivo se retiró y la ruta
  quedó vieja) se vuelve a la inicial en vez de dejar un ícono de imagen rota.

  Todo el texto entra por textContent. Los nombres vienen de la base y las
  fichas las escribe a mano cada persona: nada de lo que venga de ahí se
  interpreta como markup.
*/
(function () {
  const SIGLAS_DE_ENLACE = { linkedin: "in", github: "gh", correo: "@" };

  // "Mi ficha": el formulario donde cada colaborador llena la suya. El enlace
  // no está en ningún menú; cuelga de la ficha de quien mira.
  const RUTA_MI_FICHA = "/app/features/colaboradores/mi-ficha/";

  const VACIA = {
    inicial: "?",
    nombre: "¿Quién?",
    puesto: "Pasa el cursor o elige una ficha",
    bio: "Elige una ficha del roster para ver su perfil y especialidades.",
  };

  // Arrastre del panal (mouse en escritorio, dedo en móvil) y zoom con la
  // rueda (sólo escritorio).
  const CLASE_MARCO_ARRASTRANDO = "colaboradores__marco--arrastrando";
  const UMBRAL_ARRASTRE = 5; // px: menos que eso sigue siendo un clic
  const UMBRAL_ARRASTRE_TACTIL = 8; // px: un dedo tiembla más que un mouse
  // En móvil el panal no pasa de esta fracción de la ventana: el marco no
  // scrollea la página (touch-action: none) y tiene que quedar página fuera de
  // él donde apoyar el dedo.
  const ALTO_MAXIMO_MOVIL = 0.62;
  const VENTANA_DE_VELOCIDAD = 80; // ms de muestras para la velocidad al soltar
  const VELOCIDAD_MAXIMA = 4; // px/ms: tope para que un tirón no lance el panal lejos
  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 2;

  const CLASE_FICHA_CON_FOTO = "colaboradores__ficha--con-foto";
  const CLASE_RETRATO_CON_FOTO = "colaboradores__retrato--con-foto";

  // URLs de foto que el navegador no pudo cargar: se tratan como "sin foto".
  const fotosRotas = new Set();

  const AVISOS = {
    cargando: "Cargando colaboradores…",
    error: "No se pudo cargar la lista de colaboradores. Reintenta cuando tengas conexión.",
    vacio: "Aún no hay colaboradores para mostrar.",
  };

  function iniciar() {
    // Sin la lógica del roster no hay nada que pintar; el HTML estático ya
    // muestra el estado vacío, que es mejor que un error a mitad de render.
    if (typeof tienePerfil !== "function") return undefined;

    const porId = (id) => document.getElementById(id);
    const el = {
      roster: porId("colaboradoresRoster"),
      perfil: porId("colaboradoresPerfil"),
      aviso: porId("colaboradoresAviso"),
      avisoMensaje: porId("colaboradoresAvisoMensaje"),
      reintentar: porId("colaboradoresReintentar"),
      marco: porId("colaboradoresMarco"),
      grilla: porId("colaboradoresGrilla"),
      resumen: porId("colaboradoresResumen"),
      previaRetrato: porId("previaRetrato"),
      previaFoto: porId("previaFoto"),
      previaInicial: porId("previaInicial"),
      previaNombre: porId("previaNombre"),
      previaRol: porId("previaRol"),
      previaBio: porId("previaBio"),
      previaEnlaces: porId("previaEnlaces"),
      perfilNumero: porId("perfilNumero"),
      perfilRetrato: porId("perfilRetrato"),
      perfilFoto: porId("perfilFoto"),
      perfilInicial: porId("perfilInicial"),
      perfilEnlaces: porId("perfilEnlaces"),
      perfilNombre: porId("perfilNombre"),
      perfilPuesto: porId("perfilPuesto"),
      perfilEmpresa: porId("perfilEmpresa"),
      perfilEmpresaCelda: porId("perfilEmpresaCelda"),
      perfilSector: porId("perfilSector"),
      perfilSectorCelda: porId("perfilSectorCelda"),
      perfilUbicacion: porId("perfilUbicacion"),
      perfilExperiencia: porId("perfilExperiencia"),
      perfilModalidadTrabajo: porId("perfilModalidadTrabajo"),
      perfilHerramientas: porId("perfilHerramientas"),
      perfilHabilidades: porId("perfilHabilidades"),
      perfilHabilidadesCelda: porId("perfilHabilidadesCelda"),
      perfilIdiomas: porId("perfilIdiomas"),
      perfilIdiomasCelda: porId("perfilIdiomasCelda"),
      perfilBio: porId("perfilBio"),
    };

    // Todo o nada: con media página sin montar, pintar() reventaría en el
    // primer null y dejaría la otra mitad a medio actualizar.
    if (Object.values(el).some((nodo) => !nodo)) return undefined;

    const estado = { seleccion: null, vista: "roster" };

    /*
      La ficha bajo el cursor o con el foco. Vive FUERA del estado a propósito:
      es efímera, no sobrevive a un cambio de vista y no debe terminar en el
      hash, que es donde vive el perfil. `seleccion` es a lo que la vista
      previa vuelve cuando esto queda en null.

      Son DOS dueños, no uno: el cursor y el foco del teclado. Con una sola
      variable, pasar el mouse por la ficha enfocada y sacarlo apagaba la vista
      previa aunque la ficha siguiera con el foco. El cursor manda mientras está
      encima de algo; cuando se va, la vista vuelve a la ficha enfocada.
    */
    const resaltado = { cursor: null, foco: null };

    // La lista cargada, sus botones y el enlace a "Mi ficha" de cada celda: se
    // reemplazan juntos, en montarRoster().
    let colaboradores = [];
    let fichas = [];
    let enlacesDeEdicion = [];
    let celdas = [];
    // La última medida aplicada al panal: si no cambió, acomodarPanal() no
    // toca el DOM. Es lo que corta el ciclo observador → alto de la grilla →
    // observador en móvil.
    let medidaDelPanal = "";

    /*
      La VISTA del panal: cuánto se arrastró (panX, panY, en px
      desde el centro del marco) y el zoom. `base` guarda el centro de cada
      círculo respecto del centro del marco con zoom 1 y sin arrastre: sólo
      cambia al cambiar la medida, mientras que la vista cambia a cada gesto.
      pintarPanal() combina las dos. panX/panY son el valor CRUDO (puede quedar
      fuera de límites mientras se jala o rebota); lo que se pinta pasa por
      limitarDesplazamiento().
    */
    const vista = { panX: 0, panY: 0, zoom: 1 };
    let base = [];
    let diametroBase = 0;
    let areaAncho = 0;
    let areaAlto = 0;
    let esMovil = false;
    // Gesto de arrastre en curso (o null) y bandera para tragar el clic que el
    // navegador dispara al soltar un arrastre.
    let arrastre = null;
    let tragarClic = false;
    // Dedos (o lápices) apoyados en el marco, en móvil: id → {x, y}. Con dos
    // o más el gesto es un pellizco y `multitoque` queda encendido hasta que
    // se levanta el último: un gesto así nunca abre un perfil.
    const dedos = new Map();
    let pellizco = null;
    let multitoque = false;
    // Animación: un solo bucle rAF. `inercia` son px/ms por eje; `destino`, un
    // pan al que se llega suave (enfocar con teclado). Se apaga solo.
    let cuadro = 0;
    let ultimoCuadro = 0;
    const inercia = { x: 0, y: 0 };
    let destino = null;
    // El hash se conecta UNA vez, con la primera lista que llega.
    let conectada = false;

    /*
      El slug de quien está mirando, si es alguien del roster; null en
      cualquier otro caso (visitante anónimo, cuenta que no colabora, o algo
      que falló). Arranca en null y se resuelve DESPUÉS de la primera lista:
      es lo único que decide si se ve el enlace a "Mi ficha", y mientras no se
      sepa, ese enlace no es de nadie.
    */
    let miSlug = null;

    el.reintentar.addEventListener("click", reintentarCarga);

    // El panal se vuelve a acomodar cuando el marco cambia de tamaño (ventana,
    // giro del teléfono, la vista que reaparece tras el perfil). Sin
    // ResizeObserver (los tests, navegadores viejos) se acomoda al montar y ya.
    if (typeof ResizeObserver === "function") new ResizeObserver(() => acomodarPanal()).observe(el.marco);
    // En móvil el tope del panal depende del ALTO de la ventana, que el
    // observador del marco no ve.
    window.addEventListener("resize", () => acomodarPanal());

    el.marco.addEventListener("pointerdown", empezarArrastre);
    el.marco.addEventListener("pointermove", moverArrastre);
    el.marco.addEventListener("pointerup", terminarArrastre);
    el.marco.addEventListener("pointercancel", terminarArrastre);
    // En captura: el clic que sigue a un arrastre no debe llegar a la ficha
    // (abriría un perfil por haber soltado el mouse encima de ella).
    el.marco.addEventListener("click", (evento) => {
      if (!tragarClic) return;
      tragarClic = false;
      evento.stopPropagation();
      evento.preventDefault();
    }, true);
    // passive:false porque el zoom frena el scroll de la página.
    el.marco.addEventListener("wheel", hacerZoom, { passive: false });
    // El navegador deja arrastrar imágenes y enlaces para soltarlos en otra
    // pestaña; ese arrastre nativo le ganaba al del panal (una copia fantasma
    // de la foto seguía al cursor y el panal no se movía). La foto y el enlace
    // ya salen con draggable="false"; esto cubre cualquier otro que aparezca.
    el.marco.addEventListener("dragstart", (evento) => evento.preventDefault());
    // Mantener el dedo encima abre el menú contextual en Android (el de iOS
    // lo apaga -webkit-touch-callout en el CSS). En el panal no hay nada que
    // copiar ni guardar.
    el.marco.addEventListener("contextmenu", (evento) => evento.preventDefault());
    // Safari hace zoom a la PÁGINA con su propio evento de gesto, aparte de
    // touch-action. Dentro del marco el pellizco es del panal.
    el.marco.addEventListener("gesturestart", (evento) => evento.preventDefault());
    el.marco.addEventListener("gesturechange", (evento) => evento.preventDefault());

    // Devuelve la promesa de la primera carga: el navegador la ignora, y así
    // quien dispara DOMContentLoaded (los tests) puede esperarla.
    return cargarRoster();

    /* ---------- Carga de la lista ---------- */

    /*
      Devuelve true si llegó una lista (aunque venga vacía) y false si falló.
      Mientras carga, el botón de reintentar se queda donde estaba —oculto en
      la primera carga, visible tras un error— pero apagado: un segundo clic no
      dispara otra consulta en paralelo.
    */
    async function cargarRoster() {
      el.reintentar.disabled = true;
      el.grilla.setAttribute("aria-busy", "true");
      mostrarAviso(AVISOS.cargando, { error: false });

      let resultado = null;
      try {
        resultado = await listarColaboradores();
      } catch {
        // El servicio nunca lanza: esto es su script que no llegó a cargar
        // (ReferenceError). Para quien mira, es un fallo de carga más.
      } finally {
        el.grilla.setAttribute("aria-busy", "false");
        el.reintentar.disabled = false;
      }

      const lista = resultado?.ok && Array.isArray(resultado.data) ? resultado.data : null;
      montarRoster(lista ?? []);

      if (lista === null) {
        mostrarAviso(AVISOS.error, { error: true });
        el.reintentar.hidden = false;
        return false;
      }

      el.reintentar.hidden = true;
      if (lista.length === 0) mostrarAviso(AVISOS.vacio, { error: false });
      else ocultarAviso();

      if (!conectada) {
        conectada = true;
        window.addEventListener("hashchange", () => aplicarHash({ moverFoco: true }));
        // Sin await: el roster ya está pintado y no tiene por qué esperar a
        // dos consultas más. Cuando se sepa quién mira, el enlace de "Mi
        // ficha" se suma a su ficha.
        resolverIdentidad();
      }

      // Un enlace compartido (#/mariana) abre directo ese perfil, también si
      // llegó mientras la lista cargaba: antes de tenerla, cualquier slug
      // parecería desconocido y se habría limpiado. El foco no se toca.
      aplicarHash({ moverFoco: false });
      return true;
    }

    /*
      Tras un reintento, el botón que tenía el foco se oculta con el aviso (o
      sigue ahí si volvió a fallar). En ningún caso el foco queda en el <body>:
      va a lo primero que hay que leer de lo que quedó a la vista.
    */
    async function reintentarCarga() {
      const cargada = await cargarRoster();
      if (!cargada || fichas.length === 0) el.aviso.focus();
      else if (estado.vista === "perfil") el.perfilNombre.focus();
      // A la ficha elegida (un #/slug sin perfil ya la eligió), no a la primera:
      // el foco manda sobre la vista previa y Enter activaría a otra persona.
      else fichas[estado.seleccion ?? 0].focus();
    }

    function mostrarAviso(mensaje, { error }) {
      el.aviso.hidden = false;
      el.aviso.classList.toggle("colaboradores__aviso--error", error);
      escribir(el.avisoMensaje, mensaje);
    }

    function ocultarAviso() {
      el.aviso.hidden = true;
      el.aviso.classList.remove("colaboradores__aviso--error");
      escribir(el.avisoMensaje, "");
    }

    /* ---------- Quién está mirando ---------- */

    /*
      Lo único que depende de quién mira es el enlace de "Mi ficha": por eso
      acá no se repinta la pantalla, se decide otra vez qué ficha lo lleva. La
      vista abierta da igual — si es el perfil, el enlace ya queda puesto en el
      roster que hay debajo.
    */
    async function resolverIdentidad() {
      miSlug = await consultarMiSlug();
      decidirEnlacesDeEdicion();
    }

    /*
      El slug de quien mira, o null. Sólo el `true` de la columna cuenta, igual
      que en "Mi ficha", y el slug tiene que ser un texto con algo adentro:
      comparar contra "" o null haría propia la ficha de cualquiera que venga
      sin slug.

      No lanza NUNCA: sin sesión, con la red caída o con el script de auth sin
      cargar (ReferenceError), el enlace de editar simplemente no aparece. Es
      un extra de la página, no puede tumbarla.
    */
    async function consultarMiSlug() {
      try {
        const sesion = await obtenerSesion();
        if (!sesion) return null;

        const perfil = await obtenerPerfil(sesion);
        if (perfil?.es_colaborador !== true) return null;

        const slug = typeof perfil.slug === "string" ? perfil.slug.trim() : "";
        return slug || null;
      } catch {
        return null;
      }
    }

    // Con la identidad sin resolver (miSlug en null) la ficha no es de nadie:
    // sin ese guard, cualquier persona sin slug pasaría por propia.
    function esMiFicha(persona) {
      return miSlug !== null && persona?.slug === miSlug;
    }

    /*
      Los enlaces existen en todas las celdas y se muestran en una sola, la de
      quien mira. Se decide DOS veces —al montar la lista y al resolverse la
      identidad— y nunca al pintar: el enlace no sigue al cursor ni al foco, se
      queda en su ficha.
    */
    function decidirEnlacesDeEdicion() {
      enlacesDeEdicion.forEach((enlace, indice) => {
        enlace.hidden = !esMiFicha(colaboradores[indice]);
      });
    }

    /* ---------- Construcción (una vez por lista) ---------- */

    function montarRoster(lista) {
      colaboradores = lista;
      fichas = colaboradores.map(crearFicha);
      enlacesDeEdicion = colaboradores.map(crearEnlaceDeEdicion);
      celdas = fichas.map(envolverEnCelda);
      el.grilla.replaceChildren(...celdas);
      // Sin fichas, el marco sería una caja vacía debajo del aviso.
      el.marco.hidden = fichas.length === 0;
      // Las celdas nuevas no tienen posición todavía.
      medidaDelPanal = "";
      acomodarPanal();
      // La tarjeta de abajo existe para mostrar fichas de perfil. Se decide una
      // vez por lista y no por ficha: prenderla y apagarla al pasar el cursor
      // cambiaría el alto del marco y haría saltar la grilla entera.
      el.resumen.hidden = !colaboradores.some(tienePerfil);
      decidirEnlacesDeEdicion();
      pintar();
    }

    function crearFicha(persona, indice) {
      const boton = document.createElement("button");
      boton.type = "button";
      boton.className = "colaboradores__ficha";
      // El nombre corto de la ficha no alcanza para saber a quién se abre: el
      // nombre accesible lleva nombre completo y, si lo hay, el puesto.
      boton.setAttribute("aria-label", persona.puesto ? `${persona.nombre}, ${persona.puesto}` : persona.nombre);

      const nombre = crearDecorado("colaboradores__ficha-nombre", persona.corto);
      boton.append(
        crearDecorado("colaboradores__ficha-cabeza"),
        crearDecorado("colaboradores__ficha-torso"),
        crearDecorado("colaboradores__ficha-inicial", inicialDe(persona)),
      );
      const foto = fotoDe(persona);
      if (foto) {
        boton.classList.add(CLASE_FICHA_CON_FOTO);
        boton.append(crearFotoDeFicha(boton, foto));
      }
      boton.append(nombre);

      const resaltar = (origen) => () => { resaltado[origen] = indice; pintar(); };
      const soltar = (origen) => () => {
        // Un mouseleave o un blur tardío de la ficha ANTERIOR no debe apagar a
        // la actual: sólo se suelta si ese origen todavía apunta a ésta.
        if (resaltado[origen] !== indice) return;
        resaltado[origen] = null;
        pintar();
      };

      boton.addEventListener("mouseenter", resaltar("cursor"));
      boton.addEventListener("mouseleave", soltar("cursor"));
      boton.addEventListener("focus", resaltar("foco"));
      boton.addEventListener("focus", () => traerAlCentro(indice, boton));
      boton.addEventListener("blur", soltar("foco"));
      boton.addEventListener("click", () => elegirFicha(indice));

      return boton;
    }

    // La foto va ANTES del nombre en el DOM (que hoy la hoja no pinta).
    // Decorativa (alt vacío): el aria-label del botón ya nombra a la
    // persona.
    function crearFotoDeFicha(boton, url) {
      const imagen = document.createElement("img");
      imagen.className = "colaboradores__ficha-foto";
      imagen.setAttribute("alt", "");
      imagen.setAttribute("loading", "lazy");
      imagen.setAttribute("decoding", "async");
      imagen.setAttribute("draggable", "false");
      imagen.setAttribute("src", url);
      imagen.addEventListener("error", () => {
        fotosRotas.add(url);
        imagen.hidden = true;
        boton.classList.remove(CLASE_FICHA_CON_FOTO);
        pintar();
      });
      return imagen;
    }

    // Las iniciales y el nombre corto repiten lo que ya dice el
    // aria-label del botón: para un lector de pantalla son ruido.
    function crearDecorado(clase, texto) {
      const nodo = document.createElement("span");
      nodo.className = clase;
      nodo.setAttribute("aria-hidden", "true");
      if (texto) nodo.textContent = texto;
      return nodo;
    }

    /*
      El enlace a "Mi ficha" de una celda. Se crea para todas y se muestra en
      una: decidirEnlacesDeEdicion() lo decide cuando se sabe quién mira, que
      es después de que la lista ya está en pantalla.

      "Editar" a secas no dice de quién, así que el nombre accesible lo aclara;
      el texto visible sigue corto porque el círculo mide ~63px en móvil.
    */
    function crearEnlaceDeEdicion() {
      const enlace = document.createElement("a");
      enlace.className = "colaboradores__editar";
      enlace.href = RUTA_MI_FICHA;
      enlace.setAttribute("aria-label", "Editar mi ficha");
      // El aviso del cursor dice lo que el lápiz sólo sugiere.
      enlace.setAttribute("title", "Editar mi ficha");
      enlace.append(crearIconoLapiz());
      enlace.setAttribute("draggable", "false");
      enlace.hidden = true;
      return enlace;
    }

    // Un lápiz en trazos, como los iconos del editor de foto de "Mi ficha".
    // Decorativo: el nombre accesible lo pone el aria-label del enlace.
    function crearIconoLapiz() {
      const ns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("focusable", "false");
      for (const trazo of ["M4 20h4L19 9l-4-4L4 16v4z", "M14 6l4 4"]) {
        const camino = document.createElementNS(ns, "path");
        camino.setAttribute("d", trazo);
        svg.append(camino);
      }
      return svg;
    }

    /*
      El enlace va en la CELDA y no dentro del botón: un <a> dentro de un
      <button> es HTML inválido. Va DESPUÉS de él —la ficha es la acción
      principal de la celda, el enlace su extra— y la hoja lo apila al pie del
      círculo.
    */
    function envolverEnCelda(boton, indice) {
      const celda = document.createElement("li");
      celda.className = "colaboradores__celda";
      celda.append(boton, enlacesDeEdicion[indice]);
      return celda;
    }

    /*
      Aplica a las celdas lo que calcula posicionesDelPanal(): centro, diámetro
      y escala de cada una. Sólo escribe estilos; el orden del DOM no se toca.

      En escritorio el panal llena el marco, cuyo alto manda la ventana. En
      móvil no hay alto que llenar: se calcula con el ancho y el panal se da el
      alto que el racimo necesita. Se lee SÓLO el ancho para decidirlo, así que
      fijar ese alto no vuelve a disparar el cálculo.
    */
    function acomodarPanal() {
      const ancho = el.grilla.clientWidth;
      if (!(ancho > 0) || celdas.length === 0) return;

      const movil = typeof window.matchMedia === "function" && window.matchMedia("(max-width: 760px)").matches;
      const necesario = Math.ceil(posicionesDelPanal(celdas.length, ancho, ancho).altoNecesario);
      // clientHeight y no innerHeight: no cambia cuando la barra del navegador
      // se esconde al scrollear, así que el panal no se reacomoda a medio gesto.
      const tope = Math.floor((document.documentElement.clientHeight || 0) * ALTO_MAXIMO_MOVIL);
      const alto = movil
        ? (tope > 0 ? Math.min(necesario, tope) : necesario)
        : el.grilla.clientHeight;
      if (!(alto > 0)) return;

      const medida = `${movil ? "m" : "d"}|${celdas.length}|${ancho}|${alto}`;
      if (medida === medidaDelPanal) return;
      medidaDelPanal = medida;

      // Móvil: alto propio (y sin el piso de la hoja, que lo falsearía).
      // Escritorio: se devuelve al marco.
      el.grilla.style.blockSize = movil ? `${alto}px` : "";
      el.grilla.style.minBlockSize = movil ? `${alto}px` : "";

      const { diametro, posiciones } = posicionesDelPanal(celdas.length, ancho, alto);
      base = posiciones.map(({ x, y }) => ({ x: x - ancho / 2, y: y - alto / 2 }));
      diametroBase = diametro;
      areaAncho = ancho;
      areaAlto = alto;
      esMovil = movil;

      // Un cambio de medida puede dejar el pan fuera de los límites nuevos,
      // así que se recorta. El zoom se conserva.
      const l = limitesDelPan();
      vista.panX = recortar(vista.panX, l.minX, l.maxX);
      vista.panY = recortar(vista.panY, l.minY, l.maxY);
      pintarPanal();
    }

    /* ---------- Vista del panal: arrastre, zoom e inercia ---------- */

    function recortar(valor, min, max) {
      return Math.min(Math.max(valor, min), max);
    }

    // Función y no `const`: vive después del `return` de iniciar() y una
    // constante ahí nunca llegaría a inicializarse.
    function movimientoReducido() {
      return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    /*
      El centro de la vista puede recorrer la caja del racimo (escalada por el
      zoom): así cualquier círculo puede llegar al centro, y ni uno más. Un
      círculo en base.x queda centrado con pan = -base.x · zoom.
    */
    function limitesDelPan() {
      if (base.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
      const xs = base.map((p) => p.x);
      const ys = base.map((p) => p.y);
      const z = vista.zoom;
      return {
        minX: -Math.max(...xs) * z,
        maxX: -Math.min(...xs) * z,
        minY: -Math.max(...ys) * z,
        maxY: -Math.min(...ys) * z,
      };
    }

    // El pan que se ve: el crudo, con la resistencia elástica fuera de límites.
    function panVisible() {
      const l = limitesDelPan();
      return {
        x: limitarDesplazamiento(vista.panX, l.minX, l.maxX),
        y: limitarDesplazamiento(vista.panY, l.minY, l.maxY),
      };
    }

    /*
      Escribe en cada celda lo mismo que antes: centro, diámetro y escala. El
      centro es `centro + base·zoom + pan`; la escala se recalcula con la
      distancia al centro del MARCO, no del racimo, así que el círculo que
      llega al medio crece y los que se van a las orillas se achican.
    */
    function pintarPanal() {
      if (celdas.length === 0 || base.length !== celdas.length || !(areaAncho > 0)) return;
      const z = vista.zoom;
      const pan = panVisible();
      const diametro = diametroBase * z;
      celdas.forEach((celda, indice) => {
        const dx = base[indice].x * z + pan.x;
        const dy = base[indice].y * z + pan.y;
        celda.style.left = `${(areaAncho / 2 + dx).toFixed(1)}px`;
        celda.style.top = `${(areaAlto / 2 + dy).toFixed(1)}px`;
        celda.style.setProperty("--diametro", `${diametro.toFixed(1)}px`);
        celda.style.setProperty("--escala", escalaEnPanal(dx, dy, areaAncho, areaAlto).toFixed(3));
      });
    }

    function arrancarCuadros() {
      if (cuadro) return;
      ultimoCuadro = performance.now();
      cuadro = requestAnimationFrame(cuadroDeAnimacion);
    }

    function detenerCuadros() {
      if (cuadro) cancelAnimationFrame(cuadro);
      cuadro = 0;
      inercia.x = 0;
      inercia.y = 0;
      destino = null;
    }

    // Corta cualquier gesto o animación (cambio a móvil, vista de perfil).
    function cancelarGestos() {
      detenerCuadros();
      dedos.clear();
      pellizco = null;
      multitoque = false;
      if (arrastre) {
        const id = arrastre.id;
        arrastre = null;
        el.marco.classList.remove(CLASE_MARCO_ARRASTRANDO);
        try { el.marco.releasePointerCapture(id); } catch { /* ya soltado */ }
      }
    }

    /*
      El único bucle de animación. Cada cuadro avanza la inercia (con un
      resorte hacia el límite si se pasó) o el viaje a `destino`, y se vuelve a
      pedir SOLO si algo sigue moviéndose: nunca queda un rAF girando en vacío.
    */
    function cuadroDeAnimacion(ahora) {
      cuadro = 0;
      const dt = Math.min(Math.max(ahora - ultimoCuadro, 1), 32);
      ultimoCuadro = ahora;
      const l = limitesDelPan();
      let sigue = false;

      if (destino) {
        const k = 1 - Math.exp(-dt / 90);
        vista.panX += (destino.x - vista.panX) * k;
        vista.panY += (destino.y - vista.panY) * k;
        if (Math.hypot(destino.x - vista.panX, destino.y - vista.panY) < 0.5) {
          vista.panX = destino.x;
          vista.panY = destino.y;
          destino = null;
        } else {
          sigue = true;
        }
      } else {
        for (const [eje, min, max] of [["x", l.minX, l.maxX], ["y", l.minY, l.maxY]]) {
          const clave = eje === "x" ? "panX" : "panY";
          let posicion = vista[clave];
          // Fuera de límites la fricción sube: el rebote no se estira.
          const paso = pasoDeInercia(inercia[eje], dt, posicion < min || posicion > max ? 0.03 : 0.004);
          inercia[eje] = paso.velocidad;
          posicion += paso.velocidad * dt;
          if (!paso.frenado) sigue = true;

          const limite = recortar(posicion, min, max);
          if (posicion !== limite) {
            posicion += (limite - posicion) * (1 - Math.exp(-dt / 110));
            if (Math.abs(limite - posicion) < 0.5) {
              posicion = limite;
              inercia[eje] = 0;
            } else {
              sigue = true;
            }
          }
          vista[clave] = posicion;
        }
      }

      pintarPanal();
      if (sigue) cuadro = requestAnimationFrame(cuadroDeAnimacion);
    }

    // Lleva el pan crudo adentro de los límites: de golpe con movimiento
    // reducido, con el resorte del bucle si no.
    function volverALosLimites() {
      const l = limitesDelPan();
      const x = recortar(vista.panX, l.minX, l.maxX);
      const y = recortar(vista.panY, l.minY, l.maxY);
      if (x === vista.panX && y === vista.panY) return;
      if (movimientoReducido()) {
        vista.panX = x;
        vista.panY = y;
        pintarPanal();
      } else {
        arrancarCuadros();
      }
    }

    function empezarArrastre(evento) {
      if (fichas.length === 0) return;
      // Mouse sólo con el botón izquierdo; dedo y lápiz sólo en móvil.
      if (evento.pointerType === "mouse") {
        if (evento.button !== 0) return;
      } else {
        if (!esMovil) return;
        dedos.set(evento.pointerId, { x: evento.clientX, y: evento.clientY });
        // El segundo dedo convierte el gesto en pellizco; un tercero no
        // cambia nada (el pellizco sigue con los dos primeros).
        if (dedos.size >= 2) {
          multitoque = true;
          if (dedos.size === 2) empezarPellizco();
          return;
        }
      }
      if (arrastre) return;
      // El enlace «Editar» es un clic de verdad, no un agarre.
      if (evento.target.closest?.(".colaboradores__editar")) return;

      detenerCuadros();
      tragarClic = false;
      arrastre = {
        id: evento.pointerId,
        umbral: evento.pointerType === "mouse" ? UMBRAL_ARRASTRE : UMBRAL_ARRASTRE_TACTIL,
        x0: evento.clientX,
        y0: evento.clientY,
        panX0: vista.panX,
        panY0: vista.panY,
        activo: false,
        muestras: [],
      };
    }

    function moverArrastre(evento) {
      if (dedos.has(evento.pointerId)) dedos.set(evento.pointerId, { x: evento.clientX, y: evento.clientY });
      if (pellizco) {
        moverPellizco();
        return;
      }
      if (!arrastre || evento.pointerId !== arrastre.id) return;

      if (!arrastre.activo) {
        // Menos de 5px sigue siendo un clic con la mano temblando.
        if (Math.hypot(evento.clientX - arrastre.x0, evento.clientY - arrastre.y0) < arrastre.umbral) return;
        arrastre.activo = true;
        // La captura se pide hasta aquí: capturar al apretar desviaría el clic
        // de la ficha hacia el marco.
        try { el.marco.setPointerCapture(arrastre.id); } catch { /* sin captura el arrastre sigue */ }
        el.marco.classList.add(CLASE_MARCO_ARRASTRANDO);
        // El agarre arranca aquí, sin el salto de los primeros 5px.
        arrastre.x0 = evento.clientX;
        arrastre.y0 = evento.clientY;
      }

      vista.panX = arrastre.panX0 + (evento.clientX - arrastre.x0);
      vista.panY = arrastre.panY0 + (evento.clientY - arrastre.y0);
      const ahora = performance.now();
      arrastre.muestras.push({ t: ahora, x: evento.clientX, y: evento.clientY });
      while (arrastre.muestras.length > 1 && ahora - arrastre.muestras[0].t > VENTANA_DE_VELOCIDAD) {
        arrastre.muestras.shift();
      }
      pintarPanal();
    }

    function terminarArrastre(evento) {
      if (dedos.delete(evento.pointerId) && multitoque) {
        terminarDedoDeMultitoque();
        return;
      }
      if (!arrastre || evento.pointerId !== arrastre.id) return;
      // Primero se limpia el estado: releasePointerCapture puede lanzar.
      const gesto = arrastre;
      arrastre = null;
      el.marco.classList.remove(CLASE_MARCO_ARRASTRANDO);
      try { el.marco.releasePointerCapture(gesto.id); } catch { /* ya soltado */ }

      if (!gesto.activo) {
        // Un clic que pausó la inercia a medias no deja el panal pasado del borde.
        volverALosLimites();
        return;
      }

      // El navegador dispara un clic tras soltar: se traga. Si no llega, la
      // bandera se apaga sola en la siguiente vuelta del bucle de eventos.
      tragarClic = true;
      setTimeout(() => { tragarClic = false; }, 0);

      if (movimientoReducido()) {
        const l = limitesDelPan();
        vista.panX = recortar(vista.panX, l.minX, l.maxX);
        vista.panY = recortar(vista.panY, l.minY, l.maxY);
        pintarPanal();
        return;
      }

      const ahora = performance.now();
      const recientes = gesto.muestras.filter((m) => ahora - m.t <= VENTANA_DE_VELOCIDAD);
      if (evento.type === "pointerup" && recientes.length >= 2) {
        const primera = recientes[0];
        const ultima = recientes[recientes.length - 1];
        const tiempo = ultima.t - primera.t;
        if (tiempo > 0) {
          const tope = (v) => recortar(v, -VELOCIDAD_MAXIMA, VELOCIDAD_MAXIMA);
          inercia.x = tope((ultima.x - primera.x) / tiempo);
          inercia.y = tope((ultima.y - primera.y) / tiempo);
        }
      }
      arrancarCuadros();
    }

    // Los dos primeros dedos apoyados: el pellizco se mide siempre con ellos.
    function dosDedos() {
      const [a, b] = dedos.values();
      return [a, b];
    }

    /*
      El pellizco arranca (o se vuelve a basar) con los dos primeros dedos.
      Guarda el punto medio relativo al centro de la grilla: el punto del
      panal que está entre los dedos se queda entre ellos al acercar o alejar,
      y sigue al punto medio si los dedos se trasladan.
    */
    function empezarPellizco() {
      const [a, b] = dosDedos();
      detenerCuadros();
      if (arrastre) {
        try { el.marco.releasePointerCapture(arrastre.id); } catch { /* ya soltado */ }
        arrastre = null;
      }
      const caja = el.grilla.getBoundingClientRect();
      const cx = caja.left + caja.width / 2;
      const cy = caja.top + caja.height / 2;
      const pan = panVisible();
      vista.panX = pan.x;
      vista.panY = pan.y;
      pellizco = {
        cx,
        cy,
        d0: Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1),
        zoom0: vista.zoom,
        mx0: (a.x + b.x) / 2 - cx,
        my0: (a.y + b.y) / 2 - cy,
        panX0: pan.x,
        panY0: pan.y,
      };
      el.marco.classList.add(CLASE_MARCO_ARRASTRANDO);
    }

    // Misma cuenta que hacerZoom() con la rueda: pan' = m − (m0 − pan0)·(z'/z0).
    function moverPellizco() {
      if (dedos.size < 2) return;
      const [a, b] = dosDedos();
      const p = pellizco;
      const zoom = recortar(p.zoom0 * (Math.hypot(b.x - a.x, b.y - a.y) / p.d0), ZOOM_MIN, ZOOM_MAX);
      const factor = zoom / p.zoom0;
      vista.zoom = zoom;
      vista.panX = (a.x + b.x) / 2 - p.cx - (p.mx0 - p.panX0) * factor;
      vista.panY = (a.y + b.y) / 2 - p.cy - (p.my0 - p.panY0) * factor;
      pintarPanal();
    }

    /*
      Se levantó un dedo de un gesto que tuvo dos o más. Si quedan dos, el
      pellizco se vuelve a basar en ellos; si queda uno, sigue arrastrando
      desde donde está (sin salto); si no queda ninguno, el panal vuelve a sus
      límites y el clic que el navegador pueda disparar se traga.
    */
    function terminarDedoDeMultitoque() {
      if (dedos.size >= 2) {
        empezarPellizco();
        return;
      }
      pellizco = null;
      if (dedos.size === 1) {
        const [[id, dedo]] = dedos;
        arrastre = {
          id,
          umbral: UMBRAL_ARRASTRE_TACTIL,
          x0: dedo.x,
          y0: dedo.y,
          panX0: vista.panX,
          panY0: vista.panY,
          activo: true,
          muestras: [],
        };
        return;
      }
      arrastre = null;
      multitoque = false;
      el.marco.classList.remove(CLASE_MARCO_ARRASTRANDO);
      // iOS puede disparar el clic un poco después del último touchend: la
      // ventana es más larga que la del arrastre de un dedo.
      tragarClic = true;
      setTimeout(() => { tragarClic = false; }, 350);
      volverALosLimites();
    }

    /*
      La rueda hace zoom y deja fijo el punto que está bajo el cursor: con
      p = base·zoom + pan, mantener p al cambiar de zoom obliga a
      pan' = p − (p − pan)·(zoom'/zoom).
    */
    function hacerZoom(evento) {
      if (esMovil || fichas.length === 0 || !(areaAncho > 0)) return;
      evento.preventDefault();

      const lineas = evento.deltaMode === 1 ? 16 : 1;
      const nuevo = recortar(vista.zoom * Math.exp(-evento.deltaY * lineas * 0.0015), ZOOM_MIN, ZOOM_MAX);
      if (nuevo === vista.zoom) return;

      detenerCuadros();
      const caja = el.grilla.getBoundingClientRect();
      const px = evento.clientX - (caja.left + caja.width / 2);
      const py = evento.clientY - (caja.top + caja.height / 2);
      const pan = panVisible();
      const factor = nuevo / vista.zoom;
      vista.zoom = nuevo;
      const l = limitesDelPan();
      vista.panX = recortar(px - (px - pan.x) * factor, l.minX, l.maxX);
      vista.panY = recortar(py - (py - pan.y) * factor, l.minY, l.maxY);
      pintarPanal();
    }

    /*
      Con teclado, Tab puede caer en un círculo que el arrastre o el zoom sacó
      del marco; si queda (aunque sea en parte) fuera, se centra. Con mouse no:
      enfocar al apretar no debe mover nada bajo el cursor.
    */
    function traerAlCentro(indice, boton) {
      if (arrastre || !(areaAncho > 0) || !base[indice]) return;
      // Enfocar un elemento fuera de un contenedor `overflow: hidden` lo
      // desplaza; la geometría es nuestra, así que se deshace.
      el.marco.scrollLeft = 0;
      el.marco.scrollTop = 0;
      el.grilla.scrollLeft = 0;
      el.grilla.scrollTop = 0;

      let porTeclado = false;
      try { porTeclado = boton.matches(":focus-visible"); } catch { /* selector no soportado */ }
      if (!porTeclado) return;

      const z = vista.zoom;
      const pan = panVisible();
      const dx = base[indice].x * z + pan.x;
      const dy = base[indice].y * z + pan.y;
      const radio = (diametroBase * z * escalaEnPanal(dx, dy, areaAncho, areaAlto)) / 2;
      const dentro = Math.abs(dx) + radio <= areaAncho / 2 && Math.abs(dy) + radio <= areaAlto / 2;
      if (dentro) return;

      const l = limitesDelPan();
      const objetivo = {
        x: recortar(-base[indice].x * z, l.minX, l.maxX),
        y: recortar(-base[indice].y * z, l.minY, l.maxY),
      };
      detenerCuadros();
      if (movimientoReducido()) {
        vista.panX = objetivo.x;
        vista.panY = objetivo.y;
        pintarPanal();
      } else {
        vista.panX = pan.x;
        vista.panY = pan.y;
        destino = objetivo;
        arrancarCuadros();
      }
    }

    /* ---------- Transiciones de estado ---------- */

    // Sin ficha de perfil no hay perfil que abrir: el clic sólo la deja
    // elegida, y el hash (el historial) no se toca.
    function elegirFicha(indice) {
      if (tienePerfil(colaboradores[indice])) {
        abrirPerfil(indice);
        return;
      }
      estado.seleccion = indice;
      pintar();
    }

    /*
      Abrir un perfil sólo escribe el hash: la entrada de historial que crea es
      la que el botón atrás del navegador deshace para volver al roster. Quien
      pinta es aplicarHash(), al llegar el hashchange.
    */
    function abrirPerfil(indice) {
      window.location.hash = rutaDePerfil(indice);
    }

    function rutaDePerfil(indice) {
      return `#/${colaboradores[indice].slug}`;
    }

    /*
      El hash es la fuente de verdad de la vista: #/<slug> de alguien con ficha
      de perfil es su perfil; cualquier otra cosa, el roster. Por acá pasan el
      clic en una ficha, atrás y adelante, y un enlace compartido.
    */
    function aplicarHash({ moverFoco }) {
      const hash = window.location.hash;
      const esRutaDePerfil = hash.startsWith("#/");
      const indice = esRutaDePerfil ? indicePorSlug(colaboradores, hash.slice(2)) : -1;
      const vistaAnterior = estado.vista;

      if (indice !== -1 && tienePerfil(colaboradores[indice])) {
        estado.seleccion = indice;
        estado.vista = "perfil";
        resaltado.cursor = null;
        resaltado.foco = null;
      } else {
        estado.vista = "roster";
        // Alguien que existe pero todavía no tiene ficha: queda elegido en el
        // roster, igual que si hubieran hecho clic en su ficha.
        if (indice !== -1) estado.seleccion = indice;
        // Un #/<slug> que no abre un perfil no se deja en la barra:
        // replaceState corrige la URL sin crear otra entrada ni volver a
        // emitir hashchange. Sólo los #/: otro hash puede ser de otro script
        // (el cliente de Supabase lee de ahí los tokens de sesión y los limpia él).
        if (esRutaDePerfil) {
          window.history.replaceState(null, "", window.location.pathname + window.location.search);
        }
      }

      pintar();
      if (moverFoco && estado.vista !== vistaAnterior) enfocarVista();
    }

    // La vista que tenía el foco acaba de ocultarse; sin moverlo, cae al
    // <body> y el teclado arranca otra vez desde el navbar.
    function enfocarVista() {
      if (estado.vista === "perfil") {
        // El nombre es lo primero que hay que leer del perfil.
        el.perfilNombre.focus();
      } else {
        // De vuelta a la ficha del perfil que se estaba viendo, no al principio
        // de la grilla ni a la que se abrió primero: si se cambió de perfil
        // desde la barra, es la del último.
        fichas[estado.seleccion]?.focus();
      }
    }

    /* ---------- Pintado ---------- */

    function pintar() {
      // Un perfil sin ficha completa no existe: cualquier estado incoherente
      // cae al roster.
      const hayPerfil = estado.vista === "perfil" && tienePerfil(colaboradores[estado.seleccion]);

      el.roster.hidden = hayPerfil;
      // Con el roster oculto no hay nada que animar ni arrastrar.
      if (hayPerfil) cancelarGestos();
      el.perfil.hidden = !hayPerfil;

      if (hayPerfil) pintarPerfil(estado.seleccion);
      else pintarRoster();
    }

    function pintarRoster() {
      const mostrada = resaltado.cursor ?? resaltado.foco ?? estado.seleccion;
      const persona = colaboradores[mostrada] ?? null;
      // Sin ficha de perfil, de la persona sólo se muestra el nombre.
      const ficha = persona && tienePerfil(persona) ? persona : null;
      const soloNombre = persona !== null && ficha === null;

      /*
        La ficha se enciende SÓLO bajo el cursor, y por eso acá no entra ni el
        foco ni la elección. El resplandor del teclado lo pone `:focus-visible`
        en la hoja: el navegador es quien sabe si el foco llegó con Tab o con
        un clic, y el script no tiene por qué adivinarlo.

        La elección tampoco deja marca: la que había se quedaba pegada al
        volver de un perfil, con el mouse lejos. Sigue existiendo —decide a
        quién vuelve la vista previa y qué ficha recibe el foco—, pero no se
        pinta.
      */
      fichas.forEach((boton, indice) => {
        boton.classList.toggle("colaboradores__ficha--activa", indice === resaltado.cursor);
      });

      // Cada escritura se salta si el texto no cambió: las regiones aria-live
      // vuelven a anunciarse al reescribirlas, aunque sea con lo mismo.
      pintarFoto(el.previaFoto, el.previaRetrato, fotoDe(persona));
      escribir(el.previaInicial, persona ? inicialDe(persona) : VACIA.inicial);
      escribir(el.previaNombre, persona ? persona.nombre : VACIA.nombre);

      // El puesto se oculta en vez de quedar vacío: un <p> vacío igual
      // conserva sus márgenes.
      el.previaRol.hidden = soloNombre;
      escribir(el.previaRol, textoDePrevia(ficha, soloNombre, "puesto"));

      // La bio NO se oculta: vive en la tarjeta de abajo, y ocultarla cambiaría
      // su alto con cada ficha bajo el cursor. Queda vacía, con su piso.
      escribir(el.previaBio, textoDePrevia(ficha, soloNombre, "bio"));
      el.previaBio.classList.toggle("colaboradores__bio--vacia", !ficha);

      pintarEnlaces(el.previaEnlaces, ficha);
    }

    // Con ficha, su campo; sin ficha, nada; sin nadie a la vista, la invitación.
    function textoDePrevia(ficha, soloNombre, campo) {
      if (ficha) return ficha[campo];
      return soloNombre ? "" : VACIA[campo];
    }

    function pintarPerfil(indice) {
      const ficha = colaboradores[indice];

      escribir(el.perfilNumero, numeroDeFicha(indice));
      pintarFoto(el.perfilFoto, el.perfilRetrato, fotoDe(ficha));
      escribir(el.perfilInicial, inicialDe(ficha));
      escribir(el.perfilNombre, ficha.nombre);
      escribir(el.perfilPuesto, ficha.puesto);
      pintarEmpresa(ficha);
      escribirEnCelda(el.perfilSector, el.perfilSectorCelda, ficha.sector);
      escribir(el.perfilUbicacion, ficha.ubicacion);
      // La base guarda el año de inicio; los años se cuentan al pintar.
      escribir(el.perfilExperiencia, experienciaDesde(ficha.anio_inicio, new Date().getFullYear()));
      escribir(el.perfilModalidadTrabajo, ficha.modalidad_trabajo);
      // En el mismo orden que el marcado: primero lo que la persona sabe
      // hacer, después con qué lo hace. Herramientas no lleva celda porque es
      // obligatoria: su fila siempre tiene algo que mostrar. Las otras dos son
      // opcionales y se ocultan enteras.
      pintarEtiquetas(el.perfilHabilidades, ficha.habilidades, el.perfilHabilidadesCelda);
      pintarEtiquetas(el.perfilHerramientas, ficha.herramientas);
      pintarEtiquetas(el.perfilIdiomas, ficha.idiomas, el.perfilIdiomasCelda);
      escribir(el.perfilBio, ficha.bio);

      pintarEnlaces(el.perfilEnlaces, ficha);
    }

    /*
      Una lista de etiquetas en píldoras, una por elemento: calcada de
      pintarEnlaces(), sin enlace porque acá no hay nada a donde ir. La usan
      las tres (herramientas, habilidades e idiomas). El separador " · " no
      sirve de límite cuando una etiqueta lo trae adentro de su propio nombre
      (por ejemplo "System Architecture (GCloud · Supabase)"); cada elemento
      del arreglo es una etiqueta propia y no se vuelve a partir por texto.

      La lista queda `hidden` si viene vacía: una <ul> vacía igual ocupa su
      hueco en el flex y se anuncia como "lista, 0 elementos".

      `celda` es opcional y sólo la pasan las listas opcionales: con ella se
      oculta la celda ENTERA, porque esconder nada más la <ul> dejaría su
      rótulo ("HABILIDADES", en versalitas) flotando sobre el vacío. El
      `hidden` gana gracias a `.colaboradores [hidden] { display: none }` de
      la hoja: sin esa regla, el `display: flex` de la <ul> se lo comería.
    */
    function pintarEtiquetas(lista, etiquetas, celda) {
      const elementos = etiquetas || [];

      lista.replaceChildren(...elementos.map((etiqueta) => {
        const item = document.createElement("li");
        item.className = "colaboradores__etiquetas-item";
        item.textContent = etiqueta;
        return item;
      }));
      lista.hidden = elementos.length === 0;
      if (celda) celda.hidden = elementos.length === 0;
    }

    /*
      La empresa: con enlace válido el nombre es clicable, sin enlace queda
      como texto plano, y sin nombre se oculta la celda entera (si no, quedaría
      "EMPRESA" en versalitas sobre el vacío).

      Quién decide es empresaDelPerfil(), en la capa pura: el href sale de
      datos y pasa por lista blanca ANTES de tocar el DOM. Acá no se vuelve a
      mirar el texto del enlace — si esta función empezara a decidir por su
      cuenta, habría dos criterios y uno de los dos se quedaría viejo.

      `target="_blank"` con `rel="noopener noreferrer"`, los dos y siempre,
      como el resto de los enlaces externos de la app.

      El contenido se REEMPLAZA siempre, nunca con escribir(): esa se salta la
      escritura cuando el texto no cambió, y una empresa que se llama igual
      que la del perfil anterior pero perdió su enlace dejaría el <a> viejo
      pegado, apuntando a otro sitio.
    */
    function anclaDeEmpresa({ nombre, href }) {
      const ancla = document.createElement("a");
      ancla.className = "colaboradores__enlace-empresa";
      ancla.href = href;
      ancla.target = "_blank";
      ancla.rel = "noopener noreferrer";
      ancla.textContent = nombre;
      return ancla;
    }

    function pintarEmpresa(ficha) {
      const empresa = empresaDelPerfil(ficha);
      el.perfilEmpresaCelda.hidden = !empresa;
      if (!empresa) { el.perfilEmpresa.replaceChildren(); return; }

      el.perfilEmpresa.replaceChildren(empresa.href ? anclaDeEmpresa(empresa) : document.createTextNode(empresa.nombre));
    }

    // La lista queda `hidden` si no hay ninguno: una <ul> vacía igual ocupa su
    // hueco en el flex y se anuncia como "lista, 0 elementos".
    function pintarEnlaces(lista, ficha) {
      const enlaces = ficha ? enlacesDisponibles(ficha) : [];

      lista.replaceChildren(...enlaces.map((enlace) => {
        const ancla = document.createElement("a");
        ancla.className = "colaboradores__enlace";
        ancla.href = enlace.href;
        if (enlace.tipo !== "correo") {
          ancla.target = "_blank";
          ancla.rel = "noopener noreferrer";
        }

        const sigla = document.createElement("span");
        sigla.className = "colaboradores__enlace-sigla";
        sigla.setAttribute("aria-hidden", "true");
        sigla.textContent = SIGLAS_DE_ENLACE[enlace.tipo] || "";

        ancla.append(sigla, document.createTextNode(enlace.texto));

        const item = document.createElement("li");
        item.append(ancla);
        return item;
      }));
      lista.hidden = enlaces.length === 0;
    }
  }

  function escribir(nodo, texto) {
    if (nodo.textContent !== texto) nodo.textContent = texto;
  }

  /*
    Un texto opcional de la ficha técnica: se escribe si hay algo y su celda
    ENTERA desaparece si no, por lo mismo que las listas de etiquetas —dejar
    sólo el <dd> vacío abandona su rótulo en versalitas sobre la nada—. El
    texto se limpia igual al ocultar: una celda escondida que se guarda lo
    viejo adentro lo muestra en cuanto vuelve a aparecer con otra ficha.
  */
  function escribirEnCelda(nodo, celda, texto) {
    const valor = typeof texto === "string" ? texto.trim() : "";
    celda.hidden = valor === "";
    escribir(nodo, valor);
  }

  // La URL de la foto de una persona, o null si no tiene o ya falló al cargar.
  function fotoDe(persona) {
    const url = persona?.foto;
    return typeof url === "string" && url !== "" && !fotosRotas.has(url) ? url : null;
  }

  /*
    Muestra u oculta la foto de un retrato. El `src` se escribe sólo si cambió
    y NO se quita al ocultarla: una imagen oculta no se ve ni se anuncia, y
    quitárselo haría que volver a pasar el cursor por la misma ficha reiniciara
    la carga.
  */
  function pintarFoto(imagen, retrato, url) {
    if (url && imagen.getAttribute("src") !== url) imagen.setAttribute("src", url);
    imagen.hidden = !url;
    retrato.classList.toggle(CLASE_RETRATO_CON_FOTO, Boolean(url));
  }

  function inicialDe(ficha) {
    return String(ficha?.nombre || "").trim().charAt(0).toUpperCase();
  }

  document.addEventListener("DOMContentLoaded", iniciar);
})();
