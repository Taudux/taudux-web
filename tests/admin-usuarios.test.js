const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (relativo) => fs.readFileSync(path.join(ROOT, relativo), "utf8");

const nucleo = require(path.join(ROOT, "src/app/features/admin/usuarios.nucleo.js"));

const PAGINA = "src/app/features/admin/usuarios.html";
const SCRIPT = "src/app/features/admin/usuarios.js";

/*
  Usuarios (2026-10-01): la gráfica de registros y la lista de cuentas. La
  lógica pura vive en usuarios.nucleo.js y se prueba directo; lo demás se fija
  leyendo el código, como el resto de las pruebas de Administración.

  Las fechas se arman en hora local y a mediodía: los periodos se calculan con
  el reloj del equipo, y mediodía queda lejos de cualquier borde de día.
*/
const local = (anio, mes, dia) => new Date(anio, mes - 1, dia, 12).toISOString();
const alta = (anio, mes, dia) => ({ tipo: "alta_confirmada", ocurrido_en: local(anio, mes, dia) });
const baja = (anio, mes, dia) => ({ tipo: "baja_cuenta", ocurrido_en: local(anio, mes, dia) });
const HOY = new Date(2026, 9, 1, 15); // 1 oct 2026 (jueves)

test("registrosPorPeriodo counts sign-ups and removals per month, with empty periods in between", () => {
  const eventos = [alta(2026, 7, 20), alta(2026, 9, 3), alta(2026, 9, 4), baja(2026, 9, 5)];
  const meses = nucleo.registrosPorPeriodo(eventos, 10, "mes", HOY);
  assert.deepEqual(meses.map((p) => p.etiqueta), ["jul 2026", "ago 2026", "sep 2026", "oct 2026"]);
  assert.deepEqual(meses.map((p) => [p.altas, p.bajas]), [[1, 0], [0, 0], [2, 1], [0, 0]]);
});

test("the line is computed backwards and ends on today's live count", () => {
  const eventos = [alta(2026, 7, 20), alta(2026, 9, 3), alta(2026, 9, 4), baja(2026, 9, 5)];
  const meses = nucleo.registrosPorPeriodo(eventos, 10, "mes", HOY);
  // total(oct) = 10; sep: 10 - 0 + 0; ago: 10 - 2 + 1 = 9; jul: 9 - 0 + 0.
  assert.deepEqual(meses.map((p) => p.total), [9, 9, 10, 10]);
  assert.equal(meses.at(-1).total, 10);
});

test("the current period shows up even when it has no events, and no events means one period", () => {
  const sin = nucleo.registrosPorPeriodo([], 26, "mes", HOY);
  assert.equal(sin.length, 1);
  assert.deepEqual([sin[0].etiqueta, sin[0].altas, sin[0].bajas, sin[0].total], ["oct 2026", 0, 0, 26]);
});

test("weeks run Monday to Sunday and are labelled by their Monday", () => {
  // 1 oct 2026 es jueves: su semana arranca el lunes 28 sep.
  const semanas = nucleo.registrosPorPeriodo([alta(2026, 9, 21), alta(2026, 9, 27), alta(2026, 9, 28)], 3, "semana", HOY);
  assert.deepEqual(semanas.map((p) => p.etiqueta), ["21 sep", "28 sep"]);
  assert.deepEqual(semanas.map((p) => p.altas), [2, 1], "el domingo 27 cuenta en la semana del 21");
});

test("quarters and years group the same events", () => {
  const eventos = [alta(2025, 12, 31), alta(2026, 1, 1), alta(2026, 7, 1), alta(2026, 9, 30), baja(2026, 8, 1)];
  const trimestres = nucleo.registrosPorPeriodo(eventos, 4, "trimestre", HOY);
  assert.deepEqual(trimestres.map((p) => p.etiqueta), ["T4 2025", "T1 2026", "T2 2026", "T3 2026", "T4 2026"]);
  assert.deepEqual(trimestres.map((p) => [p.altas, p.bajas]), [[1, 0], [1, 0], [0, 0], [2, 1], [0, 0]]);
  const anios = nucleo.registrosPorPeriodo(eventos, 4, "anio", HOY);
  // total(2026) = 4; total(2025) = 4 - 3 + 1 = 2.
  assert.deepEqual(anios.map((p) => [p.etiqueta, p.altas, p.bajas, p.total]), [["2025", 1, 0, 2], ["2026", 3, 1, 4]]);
});

