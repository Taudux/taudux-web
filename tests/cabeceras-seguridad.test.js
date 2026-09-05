/* Las cabeceras de seguridad que sirve Vercel (hallazgo F20).
 *
 * Por qué existe este test. El sitio no mandaba NINGUNA cabecera de hardening:
 * sin `Content-Security-Policy`, sin `X-Frame-Options`, sin `nosniff` y sin
 * `Referrer-Policy`. Ninguna de las cuatro impide ver un PDF ajeno —eso lo
 * gobierna la RLS— pero el CSP sí frena el vector con el que se roba un token
 * de sesión: el XSS.
 *
 * **Y eso pasó a importar el 2026-08-23**, cuando se decidió que la sesión iba
 * a ser persistente. Mientras el token vivía en `sessionStorage` moría al
 * cerrar la pestaña; en `localStorage` sobrevive, así que quien se lo lleve lo
 * usa indefinidamente. El CSP es lo que abarata ese riesgo, y es gratis.
 *
 * Lo que este archivo blinda no es "que exista una cabecera": es que el
 * `script-src` siga siendo ESTRICTO. Un CSP con `'unsafe-inline'` en scripts
 * es una cabecera que tranquiliza sin proteger, y ése es el estado al que
 * tiende cualquier política cuando algo se rompe y se arregla con prisa.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const leer = (relativo) => fs.readFileSync(path.join(ROOT, relativo), "utf8");

const CONFIG = JSON.parse(leer("vercel.json"));

/* La regla que gobierna a la aplicación, y la del deck de AFGI.
 *
 * Vercel aplica TODAS las reglas que coinciden y, para una misma cabecera,
 * gana la ÚLTIMA: reemplaza el valor entero, no lo mezcla. El orden es parte
 * del contrato: una regla por ruta va DESPUÉS de la general, o la general la
 * pisa (medido en producción el 2026-09-05).
 */
const reglas = () => CONFIG.headers || [];
const reglaDe = (fuente) => reglas().find((r) => r.source === fuente);

const valorDe = (regla, nombre) =>
  (regla?.headers || []).find((h) => h.key.toLowerCase() === nombre.toLowerCase())?.value;

const RUTA_APP = "/(.*)";
/* `:path*` cubre `/afgi` y `/afgi/`: producción sirve las dos formas con 200
 * y sin redirect, así que las dos necesitan la política del deck. */
const RUTA_AFGI = "/afgi/:path*";

const cspApp = () => valorDe(reglaDe(RUTA_APP), "Content-Security-Policy") || "";

/* Una directiva suelta del CSP, como texto.
 *
 * Se busca por su nombre al principio de la directiva y no en cualquier lado:
 * `script-src` aparece dentro de la palabra `img-src`… no, pero `font-src` sí
 * es sufijo de nada y `default-src` contiene `src`. Partir por `;` evita que
 * un host de una directiva se cuente como si estuviera en otra — que es
 * justamente el error que haría pasar un test sin que la política sirva.
 */
function directiva(nombre) {
  const partes = cspApp().split(";").map((p) => p.trim());
  const encontrada = partes.find((p) => p === nombre || p.startsWith(`${nombre} `));
  return encontrada || "";
}

test("vercel.json sirve cabeceras de seguridad — F20", () => {
  assert.ok(Array.isArray(CONFIG.headers),
    "vercel.json debe tener un bloque `headers`");
  assert.ok(reglaDe(RUTA_APP),
    `debe haber una regla para toda la aplicación (${RUTA_APP})`);
});

test("script-src is strict — no 'unsafe-inline', no 'unsafe-eval'", () => {
  /*
    **El aserto que hace que todo este trabajo signifique algo.**

    Se puede: el repo no tiene UN solo handler `onclick=` ni un `eval()` en los
    18 HTML —todo va por `addEventListener`—, así que la política estricta no
    le cuesta nada al sitio. El día que alguien agregue un script inline y
    "arregle" el CSP relajándolo, este test lo frena.
  */
  const script = directiva("script-src");

  assert.ok(script, "falta la directiva script-src");
  assert.doesNotMatch(script, /'unsafe-inline'/,
    "un script-src con 'unsafe-inline' no frena el XSS: es una cabecera que tranquiliza sin proteger");
  /*
    El aserto va ANCLADO, y la diferencia importa: `'wasm-unsafe-eval'`
    contiene `'unsafe-eval'` como substring, así que un regex suelto los
    confunde y prohíbe los dos.

    No son lo mismo. `'unsafe-eval'` abre `eval()` y `new Function()` sobre
    cadenas —el agujero que este test existe para cerrar—; `'wasm-unsafe-eval'`
    sólo habilita compilar WebAssembly, que es lo que Chromium exige para que
    arranquen los intérpretes de Python, SQL y R del entorno de código.

    Con el anclaje, permitir WASM es una decisión explícita y lo peligroso
    sigue prohibido. Sin él, la única forma de habilitar WASM sería borrar este
    aserto entero.
  */
  assert.doesNotMatch(script, /(^|\s)'unsafe-eval'/,
    "no hay eval() en el repo, así que no hay excusa para permitirlo");
});

