const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const CAPTURA = path.join(ROOT, "src/content/slides/_captura");
const leer = (...partes) => fs.readFileSync(path.join(ROOT, ...partes), "utf8");
const sinComentarios = (texto) => texto.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

const logica = require(path.join(ROOT, "src/app/features/slides/slides.logica.js"));

test("el marco de captura no pide archivos, valida event.source y usa el sustituto de sandbox", () => {
  const html = fs.readFileSync(path.join(CAPTURA, "index.html"), "utf8");
  assert.doesNotMatch(html, /\ssrc=/i, "el marco no carga nada del servidor");
  assert.match(html, /evento\.source !== window\.parent/);
  assert.match(html, /slides:capturar/);
  assert.match(html, /slides:captura"/);
  assert.match(html, /sandbox: \{ remove/);
  assert.equal((html.match(/<\/script/gi) || []).length, 1, "un cierre literal dentro del script inline lo cortaría");
});

test("vercel.json: la regla de _captura va ÚLTIMA, abre connect-src a https y existe la de _aislado", () => {
  const vercel = JSON.parse(leer("vercel.json"));
  assert.ok(vercel.headers.some((r) => r.source === "/content/slides/_aislado(.*)"), "la regla de _aislado sigue");
  const ultima = vercel.headers[vercel.headers.length - 1];
  assert.equal(ultima.source, "/content/slides/_captura(.*)");
  const valor = (n) => ultima.headers.find((h) => h.key === n)?.value;
  const csp = valor("Content-Security-Policy");
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /connect-src https:/);
  assert.match(csp, /frame-ancestors 'self'/);
  assert.match(csp, /script-src 'self' 'unsafe-inline'/);
  assert.equal(valor("X-Frame-Options"), "SAMEORIGIN");
  assert.equal(valor("Referrer-Policy"), "no-referrer");
  assert.equal(valor("X-Content-Type-Options"), "nosniff");
  assert.equal(valor("X-Robots-Tag"), "noindex, nofollow");
  assert.match("/content/slides/_captura/", /^\/content\/slides\/_captura(.*)$/);
});

test("slides.js abre el marco de captura sin allow-same-origin, valida el origen y tiene tiempo límite", () => {
  const js = leer("src/app/features/slides/slides.js");
  assert.match(js, /setAttribute\("sandbox", "allow-scripts"\)/);
  assert.doesNotMatch(sinComentarios(js).replace(/\/\/.*$/gm, ""), /allow-same-origin/);
  assert.match(js, /evento\.source !== marco\.contentWindow/);
  assert.match(js, /setTimeout\(\(\) => terminar\(null\), 20000\)/);
  assert.match(js, /\/content\/slides\/_captura\//);
  assert.match(js, /Generando portada…/);
  assert.match(js, /No se pudo generar la portada; puedes subir una\./);
});

test("debeGenerarPortada: sólo sin portada elegida, sin «quitar» y sin portada previa", () => {
  const f = logica.debeGenerarPortada;
  assert.equal(f({ portadaElegida: null, quitarPortada: false, edicion: null }), true);
  assert.equal(f({ portadaElegida: {}, quitarPortada: false, edicion: null }), false);
  assert.equal(f({ portadaElegida: null, quitarPortada: true, edicion: { portada_path: "" } }), false);
  assert.equal(f({ portadaElegida: null, quitarPortada: false, edicion: { portada_path: "" } }), true);
  assert.equal(f({ portadaElegida: null, quitarPortada: false, edicion: { portada_path: "a/b.webp" } }), false);
  assert.equal(f(), true);
});

test("la librería vendida existe, trae su cabecera MIT y no puede cerrar un script inline", () => {
  const lib = fs.readFileSync(path.join(CAPTURA, "modern-screenshot.js"), "utf8");
  assert.match(lib.slice(0, 600), /modern-screenshot 4\.7\.0/);
  assert.match(lib.slice(0, 600), /MIT License/);
  assert.doesNotMatch(lib, /<\/script/i);
});

test("la captura no sale en blanco: el marco no va oculto y los fundidos se adelantan al final", () => {
  // Un marco oculto de otro origen no se dibuja: la transición de opacidad de
  // la primera lámina no avanzaba y la portada salía vacía (2026-10-07).
  const js = leer("src/app/features/slides/slides.js");
  const estilo = js.match(/marco\.style\.cssText =\s*"([^"]*)"/);
  assert.ok(estilo, "falta el estilo del marco de captura");
  assert.doesNotMatch(estilo[1], /visibility:\s*hidden/);
  assert.match(estilo[1], /left:-20000px/);
  const html = fs.readFileSync(path.join(CAPTURA, "index.html"), "utf8");
  assert.match(html, /document\.getAnimations\(\)\.forEach\([\s\S]{0,80}\.finish\(\)/);
});
