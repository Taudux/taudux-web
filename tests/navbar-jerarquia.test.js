const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

class Element {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.className = "";
    this.classList = { add: (...names) => { this.className += ` ${names.join(" ")}`; } };
    this._textContent = "";
  }

  get textContent() {
    if (this.children.length === 0) return this._textContent;
    return this.children.map((child) => child.textContent).join("");
  }

  set textContent(value) { this._textContent = value; }

  append(...children) { this.children.push(...children); children.forEach((child) => { child.parent = this; }); }
  appendChild(child) { this.append(child); return child; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, listener) { this.listeners[type] = listener; }
}

function cargarNavbar() {
  const context = {
    window: { addEventListener() {}, scrollY: 0 },
    document: {
      addEventListener() {},
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementById: () => null,
      createElement: (tagName) => new Element(tagName),
    },
    queueMicrotask,
  };
  vm.runInNewContext(
    `${read("src/app/shared/navbar/navbar.js")}
    this.crearItemMenu = crearItemMenu;
    this.crearAcordeonMenu = crearAcordeonMenu;
    this.filtrarEnlacesPorRol = filtrarEnlacesPorRol;
    this.ENLACES_NAVEGACION_BASE = ENLACES_NAVEGACION_BASE;`,
    context
  );
  return context;
}

/* ENLACES_NAVEGACION_BASE: Academy/Tools son cabeceras de grupo puras. */

test("Academy and Tools carry hijos but no href/habilitado of their own: they are pure group headers", () => {
  const { ENLACES_NAVEGACION_BASE } = cargarNavbar();

  ["Academy", "Tools"].forEach((texto) => {
    const grupo = ENLACES_NAVEGACION_BASE.find((enlace) => enlace.texto === texto);
    assert.ok(grupo, `falta la entrada ${texto}`);
    assert.ok(Array.isArray(grupo.hijos) && grupo.hijos.length > 0, `${texto} debe tener hijos`);
    assert.equal(grupo.href, undefined, `${texto} no debe tener href propio`);
    assert.equal(grupo.habilitado, undefined, `${texto} no debe tener habilitado propio`);
  });
});

test("'Transacciones financieras' under Tools is enabled for everyone and has its own route", () => {
  const { ENLACES_NAVEGACION_BASE } = cargarNavbar();

  const tools = ENLACES_NAVEGACION_BASE.find((enlace) => enlace.texto === "Tools");
  const hijo = tools.hijos.find((hijo) => hijo.texto === "Transacciones financieras");

  assert.equal(hijo.habilitado, true);
  assert.equal(hijo.soloAdmin, undefined, "no debe esconderse: es para todos");
  assert.equal(hijo.href, "/app/features/transactions/");
  assert.doesNotMatch(hijo.href, /detector/, "ya no comparte ruta con el detector de IA");
});

/* Visibilidad por rol. El detector de IA volvió a su identidad y queda como
   sección deshabilitada que sólo el admin ve; el resto ni se entera. */

test("the AI detector is admin-only and disabled", () => {
  const { ENLACES_NAVEGACION_BASE } = cargarNavbar();

  const tools = ENLACES_NAVEGACION_BASE.find((enlace) => enlace.texto === "Tools");
  const detector = tools.hijos.find((hijo) => /detector/i.test(hijo.texto));

  assert.ok(detector, "falta la entrada del detector bajo Tools");
  assert.equal(detector.soloAdmin, true);
  assert.equal(detector.habilitado, false);
  assert.equal(detector.href, "/app/features/detector/detector.html");
});

test("filtrarEnlacesPorRol drops soloAdmin entries for non-admins and keeps them for admins", () => {
  const { filtrarEnlacesPorRol } = cargarNavbar();
  const enlaces = [
    { texto: "Público", href: "/publico", habilitado: true },
    { texto: "Secreto", href: "/secreto", habilitado: false, soloAdmin: true },
  ];

  const paraCualquiera = filtrarEnlacesPorRol(enlaces, false).map((e) => e.texto);
  const paraAdmin = filtrarEnlacesPorRol(enlaces, true).map((e) => e.texto);

  assert.deepEqual(paraCualquiera, ["Público"]);
  assert.deepEqual(paraAdmin, ["Público", "Secreto"]);
});