test("every external script host from the inventory is allowed", () => {
  /*
    Los dos únicos hosts que sirven JavaScript. `googletagmanager` no aparece
    en ningún HTML: lo inyecta `ga4.js:26` en runtime, y por eso es el que se
    olvida.
  */
  const script = directiva("script-src");

  assert.match(script, /'self'/, "los scripts propios primero");
  ["https://cdn.jsdelivr.net", "https://www.googletagmanager.com"].forEach((host) => {
    assert.ok(script.includes(host), `falta ${host} en script-src`);
  });
});

test("style-src allows inline styles, and that is deliberate", () => {
  /*
    `extractor.js` y `admin.js` inyectan `style="..."` dentro de `innerHTML`
    —el ancho de las barras del mapa, el `--peso` de las franjas horarias— y
    sin esto el panel se rompe.

    Un estilo NO ejecuta código; un script sí. Por eso la excepción vive acá y
    no en `script-src`, donde sería justamente rendirse.
  */
  const estilo = directiva("style-src");

  assert.match(estilo, /'unsafe-inline'/,
    "los estilos inyectados por innerHTML lo necesitan");
  assert.ok(estilo.includes("https://fonts.googleapis.com"),
    "las 17 páginas cargan la hoja de Google Fonts");
});

test("font-src covers where Google Fonts actually serves the files from", () => {
  // El `<link>` apunta a googleapis, pero los `@font-face` bajan de gstatic:
  // permitir sólo el primero deja el texto sin tipografía y sin error obvio.
  assert.ok(directiva("font-src").includes("https://fonts.gstatic.com"),
    "falta fonts.gstatic.com: el CSS de Google baja las fuentes de ahí");
});

test("connect-src covers GA4's beacons — the silent failure of the inventory", () => {
  /*
    **Ninguno de estos tres hosts está escrito en el repo**: los pone `gtag.js`
    en runtime. Omitirlos no rompe ninguna pantalla y no deja error visible —
    simplemente GA4 deja de reportar, y nadie se entera hasta que alguien mira
    los informes y los ve vacíos.

    Es el fallo más traicionero del inventario, y por eso tiene test propio.
  */
  const conectar = directiva("connect-src");

  [
    "https://www.google-analytics.com",
    "https://analytics.google.com",
    "https://region1.google-analytics.com",
  ].forEach((host) => {
    assert.ok(conectar.includes(host),
      `falta ${host}: GA4 quedaría mudo sin dar error`);
  });
});

test("connect-src covers Supabase and Cloud Run — the two backends", () => {
  const conectar = directiva("connect-src");

  assert.ok(conectar.includes("https://yqkvgfqplmbbcebrivpt.supabase.co"),
    "sin esto no hay auth, ni base, ni storage, ni edge functions");
  assert.ok(conectar.includes("run.app"),
    "sin esto el extractor no puede procesar un solo PDF");
});

test("img-src is limited to Supabase Storage, plus data: and blob:", () => {
  /*
    Decisión tomada: las portadas salen de Supabase Storage. `esUrlSegura()`
    (`cursos.service.js:10-17`) acepta cualquier http/https, así que una
    portada cargada a mano a otro host no se pintaría — cae en el fallback que
    ya existe (`cursos.js:114`). Se ve feo; no se rompe.

    `data:` lo necesita el deck y `blob:` el recortador de portadas
    (`course-cover-cropper.js:115`).
  */
  const imagen = directiva("img-src");

  assert.ok(imagen.includes("data:"), "el deck usa PNG en base64");
  assert.ok(imagen.includes("blob:"), "el recortador de portadas usa createObjectURL");
  assert.ok(imagen.includes("https://yqkvgfqplmbbcebrivpt.supabase.co"),
    "las portadas de curso viven en Storage");
  assert.doesNotMatch(imagen, /(^|\s)https:(\s|;|$)/,
    "`https:` a secas aceptaría imágenes de cualquier host, que es lo que se decidió NO hacer");
});

test("form-action allows FormSubmit, the only external form target", () => {
  // `src/index.html:178`. El JS lo manda por `fetch` (`home.js:240`), así que
  // esta directiva sólo actúa si el JS no cargó — que es justo cuando importa.
  assert.ok(directiva("form-action").includes("https://formsubmit.co"),
    "el formulario de contacto quedaría inerte sin JavaScript");
});

test("the three lockdown directives are set to none", () => {
  /*
    No hay iframes, ni `<base>`, ni `<object>` en todo el repo. Cerrarlos no le
    cuesta nada al sitio hoy, y evita que un XSS los use mañana: `base-uri`
    sobre todo, porque una `<base>` inyectada redirige TODAS las rutas
    relativas de la página a un host ajeno.
  */
  [
    ["frame-ancestors", "clickjacking"],
    ["base-uri", "una <base> inyectada secuestra todas las rutas relativas"],
    ["object-src", "plugins heredados"],
  ].forEach(([nombre, porque]) => {
    assert.match(directiva(nombre), /'none'/, `${nombre} debe ser 'none' — ${porque}`);
  });
});

