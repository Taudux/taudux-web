const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const AISLADO = path.join(ROOT, "src/content/slides/_aislado");
const PUENTE = path.join(ROOT, "src/content/slides/_subida");
const leer = (dir, nombre) => fs.readFileSync(path.join(dir, nombre), "utf8");
const sinComentarios = (texto) => texto.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

const puente = require(path.join(PUENTE, "subida.logica.js"));
const adaptador = require(path.join(AISLADO, "adaptador.logica.js"));

/* Nodos de mentira: sólo lo que la lógica les pide. */
function nodo(tagName, atributos = {}, clases = []) {
  const mapa = new Map(Object.entries(atributos));
  const set = new Set(clases);
  return {
    tagName,
    classList: {
      contains: (c) => set.has(c),
      toggle: (c, forzar) => { if (forzar) set.add(c); else set.delete(c); },
    },
    get attributes() { return [...mapa].map(([name, value]) => ({ name, value })); },
  };
}

function documentoDe({ laminas = [], ids = [], otros = [] }) {
  const todos = [...laminas, ...otros];
  return {
    querySelectorAll(selector) {
      if (selector === "section.slide") return laminas.filter((l) => l.tagName === "section");
      if (selector === ".slide") return laminas;
      if (selector === "script") return otros.filter((n) => n.tagName === "script");
      if (selector === "*") return todos;
      return [];
    },
    getElementById: (id) => (ids.includes(id) ? nodo("button") : null),
  };
}

/* ---------- deckTraePrograma / leerEstadoAislado ---------- */

test("deckTraePrograma detecta <script> y handlers on*, y no lo demás", () => {
  const limpio = documentoDe({ laminas: [nodo("section", { class: "slide" })] });
  assert.equal(puente.deckTraePrograma(limpio), false);
  assert.equal(puente.deckTraePrograma(documentoDe({ otros: [nodo("script")] })), true);
  assert.equal(puente.deckTraePrograma(documentoDe({ otros: [nodo("button", { onclick: "x()" })] })), true);
  assert.equal(puente.deckTraePrograma(documentoDe({ otros: [nodo("div", { "data-on": "1" })] })), false);
  assert.equal(puente.deckTraePrograma(null), false);
});

test("leerEstadoAislado acepta sólo la forma esperada", () => {
  assert.deepEqual(puente.leerEstadoAislado({ tipo: "slides:estado", indice: 2, total: 22, controlesPropios: true }),
    { indice: 2, total: 22, controlesPropios: true });
  assert.equal(puente.leerEstadoAislado({ tipo: "slides:estado", indice: 1, total: 3 }).controlesPropios, false);
  assert.equal(puente.leerEstadoAislado({ tipo: "slides:estado", indice: 3, total: 3 }), null);
  assert.equal(puente.leerEstadoAislado({ tipo: "slides:estado", indice: "1", total: 3 }), null);
  assert.equal(puente.leerEstadoAislado({ tipo: "otro", indice: 0, total: 1 }), null);
  assert.equal(puente.leerEstadoAislado(null), null);
});

/* ---------- Lógica del adaptador ---------- */

test("el adaptador detecta la lámina activa con `active` y con `is-active`", () => {
  const a = [nodo("section", {}, ["slide"]), nodo("section", {}, ["slide", "active"]), nodo("section", {}, ["slide"])];
  assert.equal(adaptador.indiceActivo(a), 1);
  const b = [nodo("section", {}, ["slide"]), nodo("section", {}, ["slide"]), nodo("section", {}, ["slide", "is-active"])];
  assert.equal(adaptador.indiceActivo(b), 2);
  assert.equal(adaptador.indiceActivo([nodo("section", {}, ["slide"])]), 0, "sin activa, la primera");
});

test("el adaptador cuenta láminas y calcula controlesPropios", () => {
  const laminas = [nodo("section", {}, ["slide", "active"]), nodo("section", {}, ["slide"])];
  const con = adaptador.estadoDe(documentoDe({ laminas, ids: ["prev", "next"] }));
  assert.deepEqual(con, { tipo: "slides:estado", indice: 0, total: 2, controlesPropios: true });
  const sin = adaptador.estadoDe(documentoDe({ laminas, ids: ["next"] }));
  assert.equal(sin.controlesPropios, false);
});

