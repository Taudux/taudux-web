/*
  Cableado de "Mi ficha": arranque con sesión, carga de la ficha propia y el
  formulario que la guarda.

  La normalización y la validación viven en mi-ficha.logica.js; la lectura y
  el guardado, en core/colaboradores/ficha.service.js. Ambos se cargan antes y
  dejan sus funciones en el ámbito global. establecerFormularioOcupado sale de
  features/auth/auth-ui.js.

  Arranque: requerirSesion() (sin sesión ya navegó al login y acá no se hace
  nada más) → obtenerPerfil() → sólo si la cuenta está marcada como
  colaboradora, obtenerMiFicha() → formulario lleno, o vacío si todavía no hay
  ficha. Cualquier fallo de carga queda en el aviso con "Reintentar"; a quien
  no colabora se le dice, sin redirigirlo en silencio.

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

  // Los campos de texto de la ficha y su input. Cada uno tiene su ayuda en
  // `${id}Ayuda` y su error en `${id}Error`. La disponibilidad va aparte: es un
  // grupo de radios.
  const IDS_DE_CAMPO = Object.freeze({
    rol: "miFichaRol",
    especialidad: "miFichaEspecialidad",
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
    disponibilidad: "miFichaDisponibilidad",
    disponibilidadError: "miFichaDisponibilidadError",
    verPerfil: "miFichaVerPerfil",
  });

  /*
    Lo que la página necesita de los otros scripts. Si uno no llegó (un 404,
    un error de sintaxis), se dice de entrada y no a mitad de un guardado.
    `typeof` sobre una función no declarada da "undefined", no lanza.
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
      valoresFormularioMiFicha: typeof valoresFormularioMiFicha,
      nombreVisibleMiFicha: typeof nombreVisibleMiFicha,
      rutaPerfilPublicoMiFicha: typeof rutaPerfilPublicoMiFicha,
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

    const radios = Array.from(elementos.disponibilidad.querySelectorAll('input[type="radio"]'));
    if (radios.length === 0) return null;
    elementos.radios = radios;
    // En el grupo, aria-describedby va en el fieldset (se anuncia al entrar) y
    // aria-invalid en cada opción.
    elementos.campos.disponibilidad = {
      controles: radios,
      describe: elementos.disponibilidad,
      error: elementos.disponibilidadError,
      ayuda: elementos.disponibilidad.getAttribute("aria-describedby") || "",
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
    } = elementos;

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

    /* ---------- Valores ---------- */

    function llenarFormulario(ficha) {
      const valores = valoresFormularioMiFicha(ficha);
      for (const [campo, { controles }] of Object.entries(campos)) {
        if (campo === "disponibilidad") continue;
        controles[0].value = valores[campo];
      }
      radios.forEach((radio) => { radio.checked = radio.value === valores.disponibilidad; });
      limpiarErrores();
      ocultarEstado();
    }

    function leerFormulario() {
      const valores = {};
      for (const [campo, { controles }] of Object.entries(campos)) {
        if (campo === "disponibilidad") continue;
        valores[campo] = controles[0].value;
      }
      valores.disponibilidad = radios.find((radio) => radio.checked)?.value ?? "";
      return valores;
    }

    /*
      establecerFormularioOcupado (auth-ui.js) recorre button, input y select:
      la bio es un textarea y quedaría editable mientras se guarda.
    */
    function ocuparFormulario(ocupado) {
      establecerFormularioOcupado(form, ocupado);
      campos.bio.controles[0].disabled = ocupado;
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

        const resultado = await obtenerMiFicha(sesion.user.id);
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
      const evento = campo === "disponibilidad" ? "change" : "input";
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
