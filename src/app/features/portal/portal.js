/*
  Cableado del portal de cuenta: gate de sesión, conmutación de sección por el
  hash de la URL y el formulario de "Editar Perfil".

  La resolución del hash vive en portal.secciones.js, y la validación/diff del
  formulario en portal.perfil.js; ambos se cargan antes y dejan sus funciones
  en el ámbito global.

  Los errores del formulario van SIEMPRE a la región inline role="alert", nunca
  al canal global de telemetría de operaciones: ese canal ya dispara un toast
  genérico en navbar.js, y sumarle un mostrarToast propio duplicaría el aviso.
*/

(function () {
  const startup = document.getElementById("portalStartup");
  const contenido = document.getElementById("portalContent");

  function enlaces() {
    return Array.from(document.querySelectorAll(".portal__nav-link"));
  }

  function secciones() {
    return Array.from(document.querySelectorAll(".portal__section"));
  }

  function mostrarSeccion(id) {
    secciones().forEach((seccion) => {
      seccion.hidden = seccion.dataset.seccion !== id;
    });
    enlaces().forEach((enlace) => {
      if (enlace.dataset.seccion === id) enlace.setAttribute("aria-current", "page");
      else enlace.removeAttribute("aria-current");
    });
  }

  function aplicarHash() {
    mostrarSeccion(resolverSeccionActiva(window.location.hash, SECCIONES_PORTAL));
  }

  // El campo culpable de un error recibe aria-describedby + aria-invalid; el
  // resto de los inputs del form los pierde en cada intento nuevo.
  function marcarCampoInvalido(form, nombreCampo) {
    form.querySelectorAll("input").forEach((input) => {
      if (input.name === nombreCampo) {
        input.setAttribute("aria-describedby", "perfilStatus");
        input.setAttribute("aria-invalid", "true");
      } else {
        input.removeAttribute("aria-describedby");
        input.removeAttribute("aria-invalid");
      }
    });
  }

  function limpiarCamposInvalidos(form) {
    form.querySelectorAll("input").forEach((input) => {
      input.removeAttribute("aria-describedby");
      input.removeAttribute("aria-invalid");
    });
  }

  function mostrarErrorPerfil(form, estado, { campo, mensaje }) {
    estado.textContent = mensaje;
    estado.hidden = false;
    if (campo) marcarCampoInvalido(form, campo);
    estado.focus();
  }

  function ocultarErrorPerfil(form, estado) {
    if (estado.hidden) return;
    estado.hidden = true;
    estado.textContent = "";
    limpiarCamposInvalidos(form);
  }

  function leerFormularioPerfil(form) {
    return {
      nombre: form.elements.nombre.value,
      apellidos: form.elements.apellidos.value,
      telefono: form.elements.telefono.value,
    };
  }

  function poblarFormularioPerfil(form, perfil) {
    const datos = normalizarPerfil(perfil || {});
    form.elements.nombre.value = datos.nombre;
    form.elements.apellidos.value = datos.apellidos;
    form.elements.telefono.value = datos.telefono;
    return datos;
  }

  function configurarFormularioPerfil(session, perfilInicial) {
    const form = document.getElementById("formPerfil");
    const estado = document.getElementById("perfilStatus");
    if (!form || !estado) return;

    let original = poblarFormularioPerfil(form, perfilInicial);

    form.addEventListener("submit", async (evento) => {
      evento.preventDefault();

      const actual = normalizarPerfil(leerFormularioPerfil(form));
      const cambios = camposModificados(original, actual);
      if (Object.keys(cambios).length === 0) {
        ocultarErrorPerfil(form, estado);
        return;
      }

      // Solo se valida lo que realmente va a cambiar: un dato legacy inválido
      // en un campo que el usuario no tocó no debe bloquear guardar otro.
      const validacion = validarCambios(cambios);
      if (!validacion.ok) {
        mostrarErrorPerfil(form, estado, validacion);
        return;
      }

      establecerFormularioOcupado(form, true);
      try {
        const resultado = await actualizarPerfil(session.user.id, cambios);
        if (!resultado.ok) {
          mostrarErrorPerfil(form, estado, { mensaje: resultado.mensaje });
          return;
        }
        original = poblarFormularioPerfil(form, resultado.data);
        ocultarErrorPerfil(form, estado);
        mostrarToast("Cambios guardados.", "success");
      } finally {
        establecerFormularioOcupado(form, false);
      }
    });
  }

  // El campo culpable de un error recibe aria-describedby + aria-invalid; el
  // resto de los inputs del form los pierde en cada intento nuevo. Réplica del
  // helper de "Editar Perfil" pero apuntando a contrasenaStatus.
  function marcarCampoInvalidoContrasena(form, nombreCampo) {
    form.querySelectorAll("input").forEach((input) => {
      if (input.name === nombreCampo) {
        input.setAttribute("aria-describedby", "contrasenaStatus");
        input.setAttribute("aria-invalid", "true");
      } else {
        input.removeAttribute("aria-describedby");
        input.removeAttribute("aria-invalid");
      }
    });
  }

  function limpiarCamposInvalidosContrasena(form) {
    form.querySelectorAll("input").forEach((input) => {
      input.removeAttribute("aria-describedby");
      input.removeAttribute("aria-invalid");
    });
  }

  function mostrarErrorContrasena(form, estado, { campo, mensaje }) {
    estado.textContent = mensaje;
    estado.hidden = false;
    if (campo) marcarCampoInvalidoContrasena(form, campo);
    estado.focus();
    mostrarToast(mensaje, "error");
  }

  function ocultarErrorContrasena(form, estado) {
    if (estado.hidden) return;
    estado.hidden = true;
    estado.textContent = "";
    limpiarCamposInvalidosContrasena(form);
  }

  function limpiarFormularioContrasena(form) {
    form.elements.actual.value = "";
    form.elements.nueva.value = "";
    form.elements.confirmar.value = "";
  }

  /*
    Cuenta sin identidad email (entró sólo con Google): no hay "contraseña
    actual" que pedir. En vez de inventar un mecanismo de re-autenticación
    nuevo, se reusa recuperarContrasena() — el mismo correo que ya manda
    forgot-password/ — para que el usuario cree una contraseña y a partir de
    ahí use el portal como cualquier cuenta con contraseña. No baja el piso de
    seguridad: es la misma prueba de control del buzón que forgot-password ya
    exige hoy para tomar cualquier cuenta con contraseña.
  */
  function configurarEnvioEnlaceContrasena({ boton, estado, email }) {
    if (!boton || !estado) return;

    boton.addEventListener("click", async () => {
      const textoOriginal = boton.textContent;
      boton.disabled = true;
      boton.textContent = boton.dataset.loadingText || "Enviando…";
      try {
        const resultado = await recuperarContrasena(email);
        estado.textContent = resultado.ok
          ? `Te enviamos un enlace a ${email}. Ábrelo para crear tu contraseña.`
          : resultado.mensaje;
        if (!resultado.ok) mostrarToast(resultado.mensaje, "error");
      } finally {
        boton.textContent = textoOriginal;
        boton.disabled = false;
      }
    });
  }

  /*
    El resto de esta función (requisitos, coincidencia y el submit con
    signInWithPassword) queda sin ramificar a propósito: con tieneContrasena
    en false el form nunca se muestra y su campo actual queda disabled, así
    que ese código simplemente no llega a ejecutarse por interacción del
    usuario. Ramificarlo también duplicaría lógica sin necesidad.
  */
  function configurarFormularioContrasena(session) {
    const form = document.getElementById("formContrasena");
    const estado = document.getElementById("contrasenaStatus");
    if (!form || !estado) return;

    const aviso = document.getElementById("avisoSinContrasena");
    const tieneContrasena = puedeUsarContrasena(session.user);

    form.hidden = !tieneContrasena;
    form.elements.actual.required = tieneContrasena;
    form.elements.actual.disabled = !tieneContrasena;
    if (aviso) aviso.hidden = tieneContrasena;

    if (!tieneContrasena) {
      configurarEnvioEnlaceContrasena({
        boton: document.getElementById("botonEnlaceContrasena"),
        estado: document.getElementById("avisoSinContrasenaEstado"),
        email: session.user.email,
      });
    }

    configurarRequisitosContrasena(
      document.getElementById("contrasenaNueva"),
      document.getElementById("contrasenaNuevaReqs"),
    );
    configurarCoincidenciaContrasenas(
      document.getElementById("contrasenaNueva"),
      document.getElementById("contrasenaConfirmar"),
      document.getElementById("contrasenaMatch"),
    );

    form.addEventListener("submit", async (evento) => {
      evento.preventDefault();

      const actual = form.elements.actual.value;
      const nueva = form.elements.nueva.value;
      const confirmar = form.elements.confirmar.value;

      if (nueva !== confirmar) {
        mostrarErrorContrasena(form, estado, {
          campo: "confirmar",
          mensaje: "Las contraseñas no coinciden.",
        });
        form.elements.confirmar.focus();
        return;
      }

      if (!contrasenaValida(nueva)) {
        mostrarErrorContrasena(form, estado, {
          campo: "nueva",
          mensaje: "La contraseña no cumple los requisitos.",
        });
        return;
      }

      establecerFormularioOcupado(form, true);
      try {
        // Re-autenticación obligatoria: cambiar la contraseña sin confirmar la
        // actual dejaría secuestrar la cuenta a quien encuentre una sesión
        // abierta sin vigilancia.
        const reauth = await supabaseClient.auth.signInWithPassword({
          email: session.user.email,
          password: actual,
        });
        if (reauth.error) {
          mostrarErrorContrasena(form, estado, {
            campo: "actual",
            mensaje: "Contraseña actual incorrecta.",
          });
          return;
        }

        const resultado = await cambiarContrasena(nueva);
        if (!resultado.ok) {
          mostrarErrorContrasena(form, estado, { mensaje: resultado.mensaje });
          return;
        }

        await cerrarSesion({ scope: "others" });
        limpiarFormularioContrasena(form);
        ocultarErrorContrasena(form, estado);
        mostrarToast("Contraseña actualizada. Cerramos tus otras sesiones.", "success");
      } finally {
        establecerFormularioOcupado(form, false);
      }
    });
  }

  function configurarCierreSesion() {
    const boton = document.getElementById("botonCerrarSesion");
    if (!boton) return;

    boton.addEventListener("click", async () => {
      await cerrarSesion();
      window.location.href = "/";
    });
  }

  function mostrarErrorEliminarCuenta(form, estado, mensaje) {
    estado.textContent = mensaje;
    estado.hidden = false;
    form.elements.contrasena.setAttribute("aria-describedby", "eliminarCuentaStatus");
    form.elements.contrasena.setAttribute("aria-invalid", "true");
    estado.focus();
    mostrarToast(mensaje, "error");
  }

  function ocultarErrorEliminarCuenta(form, estado) {
    if (estado.hidden) return;
    estado.hidden = true;
    estado.textContent = "";
    form.elements.contrasena.removeAttribute("aria-describedby");
    form.elements.contrasena.removeAttribute("aria-invalid");
  }

  /*
    Doble barrera antes de un borrado irreversible: primero la contraseña actual
    (que alguien con la sesión abierta no necesariamente conoce) y después el
    correo tipeado en el diálogo. El toast del diálogo se emite recién cuando la
    promesa resuelve, porque el top layer del <dialog> taparía cualquier toast
    lanzado antes.

    Una cuenta sin identidad email no tiene esa primera barrera para dar: en su
    lugar se reautentica volviendo a entrar con Google (reautenticarConGoogle,
    auth.service.js). El diálogo de tipeo del correo se abre recién al volver
    — retomarEliminarCuentaTrasGoogle(), llamada desde inicializarPortal() —
    para que el borrado siga exigiendo pasar por el proveedor antes de la
    confirmación, no antes.
  */
  function configurarEliminarCuenta(session) {
    const boton = document.getElementById("botonMostrarEliminarCuenta");
    const form = document.getElementById("formEliminarCuenta");
    const estado = document.getElementById("eliminarCuentaStatus");
    if (!boton || !form || !estado) return;

    const aviso = document.getElementById("avisoSinContrasenaEliminar");
    const botonGoogle = document.getElementById("botonReautenticarGoogle");
    const estadoGoogle = document.getElementById("avisoSinContrasenaEliminarEstado");
    const tieneContrasena = puedeUsarContrasena(session.user);

    form.elements.contrasena.required = tieneContrasena;
    form.elements.contrasena.disabled = !tieneContrasena;

    if (!tieneContrasena && botonGoogle) {
      botonGoogle.addEventListener("click", async () => {
        establecerBotonOcupado(botonGoogle, true);
        try {
          sessionStorage.setItem(
            CLAVE_REAUTH_ELIMINAR,
            JSON.stringify(marcaDeReauthEliminar(session.user.id, Date.now())),
          );
        } catch {
          // Storage bloqueado: el intento sigue, pero al volver no habrá marca
          // que retomar (ver reauthEliminarEsValida) — falla a no hacer nada,
          // nunca a borrar sin confirmación.
        }

        const resultado = await reautenticarConGoogle();
        // Con éxito el navegador ya se fue a Google; solo se llega acá si falló.
        if (!resultado.ok) {
          if (estadoGoogle) estadoGoogle.textContent = resultado.mensaje;
          mostrarToast(resultado.mensaje, "error");
          establecerBotonOcupado(botonGoogle, false);
        }
      });
    }

    boton.addEventListener("click", () => {
      boton.hidden = true;
      if (tieneContrasena) {
        form.hidden = false;
        form.elements.contrasena.focus();
      } else if (aviso) {
        aviso.hidden = false;
        if (botonGoogle) botonGoogle.focus();
      }
    });

    form.addEventListener("submit", async (evento) => {
      evento.preventDefault();
      ocultarErrorEliminarCuenta(form, estado);

      const contrasena = form.elements.contrasena.value;
      if (!contrasena) {
        mostrarErrorEliminarCuenta(form, estado, "Escribe tu contraseña actual para continuar.");
        return;
      }

      establecerFormularioOcupado(form, true);
      try {
        const reauth = await supabaseClient.auth.signInWithPassword({
          email: session.user.email,
          password: contrasena,
        });
        if (reauth.error) {
          mostrarErrorEliminarCuenta(form, estado, "Contraseña actual incorrecta.");
          return;
        }

        const confirmado = await confirmarConTexto({
          titulo: "Eliminar cuenta",
          mensaje: `Se eliminarán tu cuenta (${session.user.email}) y tu perfil de forma permanente. Esta acción no se puede deshacer.`,
          textoEsperado: session.user.email,
          etiquetaEntrada: "Escribe tu correo para confirmar:",
          etiquetaConfirmar: "Eliminar cuenta",
        });
        if (!confirmado) {
          form.elements.contrasena.value = "";
          return;
        }

        const resultado = await eliminarCuenta();
        if (!resultado.ok) {
          mostrarErrorEliminarCuenta(form, estado, resultado.mensaje);
          return;
        }

        // La cuenta ya no existe: el signOut solo limpia la sesión local, y si
        // fallara igual hay que sacar al usuario de un portal sin dueño.
        await cerrarSesion({ scope: "local" });
        window.location.href = "/";
      } finally {
        establecerFormularioOcupado(form, false);
      }
    });
  }

  function configurarSeccionCuenta(session) {
    const email = document.getElementById("cuentaEmail");
    if (email) email.value = session.user.email || "";

    configurarFormularioContrasena(session);
    configurarCierreSesion();
    configurarEliminarCuenta(session);
  }

  function leerMarcaReauthEliminar() {
    try {
      return JSON.parse(sessionStorage.getItem(CLAVE_REAUTH_ELIMINAR));
    } catch {
      return null;
    }
  }

  function limpiarMarcaReauthEliminar() {
    try {
      sessionStorage.removeItem(CLAVE_REAUTH_ELIMINAR);
    } catch {
      // La marca es una mejora de navegación: no debe romper el portal si el
      // storage está bloqueado.
    }
  }

  function tieneCodigoOauthEnUrl() {
    return new URLSearchParams(window.location.search).has("code");
  }

  /*
    Estado terminal para un retorno de Google que no llegó a producir sesión.
    Reusa el bloque de arranque (ya es role="status" y focusable) en vez de un
    toast: sin sesión no hay portal que revelar detrás, y un toast sobre una
    pantalla vacía se lee como un error suelto. Mismo recurso que
    mostrarFalloOauth() en oauth-callback.js.
  */
  function mostrarFalloReauth(mensaje) {
    if (!startup) return;
    startup.textContent = mensaje;
    startup.hidden = false;
    // El aria-busy queda en true desde el markup: dejarlo así sobre un mensaje
    // terminal le diría al lector de pantalla que todavía está cargando.
    startup.setAttribute("aria-busy", "false");
    startup.focus();
  }

  /*
    El ?code= de Google llega directo al portal (no pasa por oauth-callback.js:
    ver portal.reauth.js) y el cliente lo canjea solo (detectSessionInUrl:
    true), pero el canje es asíncrono. Sin esperarlo, requerirSesion() puede
    correr una fracción de segundo antes de que la sesión exista y mandar al
    usuario a login, perdiendo el intento de borrado. Mismo patrón de espera
    que esperarSesionOauth() en oauth-callback.js, acotado a 8s.
  */
  async function esperarSesionTrasReauth() {
    const sesionExistente = await obtenerSesion();
    if (sesionExistente) return sesionExistente;

    let resolverSesion;
    const sesionDetectada = new Promise((resolve) => {
      resolverSesion = resolve;
    });
    const { data } = supabaseClient.auth.onAuthStateChange((evento, session) => {
      if (session && evento === "SIGNED_IN") resolverSesion(session);
    });

    try {
      return await Promise.race([
        sesionDetectada,
        new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
      ]);
    } finally {
      data.subscription.unsubscribe();
    }
  }

  /*
    Retoma el borrado de cuenta tras volver de reautenticarse con Google. La
    marca se borra siempre, sea cual sea el resultado: es de un solo uso, así
    que un refresh posterior de la página no vuelve a abrir el diálogo.

    Una marca inválida (venció, o el usuarioId no coincide porque
    select_account dejó elegir otra cuenta) no dispara ningún error ruidoso
    por sí sola aparte del toast: nunca se llega a mostrar el diálogo de
    confirmación, así que no hay ningún borrado en juego.
  */
  async function retomarEliminarCuentaTrasGoogle(session, marca) {
    limpiarMarcaReauthEliminar();

    if (!reauthEliminarEsValida(marca, session.user.id, Date.now())) {
      mostrarToast(
        "No pudimos confirmar tu identidad con esa cuenta de Google. Intenta eliminar tu cuenta de nuevo.",
        "error",
      );
      return;
    }

    const confirmado = await confirmarConTexto({
      titulo: "Eliminar cuenta",
      mensaje: `Se eliminarán tu cuenta (${session.user.email}) y tu perfil de forma permanente. Esta acción no se puede deshacer.`,
      textoEsperado: session.user.email,
      etiquetaEntrada: "Escribe tu correo para confirmar:",
      etiquetaConfirmar: "Eliminar cuenta",
    });
    if (!confirmado) return;

    const resultado = await eliminarCuenta();
    if (!resultado.ok) {
      mostrarToast(resultado.mensaje, "error");
      return;
    }

    // La cuenta ya no existe: el signOut solo limpia la sesión local, y si
    // fallara igual hay que sacar al usuario de un portal sin dueño.
    await cerrarSesion({ scope: "local" });
    window.location.href = "/";
  }

  // El perfil llega de la BD en snake_case (avisos_curso_nuevo); el núcleo
  // puro trabaja en camelCase, igual que el name del checkbox del form.
  function poblarFormularioCorreo(form, perfil) {
    const datos = normalizarPreferenciasCorreo({
      avisosCursoNuevo: perfil && perfil.avisos_curso_nuevo,
    });
    form.elements.avisosCursoNuevo.checked = datos.avisosCursoNuevo;
    return datos;
  }

  function leerFormularioCorreo(form) {
    return { avisosCursoNuevo: form.elements.avisosCursoNuevo.checked };
  }

  function mostrarErrorCorreo(estado, mensaje) {
    estado.textContent = mensaje;
    estado.hidden = false;
    estado.focus();
  }

  function ocultarErrorCorreo(estado) {
    if (estado.hidden) return;
    estado.hidden = true;
    estado.textContent = "";
  }

  function configurarFormularioCorreo(session, perfilInicial) {
    const form = document.getElementById("formCorreo");
    const estado = document.getElementById("correoStatus");
    if (!form || !estado) return;

    let original = poblarFormularioCorreo(form, perfilInicial);

    form.addEventListener("submit", async (evento) => {
      evento.preventDefault();

      const actual = leerFormularioCorreo(form);
      const cambios = cambiosPreferenciasCorreo(original, actual);
      if (Object.keys(cambios).length === 0) {
        ocultarErrorCorreo(estado);
        return;
      }

      establecerFormularioOcupado(form, true);
      try {
        const resultado = await actualizarPerfil(session.user.id, cambios);
        if (!resultado.ok) {
          mostrarErrorCorreo(estado, resultado.mensaje);
          return;
        }
        original = poblarFormularioCorreo(form, resultado.data);
        ocultarErrorCorreo(estado);
        mostrarToast("Preferencia guardada.", "success");
      } finally {
        establecerFormularioOcupado(form, false);
      }
    });
  }

  async function inicializarPortal() {
    // Se lee una sola vez: tanto la espera pre-sesión como el retomo
    // post-sesión de más abajo dependen de esta misma marca y del mismo
    // ?code=, así que no tiene sentido volver a consultarlos.
    const marcaReauth = leerMarcaReauthEliminar();
    const conCodigoOauth = tieneCodigoOauthEnUrl();
    let avisoReauth = null;

    if (marcaReauth && !conCodigoOauth) {
      // Volver sin ?code= y con marca pendiente son dos situaciones distintas:
      // el proveedor devolvió un error (cancelación incluida), o es una carga
      // normal del portal arrastrando una marca vieja. Sólo la primera merece
      // aviso; la segunda se limpia en silencio, como antes.
      limpiarMarcaReauthEliminar();
      const errorProveedor = parametrosErrorAuth();
      if (errorProveedor) {
        const cancelado =
          errorProveedor.codigo === "access_denied" ||
          /access_denied/.test(errorProveedor.descripcion || "");
        avisoReauth = cancelado
          ? "No completaste la verificación con Google, así que tu cuenta sigue activa."
          : "No pudimos verificar tu identidad con Google. Tu cuenta sigue activa.";
      }
    }

    if (marcaReauth && conCodigoOauth) {
      const sesionReauth = await esperarSesionTrasReauth();
      history.replaceState(null, "", window.location.pathname);
      /*
        Sin sesión tras el canje no se sigue de largo: requerirSesion() mandaría
        al login sin explicar nada y el usuario perdería el intento sin saber
        por qué terminó en la pantalla de acceso. Se frena acá con un estado
        terminal que sí se entiende.
      */
      if (!sesionReauth) {
        limpiarMarcaReauthEliminar();
        mostrarFalloReauth(
          "No pudimos completar la verificación con Google. Recarga la página para volver a intentarlo.",
        );
        return;
      }

      /*
        Validación temprana, antes de poblar o revelar nada. select_account deja
        elegir una cuenta de Google distinta de la que pidió el borrado, y esa
        sesión se establece de verdad: seguir de largo mostraría el perfil ajeno
        y, peor, dejaría esa sesión viva. Un segundo intento de borrado
        arrancaría desde ella, guardaría la marca con SU id, coincidiría al
        volver y borraría la cuenta equivocada.

        Por eso el mismatch no sólo aborta: cierra la sesión (scope local — es
        una sesión legítima, no hay nada que revocar en el servidor, sólo no es
        la que corresponde a este flujo) y lo dice con todas las letras. El
        mensaje genérico anterior se leía como "no pasó nada", que es
        justamente lo que hacía peligroso el segundo intento.

        La comprobación se repite dentro de retomarEliminarCuentaTrasGoogle a
        propósito: esta capa evita el estado inconsistente, aquella es el guard
        pegado a la acción irreversible.

        Se redirige al login en vez de quedarse con un mensaje acá: sin sesión
        el portal no tiene nada que mostrar, y el navbar ya se montó con la
        sesión ajena (montarMenus lee la sesión una sola vez al cargar — ver
        navbar.js — y deja el nombre del perfil en el menú). Una carga de página
        nueva lo arma de cero, sin sesión y sin datos de la otra cuenta.
        `replace` y no `href`: un portal sin dueño no debe quedar en el
        historial.
      */
      if (!reauthEliminarEsValida(marcaReauth, sesionReauth.user.id, Date.now())) {
        limpiarMarcaReauthEliminar();
        await cerrarSesion({ scope: "local" });
        window.location.replace(`${RUTAS_AUTH.login}?reauth=cuenta-distinta`);
        return;
      }
    }

    // Sin sesión, requerirSesion ya navegó al login con ?next=: no hay nada más
    // que hacer en esta página, ni siquiera revelar el contenido.
    const session = await requerirSesion();
    if (!session) return;

    aplicarHash();
    window.addEventListener("hashchange", aplicarHash);

    const perfil = await obtenerPerfil(session);
    configurarFormularioPerfil(session, perfil);
    configurarSeccionCuenta(session);
    configurarFormularioCorreo(session, perfil);

    if (contenido) contenido.hidden = false;
    if (startup) {
      startup.hidden = true;
      startup.setAttribute("aria-busy", "false");
    }

    // Los dos avisos van después de revelar el portal: un toast o un diálogo
    // lanzados antes se dibujarían sobre la pantalla de arranque, sin contexto
    // detrás.
    if (avisoReauth) mostrarToast(avisoReauth, "error");
    if (marcaReauth && conCodigoOauth) {
      await retomarEliminarCuentaTrasGoogle(session, marcaReauth);
    }
  }

  inicializarPortal();
})();
