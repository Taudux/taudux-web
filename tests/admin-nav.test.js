const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (relativo) => fs.readFileSync(path.join(ROOT, relativo), "utf8");

/*
  La sección Administración (2026-10-01): un menú a la izquierda con
  Usuarios, Extractor y QR, y el panel elegido a la derecha. Son tres páginas que
  repiten el mismo menú, así que lo que se fija acá es que no diverjan: los
  mismos enlaces, en el mismo orden, y cada página marcando la suya.
*/
const PAGINAS = [
  { archivo: "src/app/features/admin/usuarios.html", actual: "Usuarios" },
  { archivo: "src/app/features/transactions/admin.html", actual: "Extractor" },
  { archivo: "src/app/features/qr/admin.html", actual: "QR" },
];
const ENLACES = [
  ["Usuarios", "/app/features/admin/usuarios.html"],
  ["Extractor", "/app/features/transactions/admin.html"],
  ["QR", "/app/features/qr/admin.html"],
];

const sinComentarios = (html) => html.replace(/<!--[\s\S]*?-->/g, "");

function menuDe(html) {
  const nav = html.match(/<nav class="admin-nav"[^>]*>([\s\S]*?)<\/nav>/);
  assert.ok(nav, "falta el menú de Administración");
  return [...nav[1].matchAll(/<a class="admin-nav__link" href="([^"]+)"( aria-current="page")?>([^<]+)<\/a>/g)]
    .map(([, href, actual, texto]) => ({ href, actual: Boolean(actual), texto }));
}

for (const { archivo, actual } of PAGINAS) {
  test(`${archivo} carries the Administración menu with ${actual} marked`, () => {
    const html = sinComentarios(read(archivo));
    assert.match(html, /<link rel="stylesheet" href="\/app\/shared\/admin-nav\/admin-nav\.css">/);

    const enlaces = menuDe(html);
    assert.deepEqual(enlaces.map((e) => [e.texto, e.href]), ENLACES, "mismos enlaces, mismo orden");
    assert.deepEqual(enlaces.filter((e) => e.actual).map((e) => e.texto), [actual],
      "sólo la página propia lleva aria-current");

    // El menú vive dentro de #adminContent: nace oculto y lo revela el
    // arranque de admin, no se le muestra a nadie antes de saber quién es.
    const contenido = html.slice(html.indexOf('id="adminContent"'));
    assert.match(html, /<div class="admin-layout" id="adminContent" hidden>/);
    assert.ok(contenido.indexOf('<nav class="admin-nav"') !== -1, "el menú va dentro de #adminContent");
  });
}

test("the three admin pages share one header look, defined once in admin-nav.css", () => {
  // Estas páginas no cargan cursos.css, donde se vestían las clases
  // `courses__*`: sin estas reglas el título salía con el estilo por defecto
  // del navegador. Viven en admin-nav.css, no copiadas por página.
  const css = read("src/app/shared/admin-nav/admin-nav.css");
  const regla = (selector) => css.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
  assert.match(regla(".admin-cabecera__titulo"), /background:\s*var\(--gradient-heading\)/);
  assert.match(regla(".admin-cabecera__titulo"), /-webkit-text-fill-color:\s*transparent/);
  assert.match(regla(".admin-cabecera__intro"), /color:\s*var\(--color-text-muted\)/);

  assert.ok(!/\.courses__title\s*\{/.test(read("src/app/features/transactions/admin.css")),
    "el encabezado ya no se copia en admin.css");
  for (const { archivo } of PAGINAS.filter((p) => p.actual !== "QR")) {
    assert.match(read(archivo), /<h1 class="admin-cabecera__titulo">/, archivo);
  }
});

test("inside Administración the panels are flat, scoped to .admin-layout", () => {
  const css = read("src/app/shared/admin-nav/admin-nav.css");
  const bloque = css.match(/\.admin-layout \.panel\s*\{([^}]*)\}/)?.[1] ?? "";
  for (const propiedad of [/border:\s*0/, /background:\s*none/, /box-shadow:\s*none/, /backdrop-filter:\s*none/]) {
    assert.match(bloque, propiedad);
  }
  // El resto del sitio sigue con su recuadro.
  assert.match(read("src/app/shared/panel/panel.css"), /\.panel\s*\{[^}]*border:\s*var\(--border-subtle\)/);
  assert.ok(!/\n\s*\.panel\s*\{[^}]*border:\s*0/.test(css), "la regla plana va acotada");
});

