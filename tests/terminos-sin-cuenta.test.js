/* La puerta de Términos sin sesión: no hay frase que escribir, hay que iniciar
 * sesión. Sin cuenta la aceptación no se puede registrar, así que la puerta
 * ignora cualquier aceptación local y no deja pasar al aviso "no almacena". */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const SCRIPT = "src/app/features/transactions/extractor.js";
const PAGINA = "src/app/features/transactions/index.html";

function puerta() {
  const html = read(PAGINA);
  return html.slice(html.indexOf('id="puertaTerminos"'), html.indexOf('id="puertaAviso"'));
}

function revisarPuertas() {
  const js = read(SCRIPT);
  const inicio = js.indexOf("function revisarPuertas(");
  return js.slice(inicio, js.indexOf("\nfunction errorTerminos(", inicio));
}

test("the terms door has a login block, hidden by default, next to the phrase block", () => {
  const p = puerta();
  assert.match(p, /<div id="terminosConCuenta">/);
  assert.match(p, /<div id="terminosSinCuenta" hidden>/);
  const sin = p.slice(p.indexOf('id="terminosSinCuenta"'));
  assert.match(sin, /id="btnTerminosIniciarSesion"/);
  assert.match(sin, /class="button--glow"/);
  assert.match(sin, /href="\/app\/features\/auth\/login\/"/, "href de respaldo sin JS");
  assert.match(sin, /necesitas una cuenta/);
  const con = p.slice(p.indexOf('id="terminosConCuenta"'), p.indexOf('id="terminosSinCuenta"'));
  for (const id of ["fraseTerminos", "errorTerminos", "btnAceptarTerminos"]) {
    assert.ok(con.includes(`id="${id}"`), `${id} vive en el bloque con cuenta`);
    assert.ok(!sin.includes(`id="${id}"`), `${id} no se repite en el bloque sin cuenta`);
  }
});

test("revisarPuertas branches on the anonymous plan and sends the login to come back here", () => {
  const f = revisarPuertas();
  assert.match(f, /planActual === "anonimo"/);
  assert.match(f, /urlLoginConDestino\(window\.location\.pathname \+ window\.location\.search\)/);
  assert.match(f, /abrirPuerta\("puertaTerminos", "btnTerminosIniciarSesion"\)/);
  assert.match(f, /\.hidden = sinCuenta/);
  assert.match(f, /\.hidden = !sinCuenta/);
});

test("in the anonymous branch neither local acceptance nor the notice can interfere", () => {
  const f = revisarPuertas();
  const rama = f.slice(f.indexOf("if (sinCuenta) {"), f.indexOf("return;", f.indexOf("if (sinCuenta) {")));
  assert.ok(rama.length > 0);
  assert.ok(!/terminosLocales/.test(rama), "la rama anónima no consulta el registro local");
  assert.ok(!/terminos\.aceptados/.test(rama), "ni la aceptación que diga la cuota");
  assert.ok(!/mostrarAvisoSiProcede/.test(rama), "ni muestra el aviso");
  assert.match(rama, /cerrarPuerta\("puertaAviso"\)/);
});

test("the door waits for the quota: no call at load that would flash the login to an account", () => {
  const js = read(SCRIPT);
  // Sólo `actualizarCuota()`, el 403 y el registro de la aceptación la abren.
  assert.ok(!/^revisarPuertas\(/m.test(js), "ninguna llamada suelta al cargar");
  assert.match(js, /revisarPuertas\(cuota\.terminos \|\| terminosLocales\(\)\)/);
});
