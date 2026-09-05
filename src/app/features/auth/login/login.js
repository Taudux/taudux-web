/* Inicio de sesión y reenvío de confirmación para cuentas no confirmadas. */

const loginForm = document.getElementById("loginForm");
const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");
const reenviarButton = document.getElementById("reenviarButton");
const googleButton = document.getElementById("googleButton");
const recordarmeCheckbox = document.getElementById("recordarme");

/*
  Guarda la elección de "Recordarme" ANTES de que el login viaje.

  El orden no es cosmético: quien la lee es el **documento siguiente**, cuando
  `supabase-client.js` construye su cliente y elige dónde guardar la sesión.
  Escribirla después de `iniciarSesion()` llegaría tarde — la sesión ya estaría
  en el storage viejo.

  Por eso también se llama antes del redirect a Google: ahí el navegador se va
  a `accounts.google.com` y vuelve con un documento nuevo, que es justamente el
  que tiene que encontrarla escrita. Mismo patrón que la marca de reauth del
  portal (`portal.js`).

  En `try/catch` y sin ruido, como todo acceso a storage en este repo: un
  navegador con el storage bloqueado no puede impedir que alguien inicie
  sesión — simplemente no lo vamos a recordar.
*/
function guardarPreferenciaRecordarme() {
  try {
    if (recordarmeCheckbox?.checked) {
      localStorage.setItem("taudux_recordarme", "1");
    } else {
      localStorage.removeItem("taudux_recordarme");
    }
  } catch {
    // Storage bloqueado: la sesión caerá a sessionStorage, que es el default
    // seguro. No hay nada que avisar.
  }
}

const parametrosLogin = new URLSearchParams(window.location.search);
const errorEnlaceLogin = parametrosErrorAuth();
if (parametrosLogin.get("confirmed") === "1") {
  mostrarEstadoAuth("Correo confirmado. Ya puedes iniciar sesión.", "success", false);
} else if (parametrosLogin.get("password-reset") === "1") {
  mostrarEstadoAuth("Contraseña actualizada. Inicia sesión con tu nueva contraseña.", "success", false);
} else if (parametrosLogin.get("reauth") === "cuenta-distinta") {
  // El portal manda acá cuando la reautenticación con Google para eliminar la
  // cuenta vuelve con OTRA cuenta del selector: cierra esa sesión y delega el
  // aviso a esta pantalla, que es donde el usuario tiene que actuar.
  mostrarEstadoAuth(
    "Elegiste otra cuenta de Google, distinta de la que pediste eliminar. No borramos nada. Inicia sesión con la cuenta que quieres eliminar.",
    "error",
    false,
  );
} else if (errorEnlaceLogin) {
  // El guard no distingue "enlace expirado" de "callback mal aterrizado";
  // este mensaje cubre el caso donde igual se termina en login.
  mostrarEstadoAuth(mensajeErrorEnlace(errorEnlaceLogin), "error", false);
}

redirigirSiSesionActiva();

loginForm.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (formularioEstaOcupado(loginForm)) return;

  reenviarButton.hidden = true;
  ocultarEstadoAuth();
  if (!loginForm.checkValidity()) {
    loginForm.reportValidity();
    return;
  }

  // ANTES de autenticar, y no es cosmético: el token se escribe durante
  // `iniciarSesion()` y el almacenamiento se resuelve en ese instante. Guardar
  // la preferencia después dejaría la sesión del lado equivocado.
  guardarPreferenciaRecordarme();

  establecerFormularioOcupado(loginForm, true);
  try {
    const resultado = await iniciarSesion(loginEmail.value.trim(), loginPassword.value);
    if (!resultado.ok) {
      mostrarEstadoAuth(resultado.mensaje, "error", true, [loginEmail, loginPassword]);
      reenviarButton.hidden = !resultado.noConfirmado;
      return;
    }

    const destino = destinoDespuesDeAuth();
    limpiarDestinoAuth();
    window.location.replace(destino);
  } finally {
    establecerFormularioOcupado(loginForm, false);
  }
});

googleButton.addEventListener("click", async () => {
  if (formularioEstaOcupado(loginForm)) return;
  ocultarEstadoAuth();

  // Antes del redirect: el navegador se va a Google y vuelve con un documento
  // nuevo, que es el que tiene que encontrar esta preferencia escrita.
  guardarPreferenciaRecordarme();

  establecerBotonOcupado(googleButton, true);
  const resultado = await iniciarSesionConGoogle();
  // En el camino feliz el navegador ya se fue a Google; solo se llega acá si falló.
  if (!resultado.ok) {
    establecerBotonOcupado(googleButton, false);
    mostrarEstadoAuth(resultado.mensaje, "error");
  }
});

reenviarButton.addEventListener("click", async () => {
  if (formularioEstaOcupado(loginForm)) return;
  const email = loginEmail.value.trim();
  if (!email || !loginEmail.checkValidity()) {
    loginEmail.focus();
    mostrarEstadoAuth(
      "Escribe un correo válido para reenviar la confirmación.",
      "error",
      true,
      [loginEmail]
    );
    return;
  }

  establecerFormularioOcupado(loginForm, true);
  establecerBotonOcupado(reenviarButton, true);
  try {
    const resultado = await reenviarConfirmacion(email);
    mostrarEstadoAuth(
      resultado.ok
        ? "Si la cuenta está pendiente de confirmación, recibirás un nuevo correo."
        : resultado.mensaje,
      resultado.ok ? "success" : "error",
      true,
      resultado.ok ? [] : [loginEmail]
    );
  } finally {
    establecerBotonOcupado(reenviarButton, false);
    establecerFormularioOcupado(loginForm, false);
  }
});
