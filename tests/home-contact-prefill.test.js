const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

/*
  Precarga del formulario de contacto para un usuario logueado. "Empresa" no
  se prueba acá porque nunca se toca: no hay columna `empresa` en `perfiles`
  (ver el comentario en home.js), así que ese campo no tiene de dónde salir.
*/

function crearFormulario(valoresIniciales = {}) {
  return {
    elements: {
      nombre: { value: valoresIniciales.nombre || "" },
      email: { value: valoresIniciales.email || "" },
      telefono: { value: valoresIniciales.telefono || "" },
    },
  };
}

function crearContexto({ obtenerSesion, obtenerPerfil }) {
  const context = {
    console,
    document: {
      querySelector: () => null,
      addEventListener: () => {},
    },
    window: { addEventListener: () => {} },
    obtenerSesion,
    obtenerPerfil,
  };
  // home.js no expone sus funciones a propósito (es la página de entrada, no
  // un módulo compartido); se las pide acá igual que navbar.js lo hace en sus
  // propias pruebas, con un alias añadido al final del código fuente.
  vm.runInNewContext(
    `${read("src/app/features/home/home.js")}\nthis.precargarFormularioContacto = precargarFormularioContacto;`,
    context
  );
  return context;
}

test("with no session, the form is left exactly as the user typed it", async () => {
  const formulario = crearFormulario({ nombre: "Alguien ya escribió esto" });
  const context = crearContexto({
    obtenerSesion: async () => null,
    obtenerPerfil: async () => { throw new Error("no debería consultarse sin sesión"); },
  });

  await context.precargarFormularioContacto(formulario);

  assert.equal(formulario.elements.nombre.value, "Alguien ya escribió esto");
  assert.equal(formulario.elements.email.value, "");
  assert.equal(formulario.elements.telefono.value, "");
});

test("with a full session and profile, nombre, email, and telefono fill in — empresa is never touched", async () => {
  const formulario = crearFormulario();
  const context = crearContexto({
    obtenerSesion: async () => ({ user: { id: "u1", email: "persona@example.com" } }),
    obtenerPerfil: async () => ({ nombre: "Ana", apellidos: "Torres", telefono: "+524461234567" }),
  });

  await context.precargarFormularioContacto(formulario);

  assert.equal(formulario.elements.nombre.value, "Ana Torres");
  assert.equal(formulario.elements.email.value, "persona@example.com");
  assert.equal(formulario.elements.telefono.value, "+524461234567");
  assert.equal(formulario.elements.empresa, undefined, "el formulario real no tiene columna que respalde este campo");
});

test("a profile with only nombre (no apellidos) fills in without a trailing space", async () => {
  const formulario = crearFormulario();
  const context = crearContexto({
    obtenerSesion: async () => ({ user: { id: "u1", email: "solo@example.com" } }),
    obtenerPerfil: async () => ({ nombre: "Ana", apellidos: "", telefono: null }),
  });

  await context.precargarFormularioContacto(formulario);

  assert.equal(formulario.elements.nombre.value, "Ana");
  assert.equal(formulario.elements.telefono.value, "");
});

test("a session without a readable profile still fills the email — that one comes from auth, not perfiles", async () => {
  const formulario = crearFormulario();
  const context = crearContexto({
    obtenerSesion: async () => ({ user: { id: "u1", email: "sinperfil@example.com" } }),
    obtenerPerfil: async () => null,
  });

  await context.precargarFormularioContacto(formulario);

  assert.equal(formulario.elements.email.value, "sinperfil@example.com");
  assert.equal(formulario.elements.nombre.value, "");
});

test("fields the user already filled in are never overwritten, even with a full profile available", async () => {
  const formulario = crearFormulario({ nombre: "Nombre Propio", email: "propio@example.com", telefono: "0000000000" });
  const context = crearContexto({
    obtenerSesion: async () => ({ user: { id: "u1", email: "perfil@example.com" } }),
    obtenerPerfil: async () => ({ nombre: "Otro", apellidos: "Nombre", telefono: "+521111111111" }),
  });

  await context.precargarFormularioContacto(formulario);

  assert.equal(formulario.elements.nombre.value, "Nombre Propio");
  assert.equal(formulario.elements.email.value, "propio@example.com");
  assert.equal(formulario.elements.telefono.value, "0000000000");
});