test("the Admin badge is one shared pill, static, and decided by role", () => {
  const css = read("src/app/shared/admin-nav/admin-nav.css");
  const bloque = css.match(/\.admin-insignia\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(bloque, /border-radius:\s*999px/);
  assert.match(bloque, /#7befff/);
  assert.match(bloque, /text-shadow/);
  assert.ok(!/animation/.test(bloque), "sin animación");

  // Extractor: por el rol de `perfiles`; QR: por el ID de la cuenta, no por el nombre.
  assert.match(read("src/app/features/transactions/admin.js"), /esAdmin: p\.rol === "admin"/);
  assert.match(read("src/app/features/transactions/admin.js"), /<span class="admin-insignia">Admin<\/span>/);
  const qr = read("src/app/features/qr/admin.js");
  assert.match(qr, /estado\.perfiles\.get\(qr\.usuario_id\)\?\.rol === "admin"/);
  assert.match(qr, /\.select\("id,nombre,apellidos,rol"\)/);
});

test("the extractor table is flat: no frame and no tint or stripe on admin rows", () => {
  const css = read("src/app/features/transactions/admin.css");
  const base = css.match(/\.admin__tabla\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(base, /background:\s*none/);
  assert.match(base, /border:\s*0/);
  assert.ok(!/\.admin__fila--ilimitado\s+td/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")), "sin tinte ni franja");
});

test("all three admin pages carry the star background", () => {
  for (const { archivo } of PAGINAS) {
    const html = sinComentarios(read(archivo));
    assert.match(html, /<div id="particles-fondo" aria-hidden="true"><\/div>/, archivo);
    assert.match(html, /tsparticles-engine@2\/tsparticles\.engine\.min\.js/, archivo);
    assert.match(html, /tsparticles@2\/tsparticles\.bundle\.min\.js/, archivo);
    assert.match(html, /<script src="\/app\/features\/qr\/qr\.fondo\.js"><\/script>/, archivo);
  }
  const css = read("src/app/shared/admin-nav/admin-nav.css");
  assert.match(css, /#particles-fondo\s*\{[^}]*position:\s*fixed[^}]*z-index:\s*var\(--z-behind\)[^}]*pointer-events:\s*none/);
});

test("the QR table puts «Creado por» first and shows each destination in a read-only field", () => {
  const html = sinComentarios(read("src/app/features/qr/admin.html"));
  const columnas = [...html.matchAll(/<th scope="col">([^<]+)<\/th>/g)].map((m) => m[1]);
  assert.equal(columnas[0], "Creado por");
  assert.deepEqual(columnas.slice(1, 3), ["QR", "Destino"]);

  const js = read("src/app/features/qr/admin.js");
  assert.match(js, /destino\.readOnly = true/);
  assert.match(js, /nodo\("input", null, "field qr-admin__destino"\)/);
  assert.match(js, /focusin[\s\S]*\.select\(\)/);
  // El orden de las celdas sigue al de los encabezados.
  assert.match(js, /tr\.append\(\s*celda\(creador[\s\S]*?celda\(nodo\("strong", urlVisibleQR[\s\S]*?celda\(destino\)/);
  // La búsqueda lee el dato, no el nodo.
  assert.match(js, /\[qr\.codigo, qr\.titulo, qr\.destino, nombreDe\(qr\), qr\.usuario_id\]/);

  const css = read("src/app/features/qr/qr.css");
  const bloque = css.match(/\.qr-admin__destino\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(bloque, /inline-size:\s*11\.5rem/);
  assert.ok(!/text-overflow/.test(bloque));
});

test("the QR moderation table marks the expiry time so it glows red or green", () => {
  const js = read("src/app/features/qr/admin.js");
  assert.match(js, /tiempo\.dataset\.vence = qr\.vence_en \? "pronto" : "nunca"/);
  assert.match(js, /if \(!vencido\) tiempo\.dataset\.vence/, "«Venció» no lleva marca");

  const css = read("src/app/features/qr/qr.css");
  assert.match(css, /\.qr-admin__secundario\[data-vence="pronto"\]\s*\{[^}]*--color-error[^}]*\}/);
  assert.match(css, /\.qr-admin__secundario\[data-vence="nunca"\]\s*\{[^}]*--color-success[^}]*\}/);
  assert.match(css, /\[data-vence="pronto"\]\s*\{[^}]*text-shadow/);
});

test("the QR generator no longer links to moderation: it lives under Administración", () => {
  // 2026-10-02: se llega por el menú de la cuenta → Administración → QR.
  const html = sinComentarios(read("src/app/features/qr/index.html"));
  const js = read("src/app/features/qr/qr.js");
  assert.ok(!/qrModeracion/.test(html + js), "sin botón «Moderación»");
  assert.ok(!/qr\/admin\.html/.test(html), "el generador no enlaza a la moderación");
  assert.ok(!/esAdmin\(/.test(js), "ya no pregunta si quien entra es administrador");
});

test("the admin layout's display does not defeat its hidden attribute", () => {
  // `.admin-layout` declara `display: grid`, que le gana al `[hidden]`.
  assert.match(read("src/app/shared/admin-nav/admin-nav.css"), /\.admin-layout\[hidden\]\s*\{\s*display:\s*none;/);
});