test("pasoHacia, marcarActiva y ordenDelPuente", () => {
  assert.equal(adaptador.pasoHacia(1, 4), "siguiente");
  assert.equal(adaptador.pasoHacia(4, 1), "anterior");
  assert.equal(adaptador.pasoHacia(2, 2), null);
  assert.equal(adaptador.pasoHacia(2, NaN), null);
  const laminas = [nodo("section", {}, ["active"]), nodo("section", {}, [])];
  adaptador.marcarActiva(laminas, 1);
  assert.equal(adaptador.indiceActivo(laminas), 1);
  assert.equal(laminas[0].classList.contains("active"), false);
  assert.deepEqual(adaptador.ordenDelPuente({ tipo: "slides:ir", indice: 3.7 }), { tipo: "slides:ir", indice: 3 });
  assert.equal(adaptador.ordenDelPuente({ tipo: "slides:ir", indice: "3" }), null);
  assert.equal(adaptador.ordenDelPuente({ tipo: "x" }), null);
  assert.ok(adaptador.limiteDePasos(22) >= 22);
});

/* ---------- Fuentes: el puente y el marco ---------- */

test("el puente abre el marco SIN allow-same-origin, valida el origen del mensaje y conserva el camino sin scripts", () => {
  const js = leer(PUENTE, "subida.js");
  const sandbox = /setAttribute\("sandbox",\s*"([^"]+)"\)/.exec(js);
  assert.ok(sandbox, "el puente fija el atributo sandbox");
  assert.match(sandbox[1], /\ballow-scripts\b/);
  assert.doesNotMatch(sandbox[1], /allow-same-origin/);
  assert.doesNotMatch(sinComentarios(js).replace(/\/\/.*$/gm, ""), /allow-same-origin/);
  assert.match(js, /evento\.source !== marco\.contentWindow/);
  assert.match(js, /\/content\/slides\/_aislado\//);
  // El camino de siempre sigue ahí.
  assert.match(js, /prepararDeck\(texto, parser\)/);
  assert.match(js, /montarDeck\(deck\)/);
  assert.match(js, /deckTraePrograma\(/);
  assert.match(js, /\?v=\$\{fila\.version_archivo/);
});

test("el marco aislado existe, valida event.source === window.parent y anexa el adaptador", () => {
  const html = leer(AISLADO, "index.html");
  assert.match(html, /\/content\/slides\/_aislado\/aislado\.js/);
  assert.doesNotMatch(sinComentarios(html), /<script(?![^>]*\ssrc=)[^>]*>/i, "sin scripts inline");
  const js = leer(AISLADO, "aislado.js");
  assert.match(js, /evento\.source !== window\.parent/);
  assert.match(js, /slides:deck/);
  assert.match(js, /document\.write\(/);
  assert.match(js, /adaptador\.logica\.js/);
  assert.match(js, /adaptador\.js/);
  const ad = leer(AISLADO, "adaptador.js");
  assert.match(ad, /evento\.source !== padre/);
  assert.match(ad, /requestFullscreen = /);
  assert.match(ad, /slides:pantalla-completa/);
});

test("vercel.json: la regla de _aislado va ÚLTIMA y no deja salir nada de red", () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
  const ultima = vercel.headers[vercel.headers.length - 1];
  assert.equal(ultima.source, "/content/slides/_aislado(.*)");
  const valor = (n) => ultima.headers.find((h) => h.key === n)?.value;
  const csp = valor("Content-Security-Policy");
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /script-src 'self' 'unsafe-inline'/);
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /frame-ancestors 'self'/);
  assert.equal(valor("X-Frame-Options"), "SAMEORIGIN");
  assert.equal(valor("Referrer-Policy"), "no-referrer");
  assert.equal(valor("X-Content-Type-Options"), "nosniff");
  assert.match("/content/slides/_aislado/", /^\/content\/slides\/_aislado(.*)$/);
});
