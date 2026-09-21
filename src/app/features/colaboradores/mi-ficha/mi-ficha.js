/*
  Cableado de "Mi ficha": arranque con sesión, carga de la ficha propia y el
  formulario que la guarda.

  La normalización y la validación viven en mi-ficha.logica.js; el editor de
  etiquetas de las herramientas, en mi-ficha.etiquetas.js
  (crearEditorDeEtiquetas), con su lógica pura de agregar/quitar/mover/sugerir en
  mi-ficha.etiquetas.logica.js; la lectura y el guardado, en
  core/colaboradores/ficha.service.js. Todos se
  cargan antes y dejan sus funciones en el ámbito global.
  establecerFormularioOcupado sale de features/auth/auth-ui.js.

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

  // El texto de la ayuda de herramientas cambia según si todavía se puede escribir.
  const AYUDA_HERRAMIENTAS = "Los lenguajes, frameworks y productos con los que trabajas. Por ejemplo: Python, PostgreSQL, Figma. Hasta 12.";
  const AYUDA_HERRAMIENTAS_LLENA = "Ya tienes 12 herramientas, el máximo. Quita alguna para escribir otra.";

  // El contador de la bio sólo se anuncia con aria-live cerca del tope: una
  // región que hablara en cada tecla sería insoportable con lector de
  // pantalla. "Cerca" son los últimos 20 caracteres disponibles.
  const UMBRAL_AVISO_CONTADOR_BIO = 20;
  const CLASE_CONTADOR_BIO_LIMITE = "mi-ficha__contador--limite";

  // Los campos de texto de la ficha y su input. Cada uno tiene su ayuda en
  // `${id}Ayuda` y su error en `${id}Error`. La modalidad de trabajo va
  // aparte: es un grupo de radios. Herramientas es un tercer caso: su input
  // es un combobox y su valor no vive en `.value`, sino en el arreglo que
  // gestiona el editor de etiquetas de mi-ficha.etiquetas.js (ver
  // editorHerramientas).
  const IDS_DE_CAMPO = Object.freeze({
    puesto: "miFichaPuesto",
    sector: "miFichaSector",
    ubicacion: "miFichaUbicacion",
    herramientas: "miFichaHerramientas",
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
    herramientasOpciones: "miFichaHerramientasOpciones",
    herramientasLista: "miFichaHerramientasLista",
    herramientasEstado: "miFichaHerramientasEstado",
    herramientasAyuda: "miFichaHerramientasAyuda",
    bioContador: "miFichaBioContador",
  });

  /*
    Lo que la página necesita de los otros scripts. Si uno no llegó (un 404,
    un error de sintaxis), se dice de entrada y no a mitad de un guardado.
    `typeof` sobre una función no declarada da "undefined", no lanza.

    El catálogo de tecnologías queda AFUERA a propósito: es una sugerencia,
    no una dependencia. Sin él el editor de etiquetas sigue vivo, sólo sin
    autocompletar (ver cargarCatalogoHerramientas).
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
      crearEditorDeEtiquetas: typeof crearEditorDeEtiquetas,
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
      herramientasOpciones, herramientasLista, herramientasEstado, herramientasAyuda, bioContador,
    } = elementos;
    const herramientasInput = campos.herramientas.controles[0];
    const bioInput = campos.bio.controles[0];

    // Lo que el arranque deja para el guardado.
    let sesion = null;
    let perfil = null;

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
        if (campo === "modalidad_trabajo" || campo === "herramientas") continue;
        controles[0].value = valores[campo];
      }
      radios.forEach((radio) => { radio.checked = radio.value === valores.modalidad_trabajo; });
      editorHerramientas.establecer(valores.herramientas);
      actualizarContadorBio();
      limpiarErrores();
      ocultarEstado();
    }

    function leerFormulario() {
      const valores = {};
      for (const [campo, { controles }] of Object.entries(campos)) {
        if (campo === "modalidad_trabajo" || campo === "herramientas") continue;
        valores[campo] = controles[0].value;
      }
      valores.modalidad_trabajo = radios.find((radio) => radio.checked)?.value ?? "";
      valores.herramientas = editorHerramientas.leer();
      return valores;
    }

    /*
      establecerFormularioOcupado (auth-ui.js) recorre button, input y select:
      la bio es un textarea y quedaría editable mientras se guarda. El input
      de herramientas y los botones de cada etiqueta ya son input/button, así
      que quedan cubiertos sin nada extra acá.
    */
    function ocuparFormulario(ocupado) {
      establecerFormularioOcupado(form, ocupado);
      campos.bio.controles[0].disabled = ocupado;
    }

    /*
      El editor de etiquetas de herramientas (mi-ficha.etiquetas.js) se
      instancia más abajo, después de dependenciasFaltantes():
      crearEditorDeEtiquetas() se LLAMA acá (no sólo se referencia dentro de
      un callback), así que si el script no llegó tiene que fallar por el
      mismo camino prolijo que cualquier otra dependencia faltante, con
      ERROR_DE_PAGINA y no con una excepción sin capturar.
    */
    let editorHerramientas;

    /*
      El catálogo es sólo para sugerir: si el script no llegó o la carga
      falla, queda vacío y el editor se degrada en silencio a texto libre, sin
      aviso ni reintento (a quien edita su ficha no le toca resolver eso).
    */
    async function cargarCatalogoHerramientas() {
      if (typeof cargarCatalogoDeEtiquetas !== "function") return;
      const resultado = await cargarCatalogoDeEtiquetas("herramientas");
      if (resultado?.ok) editorHerramientas.fijarCatalogo(resultado.etiquetas);
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
          cargarCatalogoHerramientas(),
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

    editorHerramientas = crearEditorDeEtiquetas({
      campo: "herramientas",
      input: herramientasInput,
      opciones: herramientasOpciones,
      lista: herramientasLista,
      estado: herramientasEstado,
      ayuda: herramientasAyuda,
      prefijoIdOpcion: "miFichaHerramientasOpcion",
      textoAyuda: AYUDA_HERRAMIENTAS,
      textoAyudaLlena: AYUDA_HERRAMIENTAS_LLENA,
      nombrePlural: "herramientas",
      marcarError: (mensaje) => marcarError("herramientas", mensaje),
      limpiarError: () => limpiarError("herramientas"),
    });

    // Devuelve la promesa del arranque: el navegador la ignora, los tests la
    // esperan.
    return cargar();
  }

  document.addEventListener("DOMContentLoaded", iniciar);
})();
