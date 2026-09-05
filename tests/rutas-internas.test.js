/* Las rutas internas de cada página apuntan a archivos que existen.
 *
 * Por qué existe este test. Un `<link>` a un CSS inexistente **no falla**: el
 * navegador pide, recibe 404 y sigue. La página se pinta sin esos estilos y
 * queda ilegible, pero nada avisa. Un `href` a una página que no está tampoco
 * avisa: el botón funciona, navega, y aterriza en un 404.
 *
 * Los dos pasaron el mismo día (2026-08-19) en el panel del extractor: cargaba
 * `courses/courses.css`, que no existe —los reales son `cursos.css` y
 * `gestionar-cursos.css`—, y su botón del menú apuntaba a `/admin`, la ruta del
 * backend Flask que se había quitado. La suite estaba verde con ambos.
 *
 * `openspec/verificar.py` hace justo esta comprobación, pero sólo dentro de
 * `openspec/`. Esto es su equivalente para `src/`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const RAIZ_WEB = path.join(ROOT, "src");

/** Todos los archivos con una extensión dada bajo src/, recursivo. */
function archivos(extension, directorio = RAIZ_WEB) {
  return fs.readdirSync(directorio, { withFileTypes: true }).flatMap((entrada) => {
    const completo = path.join(directorio, entrada.name);
    if (entrada.isDirectory()) return archivos(extension, completo);
    return entrada.name.endsWith(extension) ? [completo] : [];
  });
}

/** Todas las páginas HTML bajo src/, recursivo. */
const paginas = () => archivos(".html");

/** Un directorio no es un recurso: lo sirve su index.html, o no lo sirve nadie. */
const esArchivo = (p) => fs.existsSync(p) && fs.statSync(p).isFile();

/*
  ¿Hay un archivo servible detrás de esta ruta interna?

  Dos exigencias, y las dos salieron de un 404 real:

  1. **No se acepta `ruta + ".html"`.** Una URL sin extensión la resuelve
     `cleanUrls` de `vercel.json`, y eso existe **sólo en Vercel**: el enlace
     anda publicado y devuelve 404 en Live Server, que es como se prueba el
     sitio en local. Ya pasó — el "Panel de administración" del navbar apuntaba
     a "/app/features/transactions/admin" y por eso sólo abría en el deploy.

  2. **La ruta literal tiene que ser un archivo, no una carpeta.** `existsSync`
     dice `true` para un directorio, así que un enlace a una carpeta *sin*
     `index.html` pasaba el test y daba 404 servido. Medido el 2026-08-20:
     `taudux.com/app/features/courses` → **404**, y la carpeta existe.
*/
function resuelve(ruta) {
  const literal = path.join(RAIZ_WEB, ruta);
  return ruta.endsWith("/")
    ? esArchivo(path.join(literal, "index.html"))
    : esArchivo(literal) || esArchivo(path.join(literal, "index.html"));
}

/*
  Rutas absolutas del propio sitio: las que empiezan con "/" y no son externas
  ni anclas. `vercel.json` fija `outputDirectory: "src"`, así que "/x" es
  "src/x" — por eso el prefijo `/src/` nunca debe aparecer en una URL.
*/
function rutasInternas(html) {
  return [...html.matchAll(/(?:href|src)="(\/[^"#?]*)"/g)]
    .map((m) => m[1])
    .filter((ruta) => !ruta.startsWith("//"));
}

test("every internal href and src points to a file that exists", () => {
  const rotas = [];

  paginas().forEach((pagina) => {
    const html = fs.readFileSync(pagina, "utf8");
    rutasInternas(html).forEach((ruta) => {
      // Las rutas de directorio ("/app/features/transactions/") las resuelve el
      // servidor con su index.html. Las páginas se enlazan con su extensión.
      if (!resuelve(ruta)) {
        rotas.push(`${path.relative(ROOT, pagina)} → ${ruta}`);
      }
    });
  });

  assert.deepEqual(
    rotas, [],
    `Hay rutas internas que no existen:\n  ${rotas.join("\n  ")}`
  );
});

test("links built from JavaScript also point somewhere real", () => {
  /*
    El HTML no es el único que enlaza. `extractor.js` armaba su menú en
    JavaScript, y ahí vivía el segundo error del 2026-08-19: `href: "/admin"`,
    la ruta del Flask del simulador, que en este sitio no existe.

    El escaneo cubre **todo `src/`**, no una carpeta. Cuando miraba sólo
    `app/features/transactions/`, el menú se mudó a `app/shared/navbar/` (F28) y
    se llevó sus enlaces fuera del alcance del test: así fue como sobrevivió el
    href sin extensión del panel de administración.

    Se buscan sólo los `href: "…"` —el patrón con el que se construyen enlaces—
    y no cualquier cadena que empiece con "/": las rutas de la API (`/api/…`)
    son de otro servicio y no tienen archivo que respalde.
  */
  const rotas = [];
  archivos(".js").forEach((absoluto) => {
    const relativo = path.relative(RAIZ_WEB, absoluto);
    const js = fs.readFileSync(absoluto, "utf8");

    [...js.matchAll(/href:\s*"(\/[^"#?]*)"/g)]
      .map((m) => m[1])
      .filter((ruta) => !ruta.startsWith("/api/"))
      .forEach((ruta) => {
        if (!resuelve(ruta)) {
          rotas.push(`${relativo} → ${ruta}`);
        }
      });
  });

  assert.deepEqual(rotas, [], `Enlaces rotos en JavaScript:\n  ${rotas.join("\n  ")}`);
});

test("no internal URL carries the /src/ prefix", () => {
  // `vercel.json` sirve `src/` como raíz web, así que "/src/..." sería una ruta
  // duplicada. Existe un redirect 301 para los enlaces viejos ya indexados,
  // pero un 301 el navegador lo cachea indefinidamente: no es forma de escribir
  // rutas nuevas.
  const conPrefijo = paginas().flatMap((pagina) =>
    rutasInternas(fs.readFileSync(pagina, "utf8"))
      .filter((ruta) => ruta.startsWith("/src/"))
      .map((ruta) => `${path.relative(ROOT, pagina)} → ${ruta}`));

  assert.deepEqual(conPrefijo, [], `Rutas con /src/:\n  ${conPrefijo.join("\n  ")}`);
});
