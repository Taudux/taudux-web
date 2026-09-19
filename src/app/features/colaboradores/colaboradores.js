/*
  La página de colaboradores: pinta el roster y la ficha de perfil. La lista la
  pide a listarColaboradores() (colaboradores.service.js) y la lógica pura
  (colega sugerido, numeración, enlaces seguros, quién tiene perfil) sale de
  colaboradores.datos.js. Acá sólo hay DOM.

  Un único estado y una única función que deriva la pantalla de él. Los
  manejadores de eventos NO tocan el DOM: cambian el estado y llaman a pintar().
  El perfil abierto vive en el hash (#/<slug>), que es quien manda sobre la
  vista; la navegación con flechas, que llega después, entra como una fuente
  más de cambio de estado sin tocar el pintado.

  Hoy la base entrega sólo nombre y slug: la ficha de perfil llega con "Mi
  ficha". Quien no la tiene aparece en el roster, pero no abre perfil: su
  ficha sólo se elige y la vista previa muestra su nombre.

  Todo el texto entra por textContent. Los nombres vienen de la base y las
  fichas van a ser escritas a mano por cada persona: nada de lo que venga de
  ahí se interpreta como markup.
*/
(function () {
  const SIGLAS_DE_ENLACE = { linkedin: "in", github: "gh", correo: "@" };

  const VACIA = {
    inicial: "?",
    clase: "Sin selección",
    nombre: "¿Quién?",
    rol: "Pasa el cursor o elige una ficha",
    bio: "Elige una ficha del roster para ver su perfil, especialidades y cómo trabajar con esa persona.",
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
      previaClase: porId("previaClase"),
      previaNombre: porId("previaNombre"),
      previaRol: porId("previaRol"),
      previaBio: porId("previaBio"),
      previaAcciones: porId("previaAcciones"),
      previaEnlaces: porId("previaEnlaces"),
      previaAtributos: porId("previaAtributos"),
      perfilNumero: porId("perfilNumero"),
      perfilInicial: porId("perfilInicial"),
      perfilEnlaces: porId("perfilEnlaces"),
      perfilNombre: porId("perfilNombre"),
      perfilRol: porId("perfilRol"),
      perfilEspecialidad: porId("perfilEspecialidad"),
      perfilProyectos: porId("perfilProyectos"),
      perfilUbicacion: porId("perfilUbicacion"),
      perfilExperiencia: porId("perfilExperiencia"),
      perfilPunto: porId("perfilPunto"),
      perfilDisponibilidad: porId("perfilDisponibilidad"),
      perfilStack: porId("perfilStack"),
      perfilBio: porId("perfilBio"),
      perfilColega: porId("perfilColega"),
      perfilColegaInicial: porId("perfilColegaInicial"),
      perfilColegaNombre: porId("perfilColegaNombre"),
      perfilAtributos: porId("perfilAtributos"),
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

    // La lista cargada y sus botones: se reemplazan juntos, en montarRoster().
    let colaboradores = [];
    let fichas = [];
    // El colega y el hash se conectan UNA vez, con la primera lista que llega.
    let conectada = false;

    const atributosPrevia = crearAtributos(el.previaAtributos, { valorVisible: false });
    const atributosPerfil = crearAtributos(el.perfilAtributos, { valorVisible: true });

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
        el.perfilColega.addEventListener("click", verColega);
        window.addEventListener("hashchange", () => aplicarHash({ moverFoco: true }));
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

    /* ---------- Construcción (una vez por lista) ---------- */

    function montarRoster(lista) {
      colaboradores = lista;
      fichas = colaboradores.map(crearFicha);
      el.grilla.replaceChildren(...fichas.map(envolverEnCelda));
      // Sin fichas, el marco sería una caja vacía debajo del aviso.
      el.marco.hidden = fichas.length === 0;
      // La tarjeta de abajo existe para mostrar fichas de perfil. Se decide una
      // vez por lista y no por ficha: prenderla y apagarla al pasar el cursor
      // cambiaría el alto del marco y haría saltar la grilla entera.
      el.resumen.hidden = !colaboradores.some(tienePerfil);
      pintar();
    }

    function crearFicha(persona, indice) {
      const boton = document.createElement("button");
      boton.type = "button";
      boton.className = "colaboradores__ficha";
      // El nombre corto de la ficha no alcanza para saber a quién se abre: el
      // nombre accesible lleva nombre completo y, si lo hay, el rol.
      boton.setAttribute("aria-label", persona.rol ? `${persona.nombre}, ${persona.rol}` : persona.nombre);

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

    function envolverEnCelda(boton) {
      const celda = document.createElement("li");
      celda.className = "colaboradores__celda";
      celda.append(boton);
      return celda;
    }

    /*
      Las barras se construyen una vez y después sólo cambian de clase: se
      repintan en cada mouseenter, y recrear 25 nodos por panel en cada paso del
      cursor sobre la grilla es trabajo tirado.
    */
    function crearAtributos(contenedor, { valorVisible }) {
      const filas = ETIQUETAS_ATRIBUTOS.map((etiqueta) => {
        const fila = document.createElement("div");
        fila.className = "colaboradores__atributo";
        fila.setAttribute("role", "listitem");

        const nombre = document.createElement("span");
        nombre.className = "colaboradores__atributo-nombre";
        nombre.textContent = etiqueta;

        const barra = document.createElement("span");
        barra.className = "colaboradores__barra-segmentos";
        barra.setAttribute("aria-hidden", "true");
        const segmentos = ETIQUETAS_ATRIBUTOS.map(() => {
          const segmento = document.createElement("span");
          segmento.className = "colaboradores__segmento";
          return segmento;
        });
        barra.append(...segmentos);

        // En la vista previa no hay lugar para el "4/5", pero la barra sola no
        // le dice nada a un lector de pantalla: el valor va igual, oculto.
        const valor = document.createElement("span");
        valor.className = valorVisible ? "colaboradores__atributo-valor" : "u-visually-hidden";

        fila.append(nombre, barra, valor);
        return { fila, segmentos, valor };
      });

      contenedor.replaceChildren(...filas.map(({ fila }) => fila));
      return filas;
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

    function verColega() {
      const colega = colegaSugerido(estado.seleccion, colaboradores.length);
      if (colega === null) return;
      // replace y no location.hash: saltar entre colegas reemplaza la entrada
      // del perfil en vez de apilar una, así atrás desde cualquier perfil deja
      // en el roster de una vez. Y replace, no replaceState: replace sí emite
      // hashchange, así que el colega se pinta por el mismo camino que todo.
      window.location.replace(rutaDePerfil(colega));
    }

    function rutaDePerfil(indice) {
      return `#/${colaboradores[indice].slug}`;
    }

    /*
      El hash es la fuente de verdad de la vista: #/<slug> de alguien con ficha
      de perfil es su perfil; cualquier otra cosa, el roster. Por acá pasan el
      clic en una ficha, el colega, atrás y adelante, y un enlace compartido.
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
        // De vuelta a la ficha que se estaba viendo, no al principio de la
        // grilla: después de un salto de colega, es la del colega.
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

      fichas.forEach((boton, indice) => {
        boton.classList.toggle("colaboradores__ficha--activa", indice === mostrada);
        boton.classList.toggle("colaboradores__ficha--seleccionada", indice === estado.seleccion);
        if (indice === estado.seleccion) boton.setAttribute("aria-current", "true");
        else boton.removeAttribute("aria-current");
      });

      // Cada escritura se salta si el texto no cambió: las regiones aria-live
      // vuelven a anunciarse al reescribirlas, aunque sea con lo mismo.
      escribir(el.previaInicial, persona ? inicialDe(persona) : VACIA.inicial);
      escribir(el.previaNombre, persona ? persona.nombre : VACIA.nombre);

      // Clase y rol se ocultan en vez de quedar vacíos: un <p> vacío igual
      // conserva sus márgenes.
      el.previaClase.hidden = soloNombre;
      el.previaRol.hidden = soloNombre;
      escribir(el.previaClase, textoDePrevia(ficha, soloNombre, "clase"));
      escribir(el.previaRol, textoDePrevia(ficha, soloNombre, "rol"));

      // La bio NO se oculta: vive en la tarjeta de abajo, y ocultarla cambiaría
      // su alto con cada ficha bajo el cursor. Queda vacía, con su piso.
      escribir(el.previaBio, textoDePrevia(ficha, soloNombre, "bio"));
      el.previaBio.classList.toggle("colaboradores__bio--vacia", !ficha);

      // `inert` además de la clase: la clase sólo lo atenúa a la vista, y un
      // "Contactar" apagado no debe seguir recibiendo el foco del teclado.
      el.previaAcciones.classList.toggle("colaboradores__acciones--inactivas", !ficha);
      el.previaAcciones.inert = !ficha;

      pintarEnlaces(el.previaEnlaces, ficha);
      pintarAtributos(atributosPrevia, ficha ? ficha.stats : null);
    }

    // Con ficha, su campo; sin ficha, nada; sin nadie a la vista, la invitación.
    function textoDePrevia(ficha, soloNombre, campo) {
      if (ficha) return ficha[campo];
      return soloNombre ? "" : VACIA[campo];
    }

    function pintarPerfil(indice) {
      const ficha = colaboradores[indice];

      escribir(el.perfilNumero, `${numeroDeFicha(indice)} · ${ficha.clase}`);
      escribir(el.perfilInicial, inicialDe(ficha));
      escribir(el.perfilNombre, ficha.nombre);
      escribir(el.perfilRol, ficha.rol);
      escribir(el.perfilEspecialidad, ficha.esp);
      escribir(el.perfilProyectos, String(ficha.proyectos));
      escribir(el.perfilUbicacion, ficha.ciudad);
      escribir(el.perfilExperiencia, ficha.anios);
      escribir(el.perfilDisponibilidad, ficha.disp);
      escribir(el.perfilStack, ficha.stack);
      escribir(el.perfilBio, ficha.bio);

      // Verde sólo para "Disponible"; cualquier otro valor se queda apagado, que
      // es la lectura prudente si mañana aparece un tercer estado.
      el.perfilPunto.classList.toggle("colaboradores__punto--disponible", ficha.disp === "Disponible");

      const colega = colegaSugerido(indice, colaboradores.length);
      el.perfilColega.hidden = colega === null;
      if (colega !== null) {
        escribir(el.perfilColegaInicial, inicialDe(colaboradores[colega]));
        escribir(el.perfilColegaNombre, colaboradores[colega].nombre);
      }

      pintarEnlaces(el.perfilEnlaces, ficha);
      pintarAtributos(atributosPerfil, ficha.stats);
    }

    function pintarAtributos(filas, stats) {
      filas.forEach(({ segmentos, valor }, atributo) => {
        const puntos = stats ? stats[atributo] : 0;
        segmentos.forEach((segmento, posicion) => {
          segmento.classList.toggle("colaboradores__segmento--lleno", posicion < puntos);
        });
        escribir(valor, stats ? etiquetaDeAtributo(puntos) : "");
      });
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
