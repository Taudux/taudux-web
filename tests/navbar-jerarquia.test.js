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
    this.filtrarEnlacesVisibles = filtrarEnlacesVisibles;
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

/*
  Colaboradores es una entrada propia, no un hijo de Academy: es el equipo, no
  material de estudio. Para todos: sin sesión y sin rol.

  Cierra el menú, debajo de "Proyectos" y justo antes del divisor de "Salir"
  (decisión del 2026-09-24). Hasta entonces iba pegada a Academy para quedar
  debajo de "Código" con el grupo desplegado.
*/
test("'Colaboradores' closes the menu, right after 'Proyectos', open to everyone, with its own route", () => {
  const { ENLACES_NAVEGACION_BASE } = cargarNavbar();

  const posicion = ENLACES_NAVEGACION_BASE.findIndex((enlace) => enlace.texto === "Colaboradores");
  assert.notEqual(posicion, -1, "falta la entrada Colaboradores en el menú");

  const entrada = ENLACES_NAVEGACION_BASE[posicion];
  assert.equal(entrada.href, "/app/features/colaboradores/");
  assert.equal(entrada.habilitado, true);
  assert.equal(entrada.hijos, undefined, "es un enlace, no un grupo");
  assert.equal(entrada.soloAdmin, undefined, "no debe esconderse: es para todos");
  assert.equal(entrada.soloSesion, undefined, "no exige sesión");

  assert.equal(ENLACES_NAVEGACION_BASE[posicion - 1].texto, "Proyectos", "va justo debajo de Proyectos");
  assert.equal(posicion, ENLACES_NAVEGACION_BASE.length - 1, "es la última entrada, antes del divisor de Salir");

  // La página a la que apunta tiene que existir: un enlace del menú a un 404
  // se vería desde todas las páginas del sitio a la vez.
  assert.ok(
    fs.existsSync(path.join(ROOT, "src/app/features/colaboradores/index.html")),
    "el menú apunta a /app/features/colaboradores/ y esa página no existe",
  );
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

test("filtrarEnlacesVisibles drops soloAdmin entries for non-admins and keeps them for admins", () => {
  const { filtrarEnlacesVisibles } = cargarNavbar();
  const enlaces = [
    { texto: "Público", href: "/publico", habilitado: true },
    { texto: "Secreto", href: "/secreto", habilitado: false, soloAdmin: true },
  ];

  const paraCualquiera = filtrarEnlacesVisibles(enlaces, { esAdmin: false, haySesion: true }).map((e) => e.texto);
  const paraAdmin = filtrarEnlacesVisibles(enlaces, { esAdmin: true, haySesion: true }).map((e) => e.texto);

  assert.deepEqual(paraCualquiera, ["Público"]);
  assert.deepEqual(paraAdmin, ["Público", "Secreto"]);
});

test("filtrarEnlacesVisibles reaches inside groups, not just the top level", () => {
  const { filtrarEnlacesVisibles } = cargarNavbar();
  const enlaces = [
    {
      texto: "Tools",
      hijos: [
        { texto: "Abierto", href: "/abierto", habilitado: true },
        { texto: "Interno", href: "/interno", habilitado: false, soloAdmin: true },
      ],
    },
  ];

  const [grupo] = filtrarEnlacesVisibles(enlaces, { esAdmin: false, haySesion: true });

  assert.deepEqual(grupo.hijos.map((h) => h.texto), ["Abierto"]);
});

test("filtrarEnlacesVisibles drops a group left with no children", () => {
  // Una cabecera vacía es peor que ninguna: se despliega y no ofrece nada.
  const { filtrarEnlacesVisibles } = cargarNavbar();
  const enlaces = [
    { texto: "Tools", hijos: [{ texto: "Interno", href: "/i", soloAdmin: true }] },
  ];

  assert.deepEqual(filtrarEnlacesVisibles(enlaces, { esAdmin: false, haySesion: true }), []);
});

test("the account entry is hidden from visitors without a session", () => {
  /*
    Se veía en producción, en una ventana anónima: el panel listaba "Mi cuenta"
    y, unas líneas más abajo, "Acceder". Las dos a la vez se contradicen.

    El menú tenía un solo criterio de visibilidad, el rol; no existía la idea de
    "esto requiere sesión", así que la entrada se pintaba siempre.
  */
  const { ENLACES_NAVEGACION_BASE, filtrarEnlacesVisibles } = cargarNavbar();
  const textos = (haySesion) =>
    filtrarEnlacesVisibles(ENLACES_NAVEGACION_BASE, { esAdmin: false, haySesion })
      .map((enlace) => enlace.texto);

  assert.ok(!textos(false).includes("Mi cuenta"),
    "sin sesión no se ofrece 'Mi cuenta': 'Acceder' ya está al pie del mismo panel");
  assert.ok(textos(true).includes("Mi cuenta"),
    "con sesión 'Mi cuenta' vuelve");
});

test("nothing offered to a signed-out visitor leads to a page that demands a session", () => {
  /*
    Se fija la PROPIEDAD —no ofrecer lo que rebota al login— y no el literal de
    la entrada, así que el aserto sigue valiendo si mañana se agrega otra página
    con `requerirSesion()`. Hoy la única es el portal.

    Ojo: esto es cosmética del menú. Quien hace cumplir la sesión es
    `requerirSesion()` en la página destino, no este filtro.
  */
  const { ENLACES_NAVEGACION_BASE, filtrarEnlacesVisibles } = cargarNavbar();
  const RUTAS_QUE_EXIGEN_SESION = ["/app/features/portal/"];

  const recolectarHrefs = (enlaces) =>
    enlaces.flatMap((enlace) =>
      enlace.hijos ? recolectarHrefs(enlace.hijos) : enlace.href ? [enlace.href] : []
    );

  const hrefs = recolectarHrefs(
    filtrarEnlacesVisibles(ENLACES_NAVEGACION_BASE, { esAdmin: false, haySesion: false })
  );

  RUTAS_QUE_EXIGEN_SESION.forEach((ruta) => {
    assert.ok(!hrefs.some((href) => href.startsWith(ruta)),
      `sin sesión el menú no debe ofrecer ${ruta}: rebota al login`);
  });
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

test("the navbar is resolved by class, not by id", () => {
  /*
    montarNavegacionMovil() (:441) ya resolvía la barra con querySelector(".navbar");
    la función que calcula el estado por scroll seguía usando getElementById("navbar"),
    una contradicción dentro del mismo archivo (design.md §3.2). El id se borra
    del markup en esta fase: esta línea era su único consumidor en todo el repo.
  */
  const fuente = read("src/app/shared/navbar/navbar.js");
  assert.match(fuente, /document\.querySelector\(["']\.navbar["']\)/);
  assert.doesNotMatch(fuente, /getElementById\(["']navbar["']\)/);
});

test("filtrarEnlacesVisibles does not mutate the shared base array", () => {
  // ENLACES_NAVEGACION_BASE es un módulo compartido: filtrarlo en una página no
  // puede dejar el menú recortado para la siguiente.
  const { filtrarEnlacesVisibles, ENLACES_NAVEGACION_BASE } = cargarNavbar();
  const tools = ENLACES_NAVEGACION_BASE.find((e) => e.texto === "Tools");
  const hijosAntes = tools.hijos.length;

  filtrarEnlacesVisibles(ENLACES_NAVEGACION_BASE, { esAdmin: false, haySesion: true });

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

// Pela los bloques /* ... */ antes de buscar selectores: una mención de
// .navbar dentro de un comentario —como las notas que explican por qué algo
// ya no está— es legítima y no debe contarse como redefinición.
const sinComentariosCss = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

test("no feature stylesheet redefines the shared navbar", () => {
  const hojas = archivosDeFeatures(".css");
  assert.ok(hojas.length > 0, "no se encontró ninguna hoja en features/");

  hojas.forEach((ruta) => {
    const contenido = sinComentariosCss(fs.readFileSync(ruta, "utf8"));
    // Selector en posición de regla: la línea termina en `{`. `.navbar` o
    // `.nav-menu` se buscan en CUALQUIER posición de la línea, no sólo al
    // inicio — eso es lo que deja pasar compuestos como
    // `body:has(.entorno) .navbar::before {` (practica.css), que un selector
    // "empieza con .navbar" nunca vería.
    const selectores = contenido.match(/^.*\.(navbar|nav-menu)[\w-]*.*\{\s*$/gm) || [];
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

test("the shared menu no longer offers the admin panel; the extractor page does", () => {
  /*
    Estuvo en el menú de cuenta de todo el sitio del 2026-08-20 al 2026-09-24,
    encabezando los enlaces. Se sacó a pedido: el panel administra el
    extractor, y ahora vive en esa página como la píldora "⚙ Administración" (ver
    tests/extractor-descargas.test.js). Costo asumido: desde Cursos o el Portal
    ya no se llega por el menú.

    Se fija la ausencia para que nadie la devuelva al menú sin decidirlo: el
    array es un literal y agregar una entrada no rompe nada por sí solo.
  */
  const { ENLACES_NAVEGACION_BASE, filtrarEnlacesVisibles } = cargarNavbar();

  // Aplanar y buscar son dos pasos: mezclarlos hace que la recursión devuelva
  // el resultado de `find` —posiblemente undefined— donde `flatMap` espera un
  // array.
  const aplanar = (enlaces) =>
    enlaces.flatMap((enlace) => (enlace.hijos ? aplanar(enlace.hijos) : [enlace]));
  const lleva = (enlace) =>
    /administraci/i.test(enlace.texto || "") || /admin\.html/.test(enlace.href || "");

  assert.ok(!aplanar(ENLACES_NAVEGACION_BASE).some(lleva),
    "el menú compartido no debe ofrecer el panel de administración");

  // Ni siquiera para un admin: el primer enlace de su menú es "Mi cuenta".
  assert.equal(
    filtrarEnlacesVisibles(ENLACES_NAVEGACION_BASE, { esAdmin: true, haySesion: true })[0].texto,
    "Mi cuenta"
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
