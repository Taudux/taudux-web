const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const nucleo = require(path.join(ROOT, "src/app/features/qr/qr.nucleo.js"));

const AHORA = Date.parse("2026-09-28T12:00:00Z");
const enMinutos = (minutos) => new Date(AHORA + minutos * 60 * 1000).toISOString();
const PLANES = [{ clave: "free", nombre: "Gratis", limite: 5, duracion: "7 days", activo: true }];

/* Estado y tiempo restante. */

test("a QR is active, expired or blocked, and blocking wins over expiry", () => {
  assert.equal(nucleo.estadoQR({ vence_en: enMinutos(10) }, AHORA), "activo");
  assert.equal(nucleo.estadoQR({ vence_en: null }, AHORA), "activo", "sin vencimiento: acceso ilimitado");
  assert.equal(nucleo.estadoQR({ vence_en: enMinutos(0) }, AHORA), "vencido", "vence justo en el instante");
  assert.equal(nucleo.estadoQR({ vence_en: enMinutos(-1) }, AHORA), "vencido");
  assert.equal(nucleo.estadoQR({ vence_en: enMinutos(-1), bloqueado_en: enMinutos(-5) }, AHORA), "bloqueado");
});

test("the countdown rounds down and names days, hours and minutes in Spanish", () => {
  const texto = (minutos) => nucleo.tiempoRestanteQR(enMinutos(minutos), AHORA).texto;
  assert.equal(texto(7 * 24 * 60), "Vence en 7 días 0 h");
  assert.equal(texto(24 * 60 + 90), "Vence en 1 día 1 h");
  assert.equal(texto(23 * 60 + 59), "Vence en 23 h 59 min", "23:59 no se redondea a un día");
  assert.equal(texto(59), "Vence en 59 min", "59 minutos no se anuncian como 1 h");
  assert.equal(texto(0.5), "Vence en menos de 1 min");
  assert.deepEqual(nucleo.tiempoRestanteQR(enMinutos(-3), AHORA), { vencido: true, texto: "Venció" });
  assert.deepEqual(nucleo.tiempoRestanteQR(null, AHORA), { vencido: false, texto: "No vence" });
});

test("Postgres intervals from PostgREST become days", () => {
  assert.equal(nucleo.duracionEnDiasQR("7 days"), 7);
  assert.equal(nucleo.duracionEnDiasQR("1 day"), 1);
  assert.equal(nucleo.duracionEnDiasQR("1 day 12:00:00"), 1.5);
  assert.equal(nucleo.duracionEnDiasQR("168:00:00"), 7);
  assert.equal(nucleo.duracionEnDiasQR(null), null);
  assert.equal(nucleo.duracionEnDiasQR("mañana"), null);
});

/* Cupo: tiene que contar igual que qr_motivo_rechazo() en 0044. */

test("five active QRs fill the free plan; an expired one frees its slot", () => {
  const activos = Array.from({ length: 5 }, () => ({ vence_en: enMinutos(60) }));
  const lleno = nucleo.cupoQR({ planes: PLANES, acceso: null, qrs: activos, ahora: AHORA });
  assert.equal(lleno.puedeCrear, false);
  assert.equal(lleno.motivo, "limite_alcanzado");
  assert.equal(nucleo.textoCupoQR(lleno), "5 de 5 QR activos · cada QR dura 7 días");

  const conVencido = [...activos.slice(1), { vence_en: enMinutos(-1) }];
  const libre = nucleo.cupoQR({ planes: PLANES, acceso: null, qrs: conVencido, ahora: AHORA });
  assert.equal(libre.puedeCrear, true, "el vencido ya no cuenta (decisión del 2026-09-28)");
  assert.equal(libre.vigentes, 4);
});

test("a blocked QR still takes its slot until it expires, like in the database", () => {
  const qrs = [
    ...Array.from({ length: 4 }, () => ({ vence_en: enMinutos(60) })),
    { vence_en: enMinutos(60), bloqueado_en: enMinutos(-10) },
  ];
  assert.equal(nucleo.cupoQR({ planes: PLANES, acceso: null, qrs, ahora: AHORA }).puedeCrear, false);
});