test("registrosPorPeriodo ignores events of another type and unknown levels throw", () => {
  const ruido = [{ tipo: "otra_cosa", ocurrido_en: local(2026, 1, 1) }, alta(2026, 10, 1)];
  const meses = nucleo.registrosPorPeriodo(ruido, 1, "mes", HOY);
  assert.deepEqual(meses.map((p) => p.etiqueta), ["oct 2026"]);
  assert.throws(() => nucleo.registrosPorPeriodo([], 1, "siglo", HOY));
});

test("detallePeriodo names each period and words the tooltip and its aria-label", () => {
  const [, , sep] = nucleo.registrosPorPeriodo([alta(2026, 7, 20), alta(2026, 9, 3), alta(2026, 9, 4), baja(2026, 9, 5)], 10, "mes", HOY);
  const detalle = nucleo.detallePeriodo(sep, "mes");
  assert.equal(detalle.titulo, "Septiembre de 2026");
  assert.deepEqual([detalle.nuevas, detalle.eliminadas, detalle.balance, detalle.cierre], ["+2", "−1", "+1", "10"]);
  assert.equal(detalle.aria, "Septiembre de 2026: 2 nuevas, 1 eliminadas, balance +1, 10 al cierre");

  const [semana] = nucleo.registrosPorPeriodo([alta(2026, 9, 29)], 5, "semana", HOY);
  assert.equal(nucleo.detallePeriodo(semana, "semana").titulo, "Semana del 28 sep");
  const [trimestre] = nucleo.registrosPorPeriodo([], 5, "trimestre", HOY);
  assert.equal(nucleo.detallePeriodo(trimestre, "trimestre").titulo, "T4 2026");
  const [anio] = nucleo.registrosPorPeriodo([], 5, "anio", HOY);
  assert.equal(nucleo.detallePeriodo(anio, "anio").titulo, "2026");
  assert.equal(nucleo.detallePeriodo({ ...anio, altas: 0, bajas: 2 }, "anio").balance, "−2");
  assert.equal(nucleo.detallePeriodo({ ...anio, altas: 0, bajas: 0 }, "anio").balance, "0");
});

test("rangoDePaginaUsuarios splits 26 accounts into five pages of 6", () => {
  assert.equal(nucleo.FILAS_POR_PAGINA_USUARIOS, 6);
  const rango = nucleo.rangoDePaginaUsuarios;
  assert.deepEqual(rango(26, 0, 6), { pagina: 0, totalPaginas: 5, desde: 1, hasta: 6 });
  assert.deepEqual(rango(26, 4, 6), { pagina: 4, totalPaginas: 5, desde: 25, hasta: 26 });
  assert.deepEqual(rango(8, 4, 6), { pagina: 1, totalPaginas: 2, desde: 7, hasta: 8 });
  assert.deepEqual(rango(0, 0, 6), { pagina: 0, totalPaginas: 1, desde: 0, hasta: 0 });
});

test("the Usuarios page is noindex, in the admin container, with the menu and the shared bootstrap", () => {
  const html = read(PAGINA);
  assert.match(html, /<meta\s+name="robots"\s+content="noindex">/);
  assert.match(html, /class="usuarios__container u-contenedor"/);
  assert.match(html, /<div class="admin-layout" id="adminContent" hidden>/);
  assert.match(html, /<script src="\/app\/features\/courses\/admin-startup\.js"><\/script>/);
  assert.match(html, /usuarios\.nucleo\.js[\s\S]*usuarios\.js/, "el núcleo carga antes que la página");
  assert.match(html, /<h1 class="admin-cabecera__titulo">\s*Usuarios\s*<span class="usuarios__total" id="usuariosTotal">/);
  assert.match(html, /Las cuentas registradas en el sitio: cuántas entran y cuántas se\s+van en cada periodo, y quién es cada una\./);
  assert.ok(!/usuarios__tarjeta|usuarios__conteo/.test(html), "sin tarjetas de conteo");
});

