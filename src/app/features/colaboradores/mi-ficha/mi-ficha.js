/*
  Cableado de "Mi ficha": arranque con sesión, carga de la ficha propia y el
  formulario que la guarda.

  La normalización y la validación viven en mi-ficha.logica.js; el editor de
  etiquetas del stack, en mi-ficha.stack.logica.js; la lectura y el guardado,
  en core/colaboradores/ficha.service.js. Todos se cargan antes y dejan sus
  funciones en el ámbito global. establecerFormularioOcupado sale de
  features/auth/auth-ui.js.

  Arranque: requerirSesion() (sin sesión ya navegó al login y acá no se hace
  nada más) → obtenerPerfil() → sólo si la cuenta está marcada como
  colaboradora, obtenerMiFicha() (en paralelo con el catálogo de tecnologías)
  → formulario lleno, o vacío si todavía no hay ficha. Cualquier fallo de
  carga queda en el aviso con "Reintentar"; a quien no colabora se le dice,
  sin redirigirlo en silencio.

  Los errores de cada campo van junto al campo, todos de una vez. La región
  role="alert" es sólo para los errores del servidor, y nunca se usa el canal
  global de telemetría de operaciones: navbar.js lo convierte en un toast
  genérico y serían dos avisos por un mismo fallo.
*/