test("unlimited access and blocked accounts override the plan", () => {
  const muchos = Array.from({ length: 9 }, () => ({ vence_en: null }));
  const ilimitado = nucleo.cupoQR({ planes: PLANES, acceso: { ilimitado: true }, qrs: muchos, ahora: AHORA });
  assert.equal(ilimitado.puedeCrear, true);
  assert.equal(nucleo.textoCupoQR(ilimitado), "Acceso ilimitado: tus QR no vencen.");

  const bloqueada = nucleo.cupoQR({ planes: PLANES, acceso: { bloqueado: true, ilimitado: true }, qrs: [], ahora: AHORA });
  assert.equal(bloqueada.puedeCrear, false, "el bloqueo gana incluso a ilimitado");
  assert.equal(bloqueada.motivo, "cuenta_bloqueada");
});

test("the plan in force is the person's if active, otherwise free", () => {
  const planes = [...PLANES, { clave: "pro", limite: null, duracion: null, activo: false }];
  assert.equal(nucleo.planVigenteQR(planes, { plan: "pro" }).clave, "free", "un plan apagado no rige");
  planes[1].activo = true;
  assert.equal(nucleo.planVigenteQR(planes, { plan: "pro" }).clave, "pro");
  assert.equal(nucleo.planVigenteQR(planes, null).clave, "free");
});

/* Formulario y mensajes. */

test("the form catches what is visible at a glance, and nothing more", () => {
  assert.deepEqual(nucleo.validarFormularioQR({ destino: "  " }), { ok: false, codigo: "enlace_vacio" });
  assert.deepEqual(nucleo.validarFormularioQR({ destino: "forms.gle/abc" }), { ok: false, codigo: "enlace_invalido" });
  assert.deepEqual(nucleo.validarFormularioQR({ destino: "http://x.mx" }), { ok: false, codigo: "enlace_no_https" });
  assert.deepEqual(nucleo.validarFormularioQR({ destino: "https://x.mx", titulo: "x".repeat(81) }), { ok: false, codigo: "titulo_largo" });
  assert.deepEqual(nucleo.validarFormularioQR({ destino: "https://bit.ly/x" }), { ok: true },
    "las reglas finas son del servidor: el acortador lo rechaza crear-qr");
});