test("the other three hardening headers are served", () => {
  const regla = reglaDe(RUTA_APP);

  assert.equal(valorDe(regla, "X-Content-Type-Options"), "nosniff");
  assert.equal(valorDe(regla, "X-Frame-Options"), "DENY");
  // `strict-origin-when-cross-origin` importa por F21: hay páginas que pueden
  // llevar un token en la URL, y sin esto esa URL entera viaja como Referer.
  assert.equal(valorDe(regla, "Referrer-Policy"),
               "strict-origin-when-cross-origin");
});

test("the /afgi rule comes AFTER the general one — order is the contract", () => {
  /*
    Vercel aplica TODAS las reglas que coinciden y, para una misma cabecera,
    gana la ÚLTIMA. Medido en producción el 2026-09-05: con `/afgi/(.*)` antes
    que `/(.*)`, `curl -sI https://taudux.com/afgi/` devolvía la CSP general
    y Chrome bloqueaba el `<script>` inline del deck (`afgi/index.html:1748`):
    las flechas no hacían nada. La doc de Vercel no documenta la precedencia de
    `headers`; la medición es la autoridad.
  */
  const orden = reglas().map((r) => r.source);
  const iAfgi = orden.indexOf(RUTA_AFGI);
  const iApp = orden.indexOf(RUTA_APP);

  assert.notEqual(iAfgi, -1, `falta la regla de ${RUTA_AFGI}`);
  assert.ok(iAfgi > iApp,
    "la regla de /afgi debe ir DESPUÉS de la general, o la general la pisa");
});

test("no page outside /afgi introduces inline scripts or on* handlers", () => {
  /*
    **El guard que sostiene el `script-src` estricto.**

    Hoy es cierto: cero handlers inline y un solo `<script>` sin `src` en todo
    el repo, el del deck. Ese hecho es lo que permite la política estricta — si
    alguien agrega un `onclick=` mañana, la página se rompe en producción y el
    arreglo tentador es relajar el CSP.

    Este test hace que se rompa acá primero, que es mucho más barato.
  */
  const paginas = [];
  const recorrer = (dir) => {
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
      const completo = path.join(dir, entrada.name);
      if (entrada.isDirectory()) {
        if (entrada.name !== "afgi") recorrer(completo);
      } else if (entrada.name.endsWith(".html")) {
        paginas.push(completo);
      }
    }
  };
  recorrer(path.join(ROOT, "src"));

  assert.ok(paginas.length >= 15, "el barrido debe encontrar las páginas reales");

  for (const pagina of paginas) {
    const html = fs.readFileSync(pagina, "utf8").replace(/<!--[\s\S]*?-->/g, "");
    const relativo = path.relative(ROOT, pagina);

    assert.doesNotMatch(
      html,
      /<\w+[^>]*\son(?:click|load|error|change|submit|input|focus|blur|mouseover|keyup|keydown)\s*=/i,
      `${relativo} trae un handler inline: rompe el script-src estricto`
    );

    // Un `<script>` sin `src=` antes del `>` de apertura es un script inline.
    assert.doesNotMatch(
      html,
      /<script(?![^>]*\ssrc=)[^>]*>/i,
      `${relativo} trae un <script> inline: rompe el script-src estricto`
    );
  }
});

test("workers may come from a blob, scripts may not", () => {
  /*
    webR —el intérprete de R del entorno de código— crea su worker desde una
    URL `blob:` que fabrica en memoria. Sin `worker-src`, el navegador cae a
    `script-src` como respaldo, ahí no hay `blob:`, y R no arranca. Medido en
    el preview del PR #3 el 2026-09-02: *"Creating a worker from 'blob:…'
    violates the following Content Security Policy directive"*. Python y SQL sí
    arrancaban, porque sus workers son archivos propios del sitio.

    Se abre `worker-src` y NO `script-src`, y la diferencia es la que importa:
    permitir `blob:` en `script-src` dejaría ejecutar CUALQUIER script fabricado
    en memoria —el vector clásico para convertir un XSS en ejecución de código—
    mientras que acotarlo a workers da exactamente lo que webR necesita y nada
    más.

    El aserto va en las dos direcciones a propósito: el día que algo se rompa y
    alguien lo "arregle" metiendo `blob:` en la directiva ancha, este test lo
    frena.
  */
  const worker = directiva("worker-src");

  assert.ok(worker, "falta worker-src: sin ella el navegador cae a script-src y webR no arranca");
  assert.match(worker, /blob:/,
    "webR fabrica su worker en memoria: sin blob: el entorno de R no carga");

  assert.doesNotMatch(directiva("script-src"), /blob:/,
    "blob: en script-src permitiría ejecutar cualquier script fabricado en memoria; el permiso va acotado a worker-src");
});