test("filtrarEnlacesPorRol reaches inside groups, not just the top level", () => {
  const { filtrarEnlacesPorRol } = cargarNavbar();
  const enlaces = [
    {
      texto: "Tools",
      hijos: [
        { texto: "Abierto", href: "/abierto", habilitado: true },
        { texto: "Interno", href: "/interno", habilitado: false, soloAdmin: true },
      ],
    },
  ];

  const [grupo] = filtrarEnlacesPorRol(enlaces, false);

  assert.deepEqual(grupo.hijos.map((h) => h.texto), ["Abierto"]);
});

test("filtrarEnlacesPorRol drops a group left with no children", () => {
  // Una cabecera vacía es peor que ninguna: se despliega y no ofrece nada.
  const { filtrarEnlacesPorRol } = cargarNavbar();
  const enlaces = [
    { texto: "Tools", hijos: [{ texto: "Interno", href: "/i", soloAdmin: true }] },
  ];

  assert.deepEqual(filtrarEnlacesPorRol(enlaces, false), []);
});

/* Visibilidad ante buscadores. Ninguna de las dos páginas de Tools debe
   ofrecerse: el detector es sólo para admin y transactions va a recibir estados
   de cuenta bancarios. */

test("neither Tools page is offered to search engines", () => {
  const paginas = {
    "src/app/features/detector/detector.html": "detector",
    "src/app/features/transactions/index.html": "transactions",
  };

  // Estar fuera del sitemap no impide indexar: no listar algo no le pide a
  // nadie que lo ignore. El noindex es lo que de verdad lo evita.
  Object.keys(paginas).forEach((archivo) => {
    assert.match(
      read(archivo),
      /<meta\s+name="robots"\s+content="noindex">/,
      `${archivo} debe llevar noindex`
    );
  });

  // Sólo las <loc>: el sitemap tiene un comentario que nombra ambas rutas para
  // explicar por qué no están, y eso no debe contar como que estén.
  const ubicaciones = read("src/sitemap.xml").match(/<loc>[^<]*<\/loc>/g) || [];
  Object.values(paginas).forEach((ruta) => {
    assert.ok(
      ubicaciones.every((loc) => !loc.includes(ruta)),
      `/${ruta}/ no debe publicarse en el sitemap`
    );
  });
});

