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

/** Todas las páginas HTML bajo src/, recursivo. */
function paginas(directorio = RAIZ_WEB) {
  return fs.readdirSync(directorio, { withFileTypes: true }).flatMap((entrada) => {
    const completo = path.join(directorio, entrada.name);
    if (entrada.isDirectory()) return paginas(completo);
    return entrada.name.endsWith(".html") ? [completo] : [];
  });
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
      // servidor con su index.html; las páginas sin extensión, cleanUrls.
      const candidatos = ruta.endsWith("/")
        ? [path.join(RAIZ_WEB, ruta, "index.html")]
        : [path.join(RAIZ_WEB, ruta),
           path.join(RAIZ_WEB, `${ruta}.html`),
           path.join(RAIZ_WEB, ruta, "index.html")];

      if (!candidatos.some((c) => fs.existsSync(c))) {
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
    El HTML no es el único que enlaza. `extractor.js` arma su menú en
    JavaScript, y ahí vivía el segundo error del 2026-08-19: `href: "/admin"`,
    la ruta del Flask del simulador, que en este sitio no existe.

    Se buscan sólo los `href: "…"` —el patrón con el que se construyen enlaces—
    y no cualquier cadena que empiece con "/": las rutas de la API (`/api/…`)
    son de otro servicio y no tienen archivo que respalde.
  */
  const scripts = fs.readdirSync(path.join(RAIZ_WEB, "app/features/transactions"))
    .filter((n) => n.endsWith(".js"));

  const rotas = [];
  scripts.forEach((nombre) => {
    const relativo = path.join("app/features/transactions", nombre);
    const js = fs.readFileSync(path.join(RAIZ_WEB, relativo), "utf8");

    [...js.matchAll(/href:\s*"(\/[^"#?]*)"/g)]
      .map((m) => m[1])
      .filter((ruta) => !ruta.startsWith("/api/"))
      .forEach((ruta) => {
        const candidatos = [path.join(RAIZ_WEB, ruta),
                            path.join(RAIZ_WEB, `${ruta}.html`),
                            path.join(RAIZ_WEB, ruta, "index.html")];
        if (!candidatos.some((c) => fs.existsSync(c))) {
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