test("Usuarios reads the profiles and the business events, paged by 6, total beside the title", () => {
  const js = read(SCRIPT);
  assert.match(js, /\.from\("perfiles"\)[\s\S]*?\.select\("id,nombre,apellidos,rol,creado_en,es_colaborador"\)/);
  assert.match(js, /\.order\("creado_en", \{ ascending: false \}\)/);
  assert.match(js, /\.from\("eventos_negocio"\)[\s\S]*?\.select\("tipo,ocurrido_en"\)/);
  assert.match(js, /el\("usuariosTotal"\)\.textContent = `· \$\{estado\.perfiles\.length\}`/);
  assert.match(js, /Cuentas \$\{rango\.desde\}–\$\{rango\.hasta\} de \$\{filas\.length\}/);
  assert.match(js, /fila\.hidden = /);
  assert.match(js, /<span class="admin-insignia|insignia\.className = "admin-insignia/);
});

/*
  El correo (2026-10-02): `perfiles` no lo tiene; lo trae el servidor del
  extractor, el mismo que lo muestra en «Gestión del extractor». Se pide
  después de pintar y sin await, para que un Cloud Run lento o caído no deje
  la lista ni la gráfica en blanco.

  Y la hora en Registro: con siete cuentas el mismo día, la lista parecía
  desordenada aunque va de la más reciente a la más vieja.
*/
test("Usuarios shows each account's email under the name, fetched after painting", () => {
  const html = read(PAGINA);
  assert.match(html, /transactions\/api-cliente\.js[\s\S]*admin\/usuarios\.js/,
    "api-cliente carga antes que la página");

  const js = read(SCRIPT);
  assert.match(js, /apiFetch\("\/api\/admin\/perfiles"\)/);
  assert.match(js, /usuarios__correo/);
  assert.match(js, /fila\.dataset\.uid = perfil\.id/);
  assert.match(js, /pintarLista\(\);\s*\/\/[^\n]*\n\s*cargarCorreos\(\);/, "sin await: no frena la gráfica");
  assert.match(js, /\|\| "—"/, "sin respuesta del servidor, «—»");
});

test("Usuarios marks collaborators in blue, apart from plain users and the Admin badge", () => {
  const js = read(SCRIPT);
  assert.match(js, /else if \(perfil\.es_colaborador\)[\s\S]*?"usuarios__rol-colaborador"[\s\S]*?"Colaborador"/);
  assert.match(js, /rol\.textContent = "Usuario";/);
  const css = read("src/app/features/admin/usuarios.css");
  assert.match(css, /\.usuarios__rol-colaborador\s*\{[^}]*color:\s*var\(--color-accent\)/);
});

test("Usuarios registration dates carry the time, newest first", () => {
  const js = read(SCRIPT);
  const formato = js.match(/const fechaRegistro = new Intl\.DateTimeFormat\("es-MX", \{([\s\S]*?)\}\);/)?.[1] ?? "";
  assert.match(formato, /hour: "2-digit"/);
  assert.match(formato, /minute: "2-digit"/);
  assert.match(js, /\.order\("creado_en", \{ ascending: false \}\)/);
});

test("the chart zooms with buttons only and never hijacks the mouse wheel", () => {
  const js = read(SCRIPT);
  const html = read(PAGINA);
  assert.match(html, /id="usuariosAlejar"\s+aria-label="Alejar"/);
  assert.match(html, /id="usuariosAcercar"\s+aria-label="Acercar"/);
  assert.ok(!/addEventListener\("wheel"/.test(js), "sin zoom con la rueda");
  assert.match(js, /`Registros por \$\{NOMBRES_NIVEL\[nivel\]\}`/);
  assert.match(js, /nivel: 0, \/\/ índice en NIVELES_USUARIOS/, "arranca en semana");
  assert.deepEqual([...nucleo.NIVELES_USUARIOS], ["semana", "mes", "trimestre", "anio"]);
  // Detalle por columna: foco, puntero, clic y Escape.
  assert.match(js, /tabindex: 0/);
  assert.match(js, /"focus"[\s\S]*"blur"[\s\S]*"click"/);
  assert.match(js, /evento\.key === "Escape"/);
});