(function () {
  const CARGANDO = "Cargando tu ficha…";
  const ERROR_DE_CUENTA = "No se pudo cargar tu cuenta. Intenta de nuevo.";
  const ERROR_DE_FICHA = "No se pudo cargar tu ficha. Intenta de nuevo.";
  const ERROR_DE_GUARDADO = "No se pudo guardar tu ficha. Intenta de nuevo.";
  const ERROR_DE_PAGINA = "No se pudo cargar la página. Recárgala para intentar de nuevo.";
  const SOLO_COLABORADORES = "Esta sección es sólo para colaboradores.";
  const SIN_NOMBRE = "Tu cuenta todavía no tiene nombre.";

  // El texto de la ayuda del stack cambia según si todavía se puede escribir.
  const AYUDA_STACK = "Escribe una tecnología y presiona Enter para agregarla. Por ejemplo: Python, PostgreSQL, GCP. Hasta 12.";
  const AYUDA_STACK_LLENA = "Ya tienes 12 tecnologías, el máximo. Quita alguna para escribir otra.";

  // Cuánto dura resaltada la etiqueta que ya estaba, cuando se intenta
  // repetirla. El mismo criterio que el aviso de guardado del extractor.
  const DURACION_RESALTADO_DUPLICADO_MS = 1200;
  const CLASE_ETIQUETA_DUPLICADA = "mi-ficha__etiqueta--duplicada";

  // El contador de la bio sólo se anuncia con aria-live cerca del tope: una
  // región que hablara en cada tecla sería insoportable con lector de
  // pantalla. "Cerca" son los últimos 20 caracteres disponibles.
  const UMBRAL_AVISO_CONTADOR_BIO = 20;
  const CLASE_CONTADOR_BIO_LIMITE = "mi-ficha__contador--limite";

  // Los campos de texto de la ficha y su input. Cada uno tiene su ayuda en
  // `${id}Ayuda` y su error en `${id}Error`. La modalidad de trabajo va
  // aparte: es un grupo de radios. El stack es un tercer caso: su input es un
  // combobox y su valor no vive en `.value`, sino en el arreglo que arma el
  // editor de etiquetas (ver la sección "Stack" más abajo).
  const IDS_DE_CAMPO = Object.freeze({
    puesto: "miFichaPuesto",
    sector: "miFichaSector",
    ubicacion: "miFichaUbicacion",
    stack: "miFichaStack",
    anio_inicio: "miFichaAnioInicio",
    bio: "miFichaBio",
    linkedin: "miFichaLinkedin",
    github: "miFichaGithub",
    correo: "miFichaCorreo",
  });

  const IDS_DE_LA_PAGINA = Object.freeze({
    aviso: "miFichaAviso",
    avisoMensaje: "miFichaAvisoMensaje",
    reintentar: "miFichaReintentar",
    irColaboradores: "miFichaIrColaboradores",
    contenido: "miFichaContenido",
    publico: "miFichaPublico",
    form: "formMiFicha",
    estado: "miFichaStatus",
    nombre: "miFichaNombre",
    modalidadTrabajo: "miFichaModalidadTrabajo",
    modalidadTrabajoError: "miFichaModalidadTrabajoError",
    verPerfil: "miFichaVerPerfil",
    stackOpciones: "miFichaStackOpciones",
    stackLista: "miFichaStackLista",
    stackEstado: "miFichaStackEstado",
    stackAyuda: "miFichaStackAyuda",
    bioContador: "miFichaBioContador",
  });

  /*
    Lo que la página necesita de los otros scripts. Si uno no llegó (un 404,
    un error de sintaxis), se dice de entrada y no a mitad de un guardado.
    `typeof` sobre una función no declarada da "undefined", no lanza.

    El catálogo de tecnologías queda AFUERA a propósito: es una sugerencia,
    no una dependencia. Sin él el editor de etiquetas sigue vivo, sólo sin
    autocompletar (ver cargarCatalogoStack).
  */
  function dependenciasFaltantes() {
    const disponibles = {
      requerirSesion: typeof requerirSesion,
      obtenerPerfil: typeof obtenerPerfil,
      obtenerMiFicha: typeof obtenerMiFicha,
      guardarMiFicha: typeof guardarMiFicha,
      establecerFormularioOcupado: typeof establecerFormularioOcupado,
      formularioEstaOcupado: typeof formularioEstaOcupado,
      mostrarToast: typeof mostrarToast,
      validarMiFicha: typeof validarMiFicha,
      largoMiFicha: typeof largoMiFicha,
      valoresFormularioMiFicha: typeof valoresFormularioMiFicha,
      nombreVisibleMiFicha: typeof nombreVisibleMiFicha,
      rutaPerfilPublicoMiFicha: typeof rutaPerfilPublicoMiFicha,
      agregarTecnologiaAlStack: typeof agregarTecnologiaAlStack,
      quitarTecnologiaDelStack: typeof quitarTecnologiaDelStack,
      moverTecnologiaEnStack: typeof moverTecnologiaEnStack,
      sugerenciasDeTecnologia: typeof sugerenciasDeTecnologia,
      indiceMasCercano: typeof indiceMasCercano,
    };
    return Object.keys(disponibles).filter((nombre) => disponibles[nombre] !== "function");
  }

  // Todo o nada: si falta un elemento, el HTML y el script no son de la misma
  // versión y no se conecta nada.
  function resolverElementos() {
    const elementos = {};
    for (const [clave, id] of Object.entries(IDS_DE_LA_PAGINA)) {
      elementos[clave] = document.getElementById(id);
      if (!elementos[clave]) return null;
    }

    elementos.campos = {};
    for (const [campo, id] of Object.entries(IDS_DE_CAMPO)) {
      const control = document.getElementById(id);
      const error = document.getElementById(`${id}Error`);
      if (!control || !error) return null;
      elementos.campos[campo] = {
        controles: [control],
        // Recibe aria-describedby: el propio input.
        describe: control,
        error,
        // La ayuda que el campo ya describía; el error se suma adelante.
        ayuda: control.getAttribute("aria-describedby") || "",
      };
    }

    const radios = Array.from(elementos.modalidadTrabajo.querySelectorAll('input[type="radio"]'));
    if (radios.length === 0) return null;
    elementos.radios = radios;
    // En el grupo, aria-describedby va en el fieldset (se anuncia al entrar) y
    // aria-invalid en cada opción.
    elementos.campos.modalidad_trabajo = {
      controles: radios,
      describe: elementos.modalidadTrabajo,
      error: elementos.modalidadTrabajoError,
      ayuda: elementos.modalidadTrabajo.getAttribute("aria-describedby") || "",
    };
    return elementos;
  }

  function iniciar() {
    const elementos = resolverElementos();
    if (!elementos) {
      console.error("[mi-ficha]", "el HTML no tiene los elementos que la página espera");
      return undefined;
    }

    const {
      aviso, avisoMensaje, reintentar, irColaboradores, contenido, publico,
      form, estado, nombre, verPerfil, campos, radios,
      stackOpciones, stackLista, stackEstado, stackAyuda, bioContador,
    } = elementos;
    const stackInput = campos.stack.controles[0];
    const bioInput = campos.bio.controles[0];

    // Lo que el arranque deja para el guardado.
    let sesion = null;
    let perfil = null;

    // El estado del editor de etiquetas: vive acá y no en el DOM, porque el
    // DOM (el input y las dos listas) es sólo su pintura.
    let stack = [];
    let catalogo = [];
    let sugerenciasActuales = [];
    let resaltadaSugerencia = -1;
    let arrastreStack = null;

    /* ---------- Aviso de carga ---------- */

    function mostrarAviso(mensaje, { error = false, conReintento = false, conColaboradores = false, cargando = false } = {}) {
      avisoMensaje.textContent = mensaje;
      aviso.classList.toggle("mi-ficha__aviso--error", error);
      aviso.setAttribute("aria-busy", String(cargando));
      reintentar.hidden = !conReintento;
      irColaboradores.hidden = !conColaboradores;
      aviso.hidden = false;
      contenido.hidden = true;
    }

    function revelarFormulario() {
      aviso.hidden = true;
      aviso.setAttribute("aria-busy", "false");
      contenido.hidden = false;
    }

    /* ---------- Errores de campo ---------- */

    function marcarError(campo, mensaje) {
      const { controles, describe, error, ayuda } = campos[campo];
      error.textContent = mensaje;
      error.hidden = false;
      describe.setAttribute("aria-describedby", [error.id, ayuda].filter(Boolean).join(" "));
      controles.forEach((control) => control.setAttribute("aria-invalid", "true"));
    }

    function limpiarError(campo) {
      const { controles, describe, error, ayuda } = campos[campo];
      error.hidden = true;
      error.textContent = "";
      if (ayuda) describe.setAttribute("aria-describedby", ayuda);
      else describe.removeAttribute("aria-describedby");
      controles.forEach((control) => control.removeAttribute("aria-invalid"));
    }

    function limpiarErrores() {
      Object.keys(campos).forEach(limpiarError);
    }

    function mostrarEstado(mensaje) {
      estado.textContent = mensaje;
      estado.hidden = false;
      estado.focus();
    }

    function ocultarEstado() {
      estado.hidden = true;
      estado.textContent = "";
    }

    /* ---------- Contador de la bio ---------- */

    // "Te quedan N caracteres", en singular cuando queda uno.
    function textoContadorBio(restantes) {
      return restantes === 1 ? "Te queda 1 carácter" : `Te quedan ${restantes} caracteres`;
    }

    /*
      El freno cuenta PUNTOS DE CÓDIGO con largoMiFicha(), no unidades UTF-16:
      un `maxlength` cortaría un emoji a la mitad, porque para el navegador
      vale 2 y para el char_length() de la base vale 1 (por eso el textarea no
      lleva maxlength). Al escribir o pegar por encima del tope, el texto se
      recorta acá (pegar 500 caracteres deja exactamente 240, nunca 239 ni
      500), y el aviso sólo se vuelve aria-live cerca del límite: una región
      que hablara en cada tecla sería insoportable con lector de pantalla.
    */
    function actualizarContadorBio() {
      const maximo = LIMITES_MI_FICHA.bio.max;
      if (largoMiFicha(bioInput.value) > maximo) {
        bioInput.value = [...bioInput.value].slice(0, maximo).join("");
      }
      const restantes = maximo - largoMiFicha(bioInput.value);
      bioContador.textContent = textoContadorBio(restantes);
      bioContador.setAttribute("aria-live", restantes <= UMBRAL_AVISO_CONTADOR_BIO ? "polite" : "off");
      bioContador.classList.toggle(CLASE_CONTADOR_BIO_LIMITE, restantes === 0);
    }

    bioInput.addEventListener("input", actualizarContadorBio);

    /* ---------- Valores ---------- */

    function llenarFormulario(ficha) {
      const valores = valoresFormularioMiFicha(ficha);
      for (const [campo, { controles }] of Object.entries(campos)) {
        if (campo === "modalidad_trabajo" || campo === "stack") continue;
        controles[0].value = valores[campo];
      }
      radios.forEach((radio) => { radio.checked = radio.value === valores.modalidad_trabajo; });
      establecerStack(valores.stack);
      actualizarContadorBio();
      limpiarErrores();
      ocultarEstado();
    }

    function leerFormulario() {
      const valores = {};
      for (const [campo, { controles }] of Object.entries(campos)) {
        if (campo === "modalidad_trabajo" || campo === "stack") continue;
        valores[campo] = controles[0].value;
      }
      valores.modalidad_trabajo = radios.find((radio) => radio.checked)?.value ?? "";
      valores.stack = [...stack];
      return valores;
    }

    /*
      establecerFormularioOcupado (auth-ui.js) recorre button, input y select:
      la bio es un textarea y quedaría editable mientras se guarda. El input
      del stack y los botones de cada etiqueta ya son input/button, así que
      quedan cubiertos sin nada extra acá.
    */
    function ocuparFormulario(ocupado) {
      establecerFormularioOcupado(form, ocupado);
      campos.bio.controles[0].disabled = ocupado;
    }

    /* ---------- Stack (editor de etiquetas) ---------- */

    /*
      Reemplaza el stack entero (al cargar la ficha, o al guardarla y recibir
      de vuelta la versión normalizada). Nunca conserva el arreglo que llega:
      lo que se muta acá es siempre una copia.
    */
    function establecerStack(nuevoStack) {
      stack = Array.isArray(nuevoStack) ? [...nuevoStack] : [];
      stackInput.value = "";
      cerrarListboxStack();
      pintarStackLista();
      actualizarLimiteStack();
    }

    // Con doce etiquetas no se puede escribir una treceava: se avisa en la
    // misma ayuda que ya describe el campo.
    function actualizarLimiteStack() {
      const llena = stack.length >= LIMITES_MI_FICHA.stack.max;
      stackInput.disabled = llena;
      stackAyuda.textContent = llena ? AYUDA_STACK_LLENA : AYUDA_STACK;
    }

    function anunciarStack(mensaje) {
      stackEstado.textContent = mensaje;
    }

    function pintarStackLista() {
      stackLista.replaceChildren(...stack.map(crearEtiquetaStack));
    }

    /*
      Una etiqueta: una manija para reordenar (por teclado o arrastrando), el
      texto y un botón para quitarla. La manija y el botón de quitar son
      texto plano (no un span decorativo adentro): así evento.target en un
      clic o un pointerdown es siempre el botón, nunca un hijo suyo.
    */
    function crearEtiquetaStack(tecnologia, indice) {
      const item = document.createElement("li");
      item.className = "mi-ficha__etiqueta";

      const manija = document.createElement("button");
      manija.type = "button";
      manija.className = "mi-ficha__etiqueta-manija";
      manija.setAttribute("aria-label", `Reordenar ${tecnologia}`);
      manija.setAttribute("data-indice-stack", String(indice));
      manija.textContent = "⠿";
      manija.addEventListener("keydown", (evento) => manejarTecladoManijaStack(evento, indice));
      manija.addEventListener("pointerdown", (evento) => iniciarArrastreStack(evento, indice));

      const texto = document.createElement("span");
      texto.className = "mi-ficha__etiqueta-texto";
      texto.textContent = tecnologia;

      const quitar = document.createElement("button");
      quitar.type = "button";
      quitar.className = "mi-ficha__etiqueta-quitar";
      quitar.setAttribute("aria-label", `Quitar ${tecnologia}`);
      quitar.textContent = "×";
      quitar.addEventListener("click", () => quitarTecnologiaEnIndice(indice));

      item.append(manija, texto, quitar);
      return item;
    }

    function enfocarManijaStack(indice) {
      const item = stackLista.children[indice];
      if (!item) return;
      item.children[0].focus();
    }

    /*
      Al quitar, el foco va a la manija que quedó en el mismo índice; si ya no
      hay ninguna ahí (se quitó la última), a la anterior; si la lista quedó
      vacía, al input. Cuando quita Backspace (con `gestionarFoco: false`) el
      foco ya está en el input y se queda ahí: moverlo a una manija sería
      sorprender a quien sigue escribiendo.
    */
    function enfocarTrasQuitar(indiceQuitado) {
      if (stack.length === 0) { stackInput.focus(); return; }
      enfocarManijaStack(Math.min(indiceQuitado, stack.length - 1));
    }

    function quitarTecnologiaEnIndice(indice, { gestionarFoco = true } = {}) {
      const anterior = stack;
      stack = quitarTecnologiaDelStack(stack, indice);
      if (stack === anterior) return;
      pintarStackLista();
      actualizarLimiteStack();
      if (gestionarFoco) enfocarTrasQuitar(indice);
    }

    function quitarUltimaTecnologia() {
      if (stack.length === 0) return;
      quitarTecnologiaEnIndice(stack.length - 1, { gestionarFoco: false });
    }

    // Reordenar desde la manija: el foco sigue a la etiqueta en su nueva
    // posición, y se anuncia por la región aria-live del widget.
    function moverTecnologiaStack(origen, destino) {
      const anterior = stack;
      stack = moverTecnologiaEnStack(stack, origen, destino);
      if (stack === anterior) return;
      const posicionFinal = Math.min(Math.max(destino, 0), stack.length - 1);
      pintarStackLista();
      enfocarManijaStack(posicionFinal);
      anunciarStack(`${stack[posicionFinal]}, posición ${posicionFinal + 1} de ${stack.length}.`);
    }

    function manejarTecladoManijaStack(evento, indice) {
      let destino;
      if (evento.key === "ArrowLeft") destino = indice - 1;
      else if (evento.key === "ArrowRight") destino = indice + 1;
      else if (evento.key === "Home") destino = 0;
      else if (evento.key === "End") destino = stack.length - 1;
      else return;
      evento.preventDefault();
      moverTecnologiaStack(indice, destino);
    }

    /*
      Arrastre con Pointer Events, como el recorte de portadas
      (gestionar-curso.portada.js). La captura va en `stackLista` (el
      contenedor, que nunca se recrea) y no en la manija que inició el
      arrastre: cada movimiento repinta la lista entera, y una manija
      capturada que desaparece del DOM perdería la captura a mitad de camino.
    */
    function iniciarArrastreStack(evento, indice) {
      arrastreStack = { pointerId: evento.pointerId, actual: indice };
      stackLista.setPointerCapture?.(evento.pointerId);
    }

    /*
      `children` es una HTMLCollection, no un arreglo: no tiene .map, .filter
      ni .forEach. Hay que copiarla. El DOM falso de los tests la finge con un
      arreglo de verdad, así que acá la suite no avisa; lo cubre un test de
      mi-ficha.pagina.test.js que lee este archivo.
    */
    function centrosDeEtiquetasStack() {
      return Array.from(stackLista.children).map((item) => {
        const rect = item.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      });
    }

    function moverArrastreStack(evento) {
      if (!arrastreStack || evento.pointerId !== arrastreStack.pointerId) return;
      const destino = indiceMasCercano(centrosDeEtiquetasStack(), { x: evento.clientX, y: evento.clientY });
      if (destino === -1 || destino === arrastreStack.actual) return;
      const anterior = stack;
      stack = moverTecnologiaEnStack(stack, arrastreStack.actual, destino);
      if (stack === anterior) return;
      arrastreStack.actual = Math.min(Math.max(destino, 0), stack.length - 1);
      pintarStackLista();
    }

    function terminarArrastreStack(evento) {
      if (!arrastreStack || evento.pointerId !== arrastreStack.pointerId) return;
      stackLista.releasePointerCapture?.(evento.pointerId);
      arrastreStack = null;
    }

    stackLista.addEventListener("pointermove", moverArrastreStack);
    stackLista.addEventListener("pointerup", terminarArrastreStack);
    stackLista.addEventListener("pointercancel", terminarArrastreStack);

    /* ---------- Stack (sugerencias) ---------- */

    function idDeOpcionStack(indice) {
      return `miFichaStackOpcion${indice}`;
    }

    function cerrarListboxStack() {
      sugerenciasActuales = [];
      resaltadaSugerencia = -1;
      stackOpciones.hidden = true;
      stackOpciones.replaceChildren();
      stackInput.setAttribute("aria-expanded", "false");
      stackInput.removeAttribute("aria-activedescendant");
    }

    /*
      Las opciones nunca reciben foco (role="option" sin tabindex): el
      resaltado se lleva con aria-activedescendant en el input y aria-selected
      en la opción, y se resuelve en mousedown con preventDefault() para que
      el clic nunca le quite el foco al input.
    */
    function pintarOpcionesStack() {
      if (sugerenciasActuales.length === 0) { cerrarListboxStack(); return; }

      stackOpciones.replaceChildren(...sugerenciasActuales.map((tecnologia, indice) => {
        const opcion = document.createElement("li");
        opcion.setAttribute("id", idDeOpcionStack(indice));
        opcion.setAttribute("role", "option");
        opcion.setAttribute("aria-selected", String(indice === resaltadaSugerencia));
        opcion.className = indice === resaltadaSugerencia
          ? "mi-ficha__stack-opcion mi-ficha__stack-opcion--resaltada"
          : "mi-ficha__stack-opcion";
        opcion.textContent = tecnologia;
        opcion.addEventListener("mousedown", (evento) => {
          evento.preventDefault();
          procesarConfirmacionStack(tecnologia);
        });
        return opcion;
      }));

      stackOpciones.hidden = false;
      stackInput.setAttribute("aria-expanded", "true");
      if (resaltadaSugerencia === -1) stackInput.removeAttribute("aria-activedescendant");
      else stackInput.setAttribute("aria-activedescendant", idDeOpcionStack(resaltadaSugerencia));
    }

    function actualizarSugerenciasStack() {
      sugerenciasActuales = sugerenciasDeTecnologia(catalogo, stackInput.value, stack);
      resaltadaSugerencia = -1;
      pintarOpcionesStack();
    }

    // Con tope en los extremos y sin dar la vuelta: abre el desplegable si
    // hacía falta y, si ya había algo resaltado, se mueve un paso desde ahí.
    function moverResaltadoStack(delta) {
      if (sugerenciasActuales.length === 0) {
        sugerenciasActuales = sugerenciasDeTecnologia(catalogo, stackInput.value, stack);
        if (sugerenciasActuales.length === 0) return;
        resaltadaSugerencia = delta > 0 ? 0 : sugerenciasActuales.length - 1;
      } else if (resaltadaSugerencia === -1) {
        resaltadaSugerencia = delta > 0 ? 0 : sugerenciasActuales.length - 1;
      } else {
        resaltadaSugerencia = Math.min(Math.max(resaltadaSugerencia + delta, 0), sugerenciasActuales.length - 1);
      }
      pintarOpcionesStack();
    }

    function resaltarEtiquetaDuplicada(indice) {
      const item = stackLista.children[indice];
      if (!item) return;
      item.classList.add(CLASE_ETIQUETA_DUPLICADA);
      setTimeout(() => item.classList.remove(CLASE_ETIQUETA_DUPLICADA), DURACION_RESALTADO_DUPLICADO_MS);
    }

    /*
      Los motivos de agregarTecnologiaAlStack, traducidos: "vacio" no dice
      nada (quien arma el stack ya lo descarta en silencio), "duplicado"
      avisa por la región aria-live y resalta la etiqueta que ya estaba,
      "muchas" avisa el tope y "largo"/"caracteres" son errores de campo como
      cualquier otro, con el mismo marcarError() de siempre.
    */
    function procesarConfirmacionStack(texto) {
      const resultado = agregarTecnologiaAlStack(stack, texto);
      cerrarListboxStack();

      if (resultado.ok) {
        stack = resultado.stack;
        stackInput.value = "";
        pintarStackLista();
        actualizarLimiteStack();
        limpiarError("stack");
        return;
      }

      if (resultado.motivo === "vacio") return;

      if (resultado.motivo === "duplicado") {
        anunciarStack(`${stack[resultado.indice]} ya está en tu stack.`);
        resaltarEtiquetaDuplicada(resultado.indice);
        return;
      }

      if (resultado.motivo === "muchas") {
        anunciarStack(MENSAJES_MI_FICHA.stack.muchas);
        return;
      }

      marcarError("stack", MENSAJES_MI_FICHA.stack[resultado.motivo]);
    }

    // Enter y "," confirman la opción resaltada; sin ninguna resaltada,
    // confirman el texto libre.
    function confirmarEntradaStack() {
      const texto = resaltadaSugerencia >= 0 && resaltadaSugerencia < sugerenciasActuales.length
        ? sugerenciasActuales[resaltadaSugerencia]
        : stackInput.value;
      procesarConfirmacionStack(texto);
    }

    stackInput.addEventListener("input", actualizarSugerenciasStack);

    stackInput.addEventListener("keydown", (evento) => {
      if (evento.key === "ArrowDown") {
        evento.preventDefault();
        moverResaltadoStack(1);
      } else if (evento.key === "ArrowUp") {
        evento.preventDefault();
        moverResaltadoStack(-1);
      } else if (evento.key === "Enter" || evento.key === ",") {
        evento.preventDefault();
        confirmarEntradaStack();
      } else if (evento.key === "Escape") {
        if (!stackOpciones.hidden) {
          evento.preventDefault();
          cerrarListboxStack();
        }
      } else if (evento.key === "Backspace") {
        if (stackInput.value === "") quitarUltimaTecnologia();
      }
    });

    /*
      El catálogo es sólo para sugerir: si el script no llegó o la carga
      falla, queda vacío y el editor se degrada en silencio a texto libre, sin
      aviso ni reintento (a quien edita su ficha no le toca resolver eso).
    */
    async function cargarCatalogoStack() {
      if (typeof cargarCatalogoDeTecnologias !== "function") return;
      const resultado = await cargarCatalogoDeTecnologias();
      if (resultado?.ok) catalogo = resultado.tecnologias;
    }

    /* ---------- Arranque ---------- */

    /*
      Devuelve en qué quedó la página: "sin-sesion" (ya navegó al login),
      "error", "solo-colaboradores" o "formulario". La sesión se pide una sola
      vez; un reintento vuelve a leer el perfil y la ficha.
    */
    async function cargar({ desdeReintento = false } = {}) {
      mostrarAviso(CARGANDO, { conReintento: desdeReintento, cargando: true });
      try {
        if (!sesion) {
          sesion = await requerirSesion();
          if (!sesion) return "sin-sesion";
        }

        perfil = await obtenerPerfil(sesion);
        if (!perfil) {
          mostrarAviso(ERROR_DE_CUENTA, { error: true, conReintento: true });
          return "error";
        }

        // Estricto: sólo el `true` de la columna abre el formulario.
        if (perfil.es_colaborador !== true) {
          mostrarAviso(SOLO_COLABORADORES, { conColaboradores: true });
          return "solo-colaboradores";
        }

        // En paralelo: el catálogo no bloquea la ficha ni al revés.
        const [resultado] = await Promise.all([
          obtenerMiFicha(sesion.user.id),
          cargarCatalogoStack(),
        ]);
        if (!resultado?.ok) {
          mostrarAviso(resultado?.mensaje || ERROR_DE_FICHA, { error: true, conReintento: true });
          return "error";
        }

        nombre.textContent = nombreVisibleMiFicha(perfil) || SIN_NOMBRE;
        llenarFormulario(resultado.data ?? null);
        revelarFormulario();
        return "formulario";
      } catch (error) {
        // Un fallo de red o un cliente de Supabase que no arrancó: la página
        // lo muestra como cualquier otro fallo de carga, no se queda colgada.
        console.error("[mi-ficha]", error);
        mostrarAviso(ERROR_DE_CUENTA, { error: true, conReintento: true });
        return "error";
      }
    }

    reintentar.addEventListener("click", async () => {
      if (reintentar.disabled) return;
      reintentar.disabled = true;
      const resultado = await cargar({ desdeReintento: true });
      reintentar.disabled = false;
      // El botón que tenía el foco pudo ocultarse: el foco va a lo primero que
      // hay que leer, nunca al <body>.
      if (resultado === "formulario") publico.focus();
      else if (resultado !== "sin-sesion") aviso.focus();
    });

    /* ---------- Formulario ---------- */

    for (const [campo, { controles }] of Object.entries(campos)) {
      const evento = campo === "modalidad_trabajo" ? "change" : "input";
      controles.forEach((control) => control.addEventListener(evento, () => limpiarError(campo)));
    }

    form.addEventListener("submit", async (evento) => {
      evento.preventDefault();
      if (formularioEstaOcupado(form)) return;
      ocultarEstado();

      const validacion = validarMiFicha(leerFormulario(), new Date().getFullYear());
      limpiarErrores();
      if (!validacion.ok) {
        validacion.errores.forEach(({ campo, mensaje }) => marcarError(campo, mensaje));
        campos[validacion.errores[0].campo].controles[0].focus();
        return;
      }

      ocuparFormulario(true);
      try {
        const resultado = await guardarMiFicha(sesion.user.id, validacion.ficha);
        if (!resultado?.ok) {
          mostrarEstado(resultado?.mensaje || ERROR_DE_GUARDADO);
          return;
        }

        llenarFormulario(resultado.data ?? validacion.ficha);
        mostrarToast("Ficha guardada.", "success");

        const ruta = rutaPerfilPublicoMiFicha(perfil?.slug);
        if (ruta) {
          verPerfil.setAttribute("href", ruta);
          verPerfil.hidden = false;
        }
      } finally {
        ocuparFormulario(false);
      }
    });

    const faltantes = dependenciasFaltantes();
    if (faltantes.length > 0) {
      console.error("[mi-ficha]", `faltan scripts: ${faltantes.join(", ")}`);
      mostrarAviso(ERROR_DE_PAGINA, { error: true });
      return undefined;
    }

    // Devuelve la promesa del arranque: el navegador la ignora, los tests la
    // esperan.
    return cargar();
  }

  document.addEventListener("DOMContentLoaded", iniciar);
})();
