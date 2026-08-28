const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

/*
  La descarga es el único beneficio del playground reservado a quien tiene cuenta:
  es el gancho de conversión. Estas pruebas cuidan que el candado no se caiga por
  accidente en un refactor, y que siga siendo un candado que invita en vez de una
  función escondida.
*/

const JS = read("src/app/features/codigo/practica.js");
const HTML = read("src/app/features/codigo/python/index.html");

function cuerpoDeFuncion(fuente, nombre) {
  const inicio = fuente.indexOf(`function ${nombre}(`);
  assert.notEqual(inicio, -1, `no se encontró la función ${nombre}`);

  let profundidad = 0;
  let indice = fuente.indexOf("{", inicio);
  const desde = indice;

  for (; indice < fuente.length; indice += 1) {
    if (fuente[indice] === "{") profundidad += 1;
    if (fuente[indice] === "}") {
      profundidad -= 1;
      if (profundidad === 0) return fuente.slice(desde, indice + 1);
    }
  }
  throw new Error(`no se pudo delimitar el cuerpo de ${nombre}`);
}

/*
  Esta es la prueba central. Un guard puesto DESPUÉS de construir el Blob dejaría
  pasar la descarga igual: el orden es la garantía, no la existencia del if.
*/
test("sin sesión se corta antes de generar el archivo, no después", () => {
  const cuerpo = cuerpoDeFuncion(JS, "descargarCodigo");

  const posicionGuard = cuerpo.indexOf("if (!sesionActiva)");
  const posicionBlob = cuerpo.indexOf("new Blob");

  assert.notEqual(posicionGuard, -1, "descargarCodigo debe verificar la sesión");
  assert.notEqual(posicionBlob, -1, "descargarCodigo debe construir el archivo");
  assert.ok(posicionGuard < posicionBlob, "el guard de sesión va antes de generar el archivo");
  assert.ok(
    cuerpo.slice(posicionGuard, posicionBlob).includes("return"),
    "el guard debe cortar con return, no solo advertir",
  );
});

/*
  Si arrancara en true, el instante entre que carga la página y que responde
  obtenerSesion() sería una ventana para descargar sin cuenta.
*/
test("la sesión arranca en false hasta que Supabase conteste", () => {
  assert.match(JS, /let sesionActiva = false;/);
});

test("un fallo al resolver la sesión deja el botón bloqueado, no abierto", () => {
  const cuerpo = cuerpoDeFuncion(JS, "resolverSesion");
  const posicionCatch = cuerpo.indexOf("catch");
  assert.ok(posicionCatch !== -1, "resolverSesion debe atrapar el fallo");
  assert.match(cuerpo.slice(posicionCatch), /sesionActiva = false/);
});

/*
  El viaje al login tiene que volver al lenguaje en el que estaba el alumno, y el
  código sobrevive porque vive en localStorage. Sin `next`, entrar a la cuenta lo
  dejaría en el portal preguntándose dónde quedó su script.
*/
test("el login devuelve a la página del lenguaje que estaba usando", () => {
  const cuerpo = cuerpoDeFuncion(JS, "descargarCodigo");

  assert.match(cuerpo, /urlLoginConDestino\(lenguajeActivo\.ruta\)/);
  /*
    La ruta sale del catálogo, no de un hash armado a mano: cada entorno tiene su
    propia URL desde que se separaron las páginas, y un `#python` sobre el hub
    dejaría al alumno en el índice en vez de en su editor.
  */
  assert.doesNotMatch(cuerpo, /codigo\/#/, "un hash sobre el hub no abre ningún entorno");
});

/*
  Esconder el botón sin sesión no convertiría a nadie: nadie extraña lo que no
  vio. Debe seguir visible, y la nota tiene que ofrecer el camino a la cuenta.
*/
test("el botón se muestra bloqueado, no escondido, e invita a crear cuenta", () => {
  assert.match(HTML, /id="practicaDescargar"/);
  assert.match(HTML, /id="practicaNotaDescarga"/);
  assert.match(HTML, /href="\/app\/features\/auth\/signup\/"/);

  const cuerpo = cuerpoDeFuncion(JS, "actualizarAccesoDescarga");
  assert.match(cuerpo, /practica__descargar--bloqueado/);
  assert.match(cuerpo, /notaDescarga\.hidden = sesionActiva/);
  assert.doesNotMatch(cuerpo, /descargar\.hidden/, "el botón nunca se esconde");
  assert.doesNotMatch(cuerpo, /descargar\.disabled/, "deshabilitarlo impediría el clic que convierte");
});

/*
  El botón se reetiqueta con el nombre del archivo en cada cambio de lenguaje. Si
  ese camino no reaplicara el candado, cambiar de lenguaje lo dejaría con
  apariencia de desbloqueado.
*/
test("cambiar de lenguaje no borra el candado", () => {
  const cuerpo = cuerpoDeFuncion(JS, "aplicarLenguaje");
  assert.match(cuerpo, /actualizarAccesoDescarga\(\)/);
});

test("la nota desaparece cuando hay sesión", () => {
  const css = read("src/app/features/codigo/practica.css");
  assert.match(css, /\.practica__nota-descarga\s*\{/);
  assert.match(css, /\.practica__descargar--bloqueado\s*\{/);
});