/*
  EL FONDO DE PARTÍCULAS TIENE QUE ATRAVESAR TODA LA PÁGINA.

  Estaba encerrado en el hero y se cortaba al scrollear: Servicios, Tecnología
  y Contacto quedaban lisos. Ahora el lienzo es `fixed` y vive FUERA de las
  secciones.

  Lo que lo rompía no era obvio: `.home__section` se pintaba
  `background-color: var(--color-background)` —redundante, porque el `body` ya
  pinta ese mismo color— y con eso TAPABA el lienzo que corre por debajo. El
  fondo no desaparecía: quedaba cubierto. Un color pleno en una sección vuelve
  a romperlo sin que nada falle.
*/
const INDEX = "src/index.html";
const HOME_CSS = "src/app/features/home/home.css";
const HOME_JS = "src/app/features/home/home.js";

const sinComentariosHtml = (html) => html.replace(/<!--[\s\S]*?-->/g, "");
const sinComentariosCss = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

test("the particle backdrop lives outside every section, so scrolling cannot end it", () => {
  const html = sinComentariosHtml(read(INDEX));

  const fondo = html.indexOf('id="particles-fondo"');
  assert.notEqual(fondo, -1, "falta el contenedor global del fondo");

  // Fuera de cualquier <section> y del <header> del hero: si estuviera dentro,
  // volvería a terminarse con su sección.
  const primeraSeccion = Math.min(
    ...[html.indexOf("<header"), html.indexOf("<section")].filter((i) => i !== -1),
  );
  assert.ok(fondo < primeraSeccion,
    "el fondo debe declararse ANTES del contenido, como hijo directo de <body>");

  // Y el revelado de "Quiénes somos" NO es un fondo: depende de estar dentro
  // de su sección. No se toca.
  assert.match(html, /id="particles-quienes"/,
    "el revelado de Quiénes somos debe seguir en su sección");
});

test("no landing section paints an opaque colour over the backdrop", () => {
  const css = sinComentariosCss(read(HOME_CSS));

  const inicio = css.indexOf(".home__section");
  assert.notEqual(inicio, -1, "falta la regla .home__section");
  const fin = css.indexOf("}", inicio);
  assert.notEqual(fin, -1, "la regla .home__section no cierra");

  assert.doesNotMatch(
    css.slice(inicio, fin),
    /background(-color)?\s*:/,
    "un color pleno acá tapa el lienzo fijo y el fondo vuelve a 'desaparecer'",
  );
});

test("the backdrop loader points at the global container, not the old hero one", () => {
  const js = read(HOME_JS);

  assert.match(js, /tsParticles\.load\("particles-fondo"/,
    "el fondo debe cargarse en el contenedor global");
  assert.doesNotMatch(js, /"particles-hero"/,
    "el contenedor del hero ya no existe: una carga contra él sería silenciosa");
  assert.match(js, /tsParticles\.load\("particles-quienes"/,
    "y el revelado debe seguir cargándose aparte");
});

test("the backdrop's height doesn't follow the shrinking mobile viewport", () => {
  /*
    En móvil, la barra de direcciones se retrae al empezar a deslizar desde
    arriba y el viewport CRECE de golpe. Con `inset: 0`, el contenedor del
    lienzo seguía ese alto, y tsParticles reconstruye el canvas —3,4 MP a
    DPR 3— cada vez que su caja cambia de tamaño: justo en el arranque del
    scroll, que es cuando Jorge reportó el trabón.

    Ojo, esto NO se arregla con `interactivity.events.resize: false`: se probó
    el 2026-09-01 y el lienzo se reconstruyó igual, porque la librería observa
    su propio canvas por dentro, al margen de esa opción. La única palanca es
    que la caja deje de cambiar de alto.

    `lvh` es la altura de la ventana con la barra RETRAÍDA, y no se mueve
    mientras la barra aparece o desaparece. El fondo queda un poco más alto
    que la pantalla cuando la barra está visible — que es exactamente lo que
    se quiere en un fondo fijo: cubrir de más, nunca de menos.
  */
  const css = sinComentariosCss(read(HOME_CSS));

  const inicio = css.indexOf("#particles-fondo");
  assert.notEqual(inicio, -1, "falta la regla del contenedor del fondo");
  const fin = css.indexOf("}", inicio);
  assert.notEqual(fin, -1, "la regla #particles-fondo no cierra");
  const regla = css.slice(inicio, fin);

  assert.match(regla, /height:\s*100lvh/,
    "el alto se ancla a la ventana grande, no al viewport que encoge");
  assert.doesNotMatch(regla, /inset:\s*0\s*;/,
    "`inset: 0` vuelve a atar el alto al viewport dinámico");
});
