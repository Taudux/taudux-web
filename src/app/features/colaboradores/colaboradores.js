/*
  La página de colaboradores: pinta el roster y la ficha de perfil a partir de
  colaboradores.datos.js, que es quien tiene las fichas y toda la lógica pura
  (slugs, colega sugerido, numeración, enlaces seguros). Acá sólo hay DOM.

  Un único estado y una única función que deriva la pantalla de él. Los
  manejadores de eventos NO tocan el DOM: cambian el estado y llaman a pintar().
  El perfil abierto vive en el hash (#/<slug>), que es quien manda sobre la
  vista; la navegación con flechas, que llega después, entra como una fuente
  más de cambio de estado sin tocar el pintado.

  Todo el texto entra por textContent. Las fichas hoy son de muestra, pero van a
  ser datos escritos a mano por varias personas: nada de lo que venga de ahí se
  interpreta como markup.
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

  function iniciar() {
    // Sin los datos no hay nada que pintar; el HTML estático ya muestra el
    // estado vacío, que es mejor que un error a mitad de render.
    if (typeof COLABORADORES === "undefined" || !Array.isArray(COLABORADORES)) return;

    const porId = (id) => document.getElementById(id);
    const el = {
      roster: porId("colaboradoresRoster"),
      perfil: porId("colaboradoresPerfil"),
      grilla: porId("colaboradoresGrilla"),
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
    if (Object.values(el).some((nodo) => !nodo)) return;

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

    const fichas = COLABORADORES.map(crearFicha);
    el.grilla.replaceChildren(...fichas.map(envolverEnCelda));

    const atributosPrevia = crearAtributos(el.previaAtributos, { valorVisible: false });
    const atributosPerfil = crearAtributos(el.perfilAtributos, { valorVisible: true });

    el.perfilColega.addEventListener("click", verColega);
    window.addEventListener("hashchange", () => aplicarHash({ moverFoco: true }));

    // Un enlace compartido (#/mariana) abre directo ese perfil. En la carga el
    // foco no se toca: nadie lo tenía todavía.
    aplicarHash({ moverFoco: false });

    /* ---------- Construcción (una sola vez) ---------- */

    function crearFicha(ficha, indice) {
      const boton = document.createElement("button");
      boton.type = "button";
      boton.className = "colaboradores__ficha";
      // El nombre corto de la ficha no alcanza para saber a quién se abre: el
      // nombre accesible lleva nombre completo y rol.
      boton.setAttribute("aria-label", `${ficha.nombre}, ${ficha.rol}`);

      const nombre = crearDecorado("colaboradores__ficha-nombre", ficha.corto);
      boton.append(
        crearDecorado("colaboradores__ficha-cabeza"),
        crearDecorado("colaboradores__ficha-torso"),
        crearDecorado("colaboradores__ficha-inicial", inicialDe(ficha)),
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
      boton.addEventListener("click", () => abrirPerfil(indice));

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

    /*
      Abrir un perfil sólo escribe el hash: la entrada de historial que crea es
      la que el botón atrás del navegador deshace para volver al roster. Quien
      pinta es aplicarHash(), al llegar el hashchange.
    */
    function abrirPerfil(indice) {
      window.location.hash = rutaDePerfil(indice);
    }

    function verColega() {
      const colega = colegaSugerido(estado.seleccion, COLABORADORES.length);
      if (colega === null) return;
      // replace y no location.hash: saltar entre colegas reemplaza la entrada
      // del perfil en vez de apilar una, así atrás desde cualquier perfil deja
      // en el roster de una vez. Y replace, no replaceState: replace sí emite
      // hashchange, así que el colega se pinta por el mismo camino que todo.
      window.location.replace(rutaDePerfil(colega));
    }

    function rutaDePerfil(indice) {
      return `#/${slugDeColaborador(COLABORADORES[indice])}`;
    }

    /*
      El hash es la fuente de verdad de la vista: #/<slug> de una ficha que
      existe es su perfil; cualquier otra cosa, el roster. Por acá pasan el
      clic en una ficha, el colega, atrás y adelante, y un enlace compartido.
    */
    function aplicarHash({ moverFoco }) {
      const hash = window.location.hash;
      const esRutaDePerfil = hash.startsWith("#/");
      const indice = esRutaDePerfil ? indicePorSlug(hash.slice(2)) : -1;
      const vistaAnterior = estado.vista;

      if (indice === -1) {
        estado.vista = "roster";
        // Un #/<slug> que no es de nadie no se deja en la barra: replaceState
        // corrige la URL sin crear otra entrada ni volver a emitir hashchange.
        // Sólo los #/: otro hash puede ser de otro script (el cliente de
        // Supabase lee de ahí los tokens de sesión y los limpia él).
        if (esRutaDePerfil) {
          window.history.replaceState(null, "", window.location.pathname + window.location.search);
        }
      } else {
        estado.seleccion = indice;
        estado.vista = "perfil";
        resaltado.cursor = null;
        resaltado.foco = null;
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
      // Un perfil sin ficha no existe: cualquier estado incoherente cae al roster.
      const hayPerfil = estado.vista === "perfil" && COLABORADORES[estado.seleccion] !== undefined;

      el.roster.hidden = hayPerfil;
      el.perfil.hidden = !hayPerfil;

      if (hayPerfil) pintarPerfil(estado.seleccion);
      else pintarRoster();
    }

    function pintarRoster() {
      const mostrada = resaltado.cursor ?? resaltado.foco ?? estado.seleccion;
      const ficha = COLABORADORES[mostrada] ?? null;

      fichas.forEach((boton, indice) => {
        boton.classList.toggle("colaboradores__ficha--activa", indice === mostrada);
        boton.classList.toggle("colaboradores__ficha--seleccionada", indice === estado.seleccion);
        if (indice === estado.seleccion) boton.setAttribute("aria-current", "true");
        else boton.removeAttribute("aria-current");
      });

      // Cada escritura se salta si el texto no cambió: las regiones aria-live
      // vuelven a anunciarse al reescribirlas, aunque sea con lo mismo.
      escribir(el.previaInicial, ficha ? inicialDe(ficha) : VACIA.inicial);
      escribir(el.previaClase, ficha ? ficha.clase : VACIA.clase);
      escribir(el.previaNombre, ficha ? ficha.nombre : VACIA.nombre);
      escribir(el.previaRol, ficha ? ficha.rol : VACIA.rol);
      escribir(el.previaBio, ficha ? ficha.bio : VACIA.bio);
      el.previaBio.classList.toggle("colaboradores__bio--vacia", !ficha);

      // `inert` además de la clase: la clase sólo lo atenúa a la vista, y un
      // "Contactar" apagado no debe seguir recibiendo el foco del teclado.
      el.previaAcciones.classList.toggle("colaboradores__acciones--inactivas", !ficha);
      el.previaAcciones.inert = !ficha;

      pintarEnlaces(el.previaEnlaces, ficha);
      pintarAtributos(atributosPrevia, ficha ? ficha.stats : null);
    }

    function pintarPerfil(indice) {
      const ficha = COLABORADORES[indice];

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

      const colega = colegaSugerido(indice, COLABORADORES.length);
      el.perfilColega.hidden = colega === null;
      if (colega !== null) {
        escribir(el.perfilColegaInicial, inicialDe(COLABORADORES[colega]));
        escribir(el.perfilColegaNombre, COLABORADORES[colega].nombre);
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
