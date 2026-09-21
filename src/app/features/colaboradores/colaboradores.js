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
      previaInicial: porId("previaInicial"),
      previaNombre: porId("previaNombre"),
      previaRol: porId("previaRol"),
      previaBio: porId("previaBio"),
      previaEnlaces: porId("previaEnlaces"),
      perfilNumero: porId("perfilNumero"),
      perfilInicial: porId("perfilInicial"),
      perfilEnlaces: porId("perfilEnlaces"),
      perfilNombre: porId("perfilNombre"),
      perfilPuesto: porId("perfilPuesto"),
      perfilSector: porId("perfilSector"),
      perfilUbicacion: porId("perfilUbicacion"),
      perfilExperiencia: porId("perfilExperiencia"),
      perfilModalidadTrabajo: porId("perfilModalidadTrabajo"),
      perfilHerramientas: porId("perfilHerramientas"),
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
      el.grilla.replaceChildren(...fichas.map(envolverEnCelda));
      // Sin fichas, el marco sería una caja vacía debajo del aviso.
      el.marco.hidden = fichas.length === 0;
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
        nombre,
      );

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
      boton.addEventListener("blur", soltar("foco"));
      boton.addEventListener("click", () => elegirFicha(indice));

      return boton;
    }

    // Siluetas, iniciales y el nombre corto repiten lo que ya dice el
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
      el texto visible sigue corto porque la ficha mide ~78px de ancho.
    */
    function crearEnlaceDeEdicion() {
      const enlace = document.createElement("a");
      enlace.className = "colaboradores__editar";
      enlace.href = RUTA_MI_FICHA;
      enlace.setAttribute("aria-label", "Editar mi ficha");
      enlace.textContent = "Editar";
      enlace.hidden = true;
      return enlace;
    }

    /*
      El enlace va en la CELDA y no dentro del botón: un <a> dentro de un
      <button> es HTML inválido. Va DESPUÉS de él —la ficha es la acción
      principal de la celda, el enlace su extra— y la hoja lo apila en la
      esquina de arriba, lejos de la franja del nombre.
    */
    function envolverEnCelda(boton, indice) {
      const celda = document.createElement("li");
      celda.className = "colaboradores__celda";
      celda.append(boton, enlacesDeEdicion[indice]);
      return celda;
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
      escribir(el.perfilInicial, inicialDe(ficha));
      escribir(el.perfilNombre, ficha.nombre);
      escribir(el.perfilPuesto, ficha.puesto);
      escribir(el.perfilSector, ficha.sector);
      escribir(el.perfilUbicacion, ficha.ubicacion);
      // La base guarda el año de inicio; los años se cuentan al pintar.
      escribir(el.perfilExperiencia, experienciaDesde(ficha.anio_inicio, new Date().getFullYear()));
      escribir(el.perfilModalidadTrabajo, ficha.modalidad_trabajo);
      pintarEtiquetas(el.perfilHerramientas, ficha.herramientas);
      escribir(el.perfilBio, ficha.bio);

      pintarEnlaces(el.perfilEnlaces, ficha);
    }

    /*
      Las herramientas en píldoras, una por elemento: calcada de
      pintarEnlaces(), sin enlace porque acá no hay nada a donde ir. El
      separador " · " no sirve de límite cuando una herramienta lo trae
      adentro de su propio nombre (por ejemplo "System Architecture (GCloud ·
      Supabase)"); cada elemento del arreglo es una etiqueta propia y no se
      vuelve a partir por texto.

      La lista queda `hidden` si las herramientas vienen vacías: una <ul>
      vacía igual ocupa su hueco en el flex y se anuncia como "lista, 0
      elementos".
    */
    function pintarEtiquetas(lista, herramientas) {
      const elementos = herramientas || [];

      lista.replaceChildren(...elementos.map((herramienta) => {
        const item = document.createElement("li");
        item.className = "colaboradores__etiquetas-item";
        item.textContent = herramienta;
        return item;
      }));
      lista.hidden = elementos.length === 0;
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

  function inicialDe(ficha) {
    return String(ficha?.nombre || "").trim().charAt(0).toUpperCase();
  }

  document.addEventListener("DOMContentLoaded", iniciar);
})();