test("the navbar resolves the profile once and reuses it for both role and name", () => {
  /*
    obtenerPerfil() no cachea: cada llamada es una consulta a Supabase. El menú
    necesita el rol (para filtrar) y el nombre, y el navbar se monta en TODAS las
    páginas — pedirlos por separado duplicaría el tráfico en todo el sitio.
  */
  const fuente = read("src/app/shared/navbar/navbar.js");

  // `await` a propósito: sin él, el conteo incluye las menciones en comentarios.
  const llamadas = fuente.match(/await obtenerPerfil\(/g) || [];
  assert.equal(llamadas.length, 1, "el perfil debe pedirse una sola vez");
  assert.match(
    fuente,
    /nombreParaMenu\(\s*session\s*,\s*perfil\s*\)/,
    "el nombre debe derivarse del perfil ya resuelto, no pedirlo de nuevo"
  );
});

test("filtrarEnlacesPorRol does not mutate the shared base array", () => {
  // ENLACES_NAVEGACION_BASE es un módulo compartido: filtrarlo en una página no
  // puede dejar el menú recortado para la siguiente.
  const { filtrarEnlacesPorRol, ENLACES_NAVEGACION_BASE } = cargarNavbar();
  const tools = ENLACES_NAVEGACION_BASE.find((e) => e.texto === "Tools");
  const hijosAntes = tools.hijos.length;

  filtrarEnlacesPorRol(ENLACES_NAVEGACION_BASE, false);

  assert.equal(tools.hijos.length, hijosAntes, "el filtro debe devolver copias");
});

/* crearAcordeonMenu: estructura del grupo colapsable Academy/Tools. */

test("an item with hijos renders as a <button> toggle inside a .nav-menu__accordion container, closed by default", () => {
  const { crearAcordeonMenu, ENLACES_NAVEGACION_BASE } = cargarNavbar();
  const academy = ENLACES_NAVEGACION_BASE.find((enlace) => enlace.texto === "Academy");

  const nodo = crearAcordeonMenu(academy, { registroDeCierres: [], prefijoId: "testPanel" });

  assert.match(nodo.className, /\bnav-menu__accordion\b/);

  const toggle = nodo.children.find((hijo) => hijo.tagName === "BUTTON");
  assert.ok(toggle, "debe existir un <button> toggle (nunca un <a>)");
  assert.equal(toggle.attributes["aria-expanded"], "false", "el acordeón arranca siempre cerrado");
  assert.equal(toggle.textContent, "Academy");
  assert.match(toggle.className, /\bnav-menu__accordion-toggle\b/);
  assert.match(toggle.className, /\bfloating-menu__link\b/, "hereda el padding/hover del resto del menú");
});

test("the toggle is a <button>, never an <a>: it must not trip the close-on-anchor listener", () => {
  const { crearAcordeonMenu, ENLACES_NAVEGACION_BASE } = cargarNavbar();
  const tools = ENLACES_NAVEGACION_BASE.find((enlace) => enlace.texto === "Tools");

  const nodo = crearAcordeonMenu(tools, { registroDeCierres: [], prefijoId: "testPanel" });
  const toggle = nodo.children.find((hijo) => hijo.tagName === "BUTTON");

  assert.notEqual(toggle.tagName, "A");
});

test("children render inside the accordion panel with the indentation class", () => {
  const { crearAcordeonMenu, ENLACES_NAVEGACION_BASE } = cargarNavbar();
  const academy = ENLACES_NAVEGACION_BASE.find((enlace) => enlace.texto === "Academy");

  const nodo = crearAcordeonMenu(academy, { registroDeCierres: [], prefijoId: "testPanel" });
  const panel = nodo.children.find((hijo) => hijo.className.includes("nav-menu__accordion-panel"));
  assert.ok(panel, "debe existir el panel colapsable");

  const panelInterior = panel.children[0];
  const textos = panelInterior.children.map((hijo) => hijo.textContent);
  assert.deepEqual(textos, ["Cursos", "Notas", "Código"]);

  panelInterior.children.forEach((hijo) => {
    assert.match(hijo.className, /\bnav-menu__link--child\b/, `${hijo.textContent} debe tener la clase de indentación`);
  });
});

test("the toggle's aria-controls matches the panel's id", () => {
  const { crearAcordeonMenu, ENLACES_NAVEGACION_BASE } = cargarNavbar();
  const academy = ENLACES_NAVEGACION_BASE.find((enlace) => enlace.texto === "Academy");

  const nodo = crearAcordeonMenu(academy, { registroDeCierres: [], prefijoId: "menuCuentaLista" });
  const toggle = nodo.children.find((hijo) => hijo.tagName === "BUTTON");
  const panel = nodo.children.find((hijo) => hijo.className.includes("nav-menu__accordion-panel"));

  assert.equal(toggle.attributes["aria-controls"], panel.id);
});

test("the same group texto produces different panel ids under different prefijoId, so mobile and desktop never collide", () => {
  const { crearAcordeonMenu, ENLACES_NAVEGACION_BASE } = cargarNavbar();
  const academy = ENLACES_NAVEGACION_BASE.find((enlace) => enlace.texto === "Academy");

  const nodoMobile = crearAcordeonMenu(academy, { registroDeCierres: [], prefijoId: "menuNavegacionLista" });
  const nodoCuenta = crearAcordeonMenu(academy, { registroDeCierres: [], prefijoId: "menuCuentaLista" });

  const panelMobile = nodoMobile.children.find((hijo) => hijo.className.includes("nav-menu__accordion-panel"));
  const panelCuenta = nodoCuenta.children.find((hijo) => hijo.className.includes("nav-menu__accordion-panel"));

  assert.notEqual(panelMobile.id, panelCuenta.id);
});

/* crearItemMenu: indentación (camino de las hojas, sin hijos). */

test("a disabled item renders a plain <span aria-disabled=\"true\">, no badge", () => {
  const { crearItemMenu } = cargarNavbar();

  const item = crearItemMenu({ texto: "Notas", habilitado: false });

  assert.equal(item.tagName, "SPAN");
  assert.equal(item.attributes["aria-disabled"], "true");
  assert.match(item.className, /\bnav-menu__link--disabled\b/);
  assert.equal(item.textContent, "Notas");
  assert.equal(item.children.length, 0, "sin badge, el texto va directo, sin spans hijos");
});

test("an enabled item renders a plain <a>", () => {
  const { crearItemMenu } = cargarNavbar();

  const item = crearItemMenu({ texto: "Cursos", href: "/app/features/courses/cursos.html", habilitado: true });

  assert.equal(item.tagName, "A");
  assert.match(item.className, /\bfloating-menu__link\b/);
  assert.equal(item.textContent, "Cursos");
});

test("a child item (esHijo: true) carries the indentation class, enabled or disabled", () => {
  const { crearItemMenu } = cargarNavbar();

  const hijoHabilitado = crearItemMenu({
    texto: "Cursos",
    href: "/app/features/courses/cursos.html",
    habilitado: true,
    esHijo: true,
  });
  assert.match(hijoHabilitado.className, /\bnav-menu__link--child\b/);

  const hijoDeshabilitado = crearItemMenu({ texto: "Notas", habilitado: false, esHijo: true });
  assert.match(hijoDeshabilitado.className, /\bnav-menu__link--child\b/);
});

test("a top-level item (esHijo not set) never carries the indentation class", () => {
  const { crearItemMenu } = cargarNavbar();

  const item = crearItemMenu({ texto: "Mi cuenta", href: "/app/features/portal/", habilitado: true });
  assert.doesNotMatch(item.className, /nav-menu__link--child/);
});

/*
  Regresión: una entrada de nivel superior sin `hijos` (ej. "Mi cuenta",
  "Noticias") tiene que seguir produciendo una hoja simple vía crearItemMenu,
  el mismo camino de siempre — el nuevo render condicional (if enlace.hijos
  ... else crearItemMenu) no debe tocar este caso.
*/
test("an entry without hijos still renders a plain leaf via crearItemMenu, the old path is unaffected", () => {
  const { crearItemMenu, ENLACES_NAVEGACION_BASE } = cargarNavbar();

  const miCuenta = ENLACES_NAVEGACION_BASE.find((enlace) => enlace.texto === "Mi cuenta");
  assert.equal(miCuenta.hijos, undefined);
  const nodoCuenta = crearItemMenu(miCuenta);
  assert.equal(nodoCuenta.tagName, "A");
  assert.equal(nodoCuenta.textContent, "Mi cuenta");

  const noticias = ENLACES_NAVEGACION_BASE.find((enlace) => enlace.texto === "Noticias");
  assert.equal(noticias.hijos, undefined);
  const nodoNoticias = crearItemMenu(noticias);
  assert.equal(nodoNoticias.tagName, "SPAN");
});

/*
  El navbar tiene un solo dueño: `src/app/shared/navbar/`.

  Estos tres tests no existían, y por eso el 2026-08-20 se descubrió que
  `features/transactions/` llevaba meses montando su propio menú de cuenta
  encima del compartido. Los dos usaban el mismo id —`#menuCuentaLista`—, así
  que el del extractor lo reescribía con `innerHTML` y se llevaba puestos los
  listeners del navbar. El síntoma se veía cosmético (el correo en vez del
  nombre, sin las flechas de los acordeones); el daño real era que **el "Salir"
  de esa página no cerraba la sesión**, porque el handler bueno moría con el
  reemplazo.

  Los tests de arriba no podían atraparlo: cargan `navbar.js` en un DOM de
  juguete y verifican lo que ese archivo hace bien. El problema estaba en quién
  le pasaba por encima después, en el navegador. Esto se comprueba leyendo los
  fuentes, que es barato y suficiente.
*/

function archivosDeFeatures(extension) {
  const raiz = path.join(ROOT, "src/app/features");
  const encontrados = [];
  const recorrer = (directorio) => {
    fs.readdirSync(directorio, { withFileTypes: true }).forEach((entrada) => {
      const completa = path.join(directorio, entrada.name);
      if (entrada.isDirectory()) recorrer(completa);
      else if (entrada.name.endsWith(extension)) encontrados.push(completa);
    });
  };
  recorrer(raiz);
  return encontrados;
}

test("no feature stylesheet redefines the shared navbar", () => {
  const hojas = archivosDeFeatures(".css");
  assert.ok(hojas.length > 0, "no se encontró ninguna hoja en features/");

  hojas.forEach((ruta) => {
    const contenido = fs.readFileSync(ruta, "utf8");
    // Sólo selectores en posición de regla: una mención dentro de un comentario
    // —como las notas que explican por qué esto ya no está— es legítima.
    const selectores = contenido.match(/^\s*\.(navbar|nav-menu)[\w-]*[^\n]*\{/gm) || [];
    assert.deepEqual(
      selectores, [],
      `${path.relative(ROOT, ruta)} redefine el navbar; esos selectores son de ` +
      `shared/navbar/navbar.css. Vive en @layer features y le gana al compartido ` +
      `(@layer components) sin importar la especificidad.`
    );
  });
});

test("no feature script writes over the navbar's own menu", () => {
  const guiones = archivosDeFeatures(".js");
  assert.ok(guiones.length > 0, "no se encontró ningún script en features/");

  // El id lo crea navbar.js (crearDesplegable, idLista: "menuCuentaLista"). Que
  // otro archivo lo NOMBRE en prosa es legítimo —explicar por qué algo ya no
  // está tiene valor—; lo que no puede es USARLO.
  //
  // Se buscan comillas simples o dobles, no backticks: en este repositorio los
  // comentarios usan backticks como marca de código al citar un identificador,
  // así que incluirlos convertiría cada explicación en un falso positivo. Un
  // template literal para un id fijo no es idiomático acá; si algún día lo
  // fuera, este test hay que endurecerlo.
  const citado = /['"]#?menuCuentaLista['"]/;
  guiones.forEach((ruta) => {
    const contenido = fs.readFileSync(ruta, "utf8");
    assert.ok(
      !citado.test(contenido),
      `${path.relative(ROOT, ruta)} toca #menuCuentaLista, que es del navbar ` +
      `compartido. Si hace falta cambiar el menú, se cambia en shared/navbar/.`
    );
  });
});

test("the admin panel is reachable from every page, not just its own", () => {
  const { ENLACES_NAVEGACION_BASE, filtrarEnlacesPorRol } = cargarNavbar();

  // Aplanar y buscar son dos pasos: mezclarlos hace que la recursión devuelva
  // el resultado de `find` —posiblemente undefined— donde `flatMap` espera un
  // array.
  const aplanar = (enlaces) =>
    enlaces.flatMap((enlace) => (enlace.hijos ? aplanar(enlace.hijos) : [enlace]));
  const buscar = (enlaces) =>
    aplanar(enlaces).find((enlace) => /administraci/i.test(enlace.texto || ""));

  const panel = buscar(ENLACES_NAVEGACION_BASE);
  assert.ok(
    panel,
    "el panel de administración debe vivir en el navbar compartido: mientras " +
    "estuvo dentro de features/transactions/, un admin parado en Cursos no " +
    "tenía cómo llegar a él desde el menú"
  );
  // Con la extensión, como cursos.html y detector.html. Sin ella la URL sólo la
  // resuelve `cleanUrls` de Vercel: abría en el deploy y daba 404 en local.
  assert.equal(panel.href, "/app/features/transactions/admin.html");
  assert.equal(panel.habilitado, true);

  // Es cosmética, no control de acceso: el candado son los endpoints
  // /api/admin/*. Pero anunciarle el panel a quien no es admin sólo confunde.
  assert.equal(panel.soloAdmin, true);
  assert.ok(
    !buscar(filtrarEnlacesPorRol(ENLACES_NAVEGACION_BASE, false)),
    "quien no es admin no debe ver la entrada"
  );
  assert.ok(
    buscar(filtrarEnlacesPorRol(ENLACES_NAVEGACION_BASE, true)),
    "quien es admin sí debe verla"
  );
});

test("the admin panel leads the site links, above 'Mi cuenta'", () => {
  /*
    Antes iba al último. El argumento de entonces —"no es una herramienta más,
    y a dos clics dentro de Tools un admin no lo encontraría"— defendía que
    estuviera en **primer nivel**, no que estuviera al final; y quien lo usa lo
    usa seguido, así que recorrer el menú entero cada vez no se justifica.

    Se fija el orden porque nada más lo sujeta: `ENLACES_NAVEGACION_BASE` es un
    array literal y mover una entrada no rompe nada por sí solo.

    Ojo con el alcance: esto fija el orden del **array**, que no es el orden de
    lo que se ve. El array se renderiza en dos puntos y los dos le anteponen
    algo —las anclas de la página en la hamburguesa, el nombre del usuario en
    el desplegable de cuenta—. Ese orden visual vive en el DOM y lo verifica el
    navegador, no esta suite.
  */
  const { ENLACES_NAVEGACION_BASE, filtrarEnlacesPorRol } = cargarNavbar();

  assert.match(
    ENLACES_NAVEGACION_BASE[0].texto || "", /administraci/i,
    "el panel de administración encabeza los enlaces del sitio"
  );

  // Y para quien no es admin la entrada desaparece, así que el primer enlace
  // del grupo vuelve a ser "Mi cuenta": no queda un hueco donde estaba.
  assert.equal(
    filtrarEnlacesPorRol(ENLACES_NAVEGACION_BASE, false)[0].texto,
    "Mi cuenta",
    "sin el panel, los enlaces arrancan en 'Mi cuenta'"
  );
});

test("every page that mounts the navbar loads the stylesheets it needs", () => {
  /*
    `navbar.js` marca la lista y sus enlaces con clases de dos hojas distintas:
    `nav-menu__*` de navbar.css y `floating-menu*` de floating-menu.css (ver
    crearDesplegable y crearEnlaceMenu). Cargar una sin la otra deja el menú a
    medio vestir.

    Y no es sólo estético: el `display: none` de partida lo pone `.floating-menu`,
    así que sin esa hoja el panel **nace abierto**, tapando el contenido. Le pasó
    a admin.html, la única de las once páginas a la que se le olvidó el link.
  */
  const paginas = [];
  const recorrer = (directorio) => {
    fs.readdirSync(directorio, { withFileTypes: true }).forEach((entrada) => {
      const completa = path.join(directorio, entrada.name);
      if (entrada.isDirectory()) recorrer(completa);
      else if (entrada.name.endsWith(".html")) paginas.push(completa);
    });
  };
  recorrer(path.join(ROOT, "src"));

  const montanElNavbar = paginas.filter((ruta) =>
    fs.readFileSync(ruta, "utf8").includes("shared/navbar/navbar.js")
  );
  assert.ok(montanElNavbar.length > 5, "se esperaban varias páginas con navbar");

  montanElNavbar.forEach((ruta) => {
    const contenido = fs.readFileSync(ruta, "utf8");
    const relativa = path.relative(ROOT, ruta);
    assert.ok(
      contenido.includes("shared/navbar/navbar.css"),
      `${relativa} monta el navbar pero no carga navbar.css`
    );
    assert.ok(
      contenido.includes("shared/floating-menu/floating-menu.css"),
      `${relativa} monta el navbar pero no carga floating-menu.css: el menú ` +
      `nacería abierto y sin estilos, porque el display:none lo pone .floating-menu`
    );
  });
});