test("every rejection code the server can send has a message in Spanish", () => {
  /*
    Los códigos se leen del código fuente del servidor, no de una lista a mano:
    si alguien agrega una regla en revisarEnlace.mjs o un rechazo en crear-qr
    sin su mensaje, la persona vería el genérico y no sabría qué corregir.
  */
  const reglas = read("supabase/functions/_shared/revisarEnlace.mjs");
  const funcion = read("supabase/functions/crear-qr/index.ts");
  const deReglas = [...reglas.matchAll(/rechazo\("([a-z_]+)"/g)].map((m) => m[1]);
  const deFuncion = [
    ...[...funcion.matchAll(/\[\d{3}, "([a-z_]+)"\]/g)].map((m) => m[1]),
    ...[...funcion.matchAll(/falla\(\d{3}, "([a-z_]+)"/g)].map((m) => m[1]),
    ...[...funcion.matchAll(/new ClientError\(\d{3}, "([a-z_]+)"\)/g)].map((m) => m[1]),
  ];
  // Fallas del servidor o del transporte: no hay nada que la persona pueda
  // corregir, y el mensaje genérico ("intenta de nuevo") es el correcto.
  const genericos = new Set(["invalid_origin", "method_not_allowed", "internal_error", "no_disponible"]);

  assert.ok(deReglas.length >= 14, `se esperaban las reglas de revisarEnlace, hay ${deReglas.length}`);
  for (const codigo of new Set([...deReglas, ...deFuncion])) {
    if (genericos.has(codigo)) continue;
    assert.ok(nucleo.MENSAJES_ERROR_QR[codigo], `falta el mensaje de "${codigo}"`);
  }
  assert.ok(nucleo.MENSAJES_ERROR_QR.enlace_peligroso, "el rechazo de Web Risk (en crear-qr) también");
});

test("messages fill in the imitated brand, and unknown codes fall back to a generic one", () => {
  assert.match(nucleo.mensajeErrorQR("enlace_suplantacion", "BBVA"), /hacerse pasar por BBVA/);
  assert.match(nucleo.mensajeErrorQR("enlace_suplantacion"), /una marca conocida/);
  assert.equal(nucleo.mensajeErrorQR("codigo_que_no_existe"), nucleo.MENSAJE_ERROR_QR_GENERICO);
});

/* El dibujo. */

test("the badge is odd-sized, centered, and small enough for level H to recover", () => {
  for (const n of [21, 25, 29, 33, 37, 41]) {
    const lado = nucleo.ladoInsigniaQR(n);
    assert.equal(lado % 2, 1, `n=${n}: la insignia debe ser impar`);
    assert.ok(Number.isInteger((n - lado) / 2), `n=${n}: la insignia cae en la cuadrícula`);
    // H recupera ~30% de los datos; con la insignia (un disco) bajo el 15% del
    // área queda la mitad de ese margen para manchas, pliegues y mala luz.
    assert.ok(Math.PI * (lado / 2) ** 2 <= n * n * 0.15, `n=${n}: la insignia no pasa del 15% del área`);
  }
  assert.equal(nucleo.ladoInsigniaQR(33), 11, "el tamaño que se midió con jsQR y ZXing el 2026-09-28");
});

test("alignment patterns follow the standard table and never sit on an eye", () => {
  assert.deepEqual(nucleo.alineacionesQR(21), [], "la versión 1 no tiene");
  assert.deepEqual(nucleo.alineacionesQR(33), [[26, 26]], "la versión 4 (la de go.taudux.com) tiene una");
  const v7 = nucleo.alineacionesQR(45);
  assert.equal(v7.length, 6, "la versión 7 tiene 3×3 menos las 3 de los ojos");
  assert.ok(!v7.some(([f, c]) => (f === 6 && c === 6) || (f === 6 && c === 38) || (f === 38 && c === 6)));
});

// Centros de los puntos, leídos del trazo: cada círculo empieza en "M{cx-r} {cy}".
function centrosDePuntos(trazo) {
  return [...trazo.matchAll(/M([\d.]+) ([\d.]+)a/g)]
    .map(([, x, y]) => [Number(x) + nucleo.QR_RADIO_PUNTO, Number(y)]);
}

test("no dot is drawn over the eyes, the alignment pattern or the badge", () => {
  /*
    Lo que el lector busca para orientarse va como anillo, nunca con puntos:
    con la alineación en puntos, jsQR no leyó el QR en 7 de 7 condiciones
    (medido el 2026-09-28).
  */
  const n = 33;
  const m = nucleo.QR_MARGEN;
  const { modulos } = nucleo.trazosQR(n, () => true);
  const centros = centrosDePuntos(modulos);
  const g = nucleo.geometriaQR(n);
  let esperados = 0;
  for (let f = 0; f < n; f++) for (let c = 0; c < n; c++) if (!g.reservado(f, c)) esperados++;
  assert.equal(centros.length, esperados, "un punto por cada celda oscura no reservada");

  const dentro = (x, y, f0, c0, lado) =>
    x > c0 + m && x < c0 + m + lado && y > f0 + m && y < f0 + m + lado;
  for (const [x, y] of centros) {
    assert.ok(!dentro(x, y, 0, 0, 7) && !dentro(x, y, 0, n - 7, 7) && !dentro(x, y, n - 7, 0, 7), `punto en un ojo: ${x},${y}`);
    assert.ok(!dentro(x, y, 24, 24, 5), `punto en la alineación: ${x},${y}`);
    assert.ok(Math.hypot(x - g.insignia.cx, y - g.insignia.cy) >= g.insignia.radio + 0.35, `punto bajo la insignia: ${x},${y}`);
  }
  assert.ok(esperados > n * n * 0.7, "lo reservado es poco: el resto del código se dibuja");
});

test("the eyes and the alignment pattern are rounded rings, filled even-odd", () => {
  const t = nucleo.trazosQR(33, () => true);
  assert.equal((t.ojos.match(/M/g) || []).length, 9, "3 ojos × (exterior, hueco, centro)");
  assert.equal((t.alineacion.match(/M/g) || []).length, 3, "1 patrón × (exterior, hueco, centro)");
  // El ojo de arriba a la izquierda arranca en el margen, con el radio medido.
  assert.match(t.ojos, /^M6\.2 4h2\.6a2\.2 2\.2/, "ojo 7×7 desde (4,4) con esquinas de 2.2");
  // La alineación de la versión 4 (centro 26,26) empieza 2 módulos antes, más el margen.
  assert.match(t.alineacion, /^M29\.4 28h2\.2a1\.4 1\.4/, "alineación 5×5 desde (28,28) con esquinas de 1.4");
  const svg = nucleo.svgQR({ n: 33, esOscuro: () => true });
  assert.match(svg, new RegExp(`<path fill="${nucleo.QR_AZUL}" fill-rule="evenodd" d="M6\\.2 4h`));
  assert.match(svg, new RegExp(`<path fill="${nucleo.QR_TINTA}" fill-rule="evenodd" d="M29\\.4 28h`));
});

test("the SVG is self-contained: vector isotype in brand colors, escaped label", () => {
  const svg = nucleo.svgQR({
    n: 21,
    esOscuro: (fila, col) => (fila + col) % 2 === 0,
    etiqueta: 'QR de <go.taudux.com/k3m9xa>"><script>',
  });
  assert.match(svg, /viewBox="0 0 29 29"/, "21 módulos + 4 de margen por lado");
  assert.match(svg, /<path fill="#fff" d="M2\.6 0h/, "la tarjeta blanca con esquinas redondeadas");
  const colores = [...svg.matchAll(/<polygon fill="(#[0-9a-f]+)"/g)].map((m) => m[1]);
  assert.deepEqual(colores, ["#1249a4", "#29c2e2", "#1249a4", "#29c2e2"], "el isotipo en sus dos tonos");
  assert.match(svg, new RegExp(`stroke="${nucleo.QR_BORDE_INSIGNIA}"`), "la insignia blanca con borde fino");
  assert.doesNotMatch(svg, /<image|href=|<script|url\(#/, "nada que cargar ni ids que choquen entre tarjetas");
  assert.match(svg, /aria-label="QR de &lt;go\.taudux\.com\/k3m9xa&gt;&quot;&gt;&lt;script&gt;"/);
});

test("the short link is what goes inside the QR", () => {
  assert.equal(nucleo.urlCortaQR("k3m9xa"), "https://go.taudux.com/k3m9xa");
  assert.equal(nucleo.urlVisibleQR("k3m9xa"), "go.taudux.com/k3m9xa");
});

test("the generator page draws the site's starfield behind everything, after its library", () => {
  const html = fs.readFileSync(path.join(ROOT, "src/app/features/qr/index.html"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "src/app/features/qr/qr.css"), "utf8");
  const posicion = (src) => {
    const indice = html.indexOf(`<script src="${src}"></script>`);
    assert.notEqual(indice, -1, `falta el script ${src}`);
    return indice;
  };
  assert.ok(posicion("https://cdn.jsdelivr.net/npm/tsparticles-engine@2/tsparticles.engine.min.js")
    < posicion("https://cdn.jsdelivr.net/npm/tsparticles@2/tsparticles.bundle.min.js"));
  assert.ok(posicion("https://cdn.jsdelivr.net/npm/tsparticles@2/tsparticles.bundle.min.js")
    < posicion("/app/features/qr/qr.fondo.js"), "tsParticles va antes del fondo que lo usa");
  assert.match(html, /<body>\s*(<!--[\s\S]*?-->\s*)?<div id="particles-fondo" aria-hidden="true"><\/div>/,
    "el lienzo va primero en el body y los lectores de pantalla lo ignoran");
  const regla = /#particles-fondo \{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(regla, /position: fixed/);
  assert.match(regla, /z-index: var\(--z-behind\)/);
  assert.match(regla, /pointer-events: none/);
  assert.doesNotMatch(/\.qr \{([^}]*)\}/.exec(css)?.[1] ?? "", /background/,
    "un fondo propio en .qr taparía las estrellas");
});
