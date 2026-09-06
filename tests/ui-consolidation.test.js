const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

// La descripción de la tarjeta se arma con <strong> y nodos de texto sueltos
// (agregarTextoConNegritas), no con una asignación directa a textContent.
class TextNode {
  constructor(data) { this.data = data; }
  get textContent() { return this.data; }
}

class Element {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.className = "";
    this.classList = { add: (...names) => { this.className += ` ${names.join(" ")}`; } };
    this.hidden = false;
    this.disabled = false;
    this._textContent = "";
  }

  // Como en el DOM: leer concatena el subárbol, escribir lo reemplaza. Un
  // elemento sin hijos se comporta igual que antes de este cambio.
  get textContent() {
    if (this.children.length === 0) return this._textContent;
    return this.children.map((child) => child.textContent).join("");
  }

  set textContent(value) { this._textContent = value; }

  get childElementCount() { return this.children.length; }
  append(...children) { this.children.push(...children); children.forEach((child) => { child.parent = this; }); }
  appendChild(child) { this.append(child); return child; }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  click() { return this.listeners.click?.({ target: this }); }
  focus() { this.focused = true; }
  remove() { this.parent.children = this.parent.children.filter((child) => child !== this); }
  closest(selector) {
    let current = this.parent;
    while (current) {
      if (selector === ".courses__card" && current.className.includes("courses__card")) return current;
      current = current.parent;
    }
    return null;
  }
}

function find(root, predicate) {
  if (predicate(root)) return root;
  for (const child of root.children) {
    const match = find(child, predicate);
    if (match) return match;
  }
  return null;
}

function createCatalogHarness({ admin = false, authenticated = true, course: cursoOverride } = {}) {
  const elements = Object.fromEntries([
    "cursosLista", "adminControls", "cursosEstado", "cursosEstadoMensaje", "cursosReintentar",
  ].map((id) => [id, new Element("div")]));
  elements.adminControls.hidden = true;
  elements.cursosEstado.hidden = true;
  const calls = { sessions: 0, toasts: [], loginUrls: 0 };
  const course = cursoOverride || { id: "course/id", titulo: "Node práctico", modalidad: "remoto", costo: 0 };
  const window = {
    location: { href: "https://taudux.test/cursos.html", pathname: "/cursos.html", search: "", hash: "" },
    history: { replaceState() {} },
    confirm: () => true,
  };
  const context = {
    URL,
    console,
    window,
    document: {
      getElementById: (id) => elements[id],
      createElement: (tag) => new Element(tag),
      createTextNode: (text) => new TextNode(text),
    },
    obtenerSesion: async () => {
      calls.sessions += 1;
      return authenticated ? { user: { id: "user" } } : null;
    },
    esAdmin: async () => admin,
    listarCursos: async () => ({ ok: true, data: [course] }),
    mostrarToast: (...args) => calls.toasts.push(args),
    etiquetaModalidad: () => "En línea",
    formatearRangoFechas: () => null,
    formatearHorario: () => null,
    formatearCosto: () => "Gratis",
    esUrlSegura: () => false,
    urlLoginConDestino: () => { calls.loginUrls += 1; return "/login"; },
  };
  window.window = window;
  // agregarTextoConNegritas se ejercita de verdad, no se stubea: es lo que evita
  // que la tarjeta muestre los asteriscos crudos de una descripción con énfasis.
  // Los formateadores sí siguen stubeados, así que se reponen después de cargar
  // el módulo real, que los define.
  const formateadoresStub = {
    etiquetaModalidad: context.etiquetaModalidad,
    formatearRangoFechas: context.formatearRangoFechas,
    formatearHorario: context.formatearHorario,
    formatearCosto: context.formatearCosto,
  };
  vm.runInNewContext(read("src/app/features/courses/curso-presentacion.js"), context);
  Object.assign(context, formateadoresStub);
  vm.runInNewContext(read("src/app/core/telemetry/operaciones.js"), context);
  vm.runInNewContext(read("src/app/features/courses/cursos.js"), context);
  return { calls, course, elements, window };
}

test("catalog renders admin controls for admins only; cards never show edit/delete", async () => {
  const nonAdmin = createCatalogHarness();
  await nonAdmin.window.tauduxCursosCatalog.ready;
  assert.equal(nonAdmin.elements.adminControls.hidden, true);
  assert.equal(find(nonAdmin.elements.cursosLista, (element) => element.textContent === "Editar"), null);

  const admin = createCatalogHarness({ admin: true });
  await admin.window.tauduxCursosCatalog.ready;
  assert.equal(admin.elements.adminControls.hidden, false);
  assert.equal(find(admin.elements.cursosLista, (element) => element.textContent === "Editar"), null);
  assert.equal(find(admin.elements.cursosLista, (element) => element.textContent === "Eliminar"), null);
});

test("public course details behave identically without an authentication gate", async () => {
  const contexts = [
    createCatalogHarness({ authenticated: false }),
    createCatalogHarness({ authenticated: true }),
  ];

  for (const { calls, course, elements, window } of contexts) {
    await window.tauduxCursosCatalog.ready;
    const sessionsBeforeActivation = calls.sessions;
    const hitArea = find(elements.cursosLista, (element) => element.className === "courses__card-hit-area");

    await hitArea.click();

    assert.equal(calls.sessions, sessionsBeforeActivation);
    assert.equal(calls.loginUrls, 0);
    assert.equal(window.location.href, `/app/features/courses/detalle-curso.html?id=${encodeURIComponent(course.id)}`);
    assert.deepEqual(calls.toasts, []);
  }
});

test("a card description with **emphasis** renders a real <strong>, never the raw asterisks", async () => {
  const curso = {
    id: "da175f1c-cae5-45f9-889c-f09a17aa10ed",
    titulo: "Análisis de Datos con Python",
    descripcion: "Está diseñado para formar **analistas de datos** competentes.",
    modalidad: "en_linea",
    costo: 0,
  };
  const { elements, window } = createCatalogHarness({ course: curso });
  await window.tauduxCursosCatalog.ready;

  const desc = find(elements.cursosLista, (element) => element.className === "courses__card-description");
  assert.ok(desc, "la tarjeta debe pintar la descripción");
  assert.equal(desc.textContent, "Está diseñado para formar analistas de datos competentes.");
  assert.doesNotMatch(desc.textContent, /\*\*/, "los asteriscos son marcado, no texto para el usuario");

  const negrita = desc.children.find((child) => child.tagName === "STRONG");
  assert.ok(negrita, "el énfasis tiene que ser un <strong> real");
  assert.equal(negrita.textContent, "analistas de datos");
});

test("every course card links to its own detail page, with an honest aria-label", async () => {
  const curso = {
    id: "da175f1c-cae5-45f9-889c-f09a17aa10ed",
    titulo: "Análisis de Datos con Python",
    modalidad: "en_linea",
    costo: 300,
  };
  const { elements, window } = createCatalogHarness({ course: curso });
  await window.tauduxCursosCatalog.ready;

  const hitArea = find(elements.cursosLista, (element) => element.className === "courses__card-hit-area");
  assert.equal(hitArea.attributes["aria-label"], "Ver detalles del curso: Análisis de Datos con Python");

  await hitArea.click();

  assert.equal(window.location.href, `/app/features/courses/detalle-curso.html?id=${curso.id}`);
});

test("operation failures get one visible generic report unless an alert is already visible", async () => {
  const listeners = {};
  const messages = [];
  const context = {
    window: {
      addEventListener: (type, listener) => { listeners[type] = listener; },
      scrollY: 0,
    },
    document: {
      addEventListener() {},
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementById: () => null,
    },
    mostrarToast: (...args) => messages.push(args),
    queueMicrotask,
  };
  vm.runInNewContext(read("src/app/shared/navbar/navbar.js"), context);
  listeners["taudux:operation-error"]({ detail: { operation: "course_delete", code: "denied" } });
  await new Promise(queueMicrotask);
  assert.deepEqual(messages, [["No se pudo completar la operación. Intenta nuevamente.", "error"]]);

  context.document.querySelector = () => new Element("section");
  listeners["taudux:operation-error"]({ detail: { operation: "course_delete", code: "denied" } });
  await new Promise(queueMicrotask);
  assert.equal(messages.length, 1);
});

test("the navigation panel drops site links whose label already exists as an anchor", () => {
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
  vm.runInNewContext(`${read("src/app/shared/navbar/navbar.js")}\nthis.montarPanelNavegacion = montarPanelNavegacion;`, context);

  const lista = new Element("div");
  context.montarPanelNavegacion(lista, {
    anclas: [{ texto: "Herramientas", href: "#herramientas" }],
    enlaces: [
      { texto: "Cursos", href: "/app/features/courses/cursos.html", habilitado: true },
      { texto: "Herramientas", href: "/app/features/transactions/", habilitado: true },
    ],
  });

  const etiquetas = lista.children.map((hijo) => hijo.textContent).filter(Boolean);
  assert.deepEqual(etiquetas, ["Herramientas", "Cursos"]);
  assert.equal(etiquetas.filter((texto) => texto === "Herramientas").length, 1);
});

test("when an anchor and a site link share a label, the anchor wins and the site link is dropped", () => {
  /*
    Contrato del dedupe: ante el mismo texto gana el ancla de sección y se
    descarta el enlace de sitio, aunque apunten a destinos distintos. La
    alternativa —mostrar dos entradas con idéntico nombre y distinto
    destino— es indistinguible para quien lee el menú.

    Hoy ninguna página dispara este caso: el landing dejó de tener anclas
    cuando el navbar pasó a Misión/Visión/Valores, y ningún texto de
    ENLACES_NAVEGACION_BASE coincide con un ancla existente. El test se
    conserva porque la regla sigue viva en montarPanelNavegacion y volvería a
    aplicar apenas se agregue un ancla que choque con un enlace del sitio.
  */
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
  vm.runInNewContext(`${read("src/app/shared/navbar/navbar.js")}\nthis.montarPanelNavegacion = montarPanelNavegacion;`, context);

  const lista = new Element("div");
  context.montarPanelNavegacion(lista, {
    anclas: [{ texto: "Herramientas", href: "#herramientas" }],
    enlaces: [
      { texto: "Herramientas", href: "/app/features/transactions/", habilitado: true },
    ],
  });

  const enlaceHerramientas = lista.children.find((hijo) => hijo.textContent === "Herramientas");
  assert.equal(enlaceHerramientas.href, "#herramientas");
});

test("the navigation menu is revealed only on mobile", () => {
  const css = read("src/app/shared/navbar/navbar.css");
  /*
    .nav-menu--site se oculta en la regla base y solo se revela dentro del
    bloque de 760px: si esto se invierte, la hamburguesa aparece en desktop.
  */
  assert.match(css, /\.nav-menu--site\s*{[^}]*display:\s*none/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.nav-menu--site\s*{[^}]*display:\s*inline-block/);
});

test("mobile navigation lives only in the hamburger, and the legacy links panel is gone", () => {
  const css = read("src/app/shared/navbar/navbar.css");
  const js = read("src/app/shared/navbar/navbar.js");

  /* En desktop el grupo sigue siendo la única navegación de cursos/transacciones/privacidad. */
  assert.match(js, /nav-menu__group--nav/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.nav-menu__group--nav\s*{[^}]*display:\s*none/);
  assert.doesNotMatch(css.split(/@media\s*\(max-width:\s*760px\)/)[0], /\.nav-menu__group--nav\s*{[^}]*display:\s*none/);

  const fuente = `${css}\n${js}\n${read("src/index.html")}`;
  assert.doesNotMatch(fuente, /navbar__links--mobile-open/);
  assert.doesNotMatch(fuente, /navbar__toggle/);
  assert.doesNotMatch(css, /--z-mobile-menu|--z-mobile-toggle/);
});

test("the landing navbar shows Misión/Visión/Valores as disabled spans, not anchors", () => {
  const html = read("src/index.html");

  /*
    Sin destino todavía, así que <span aria-disabled> y no <a href="#">:
    misma convención que footer__link--pending y nav-menu__link--disabled.
    Un <a> vacío promete una navegación que no ocurre y además entraría en
    anclasDeLaPagina() / el cache de navbar__link--active.
  */
  ["Misión", "Visión", "Valores"].forEach((texto) => {
    assert.match(
      html,
      new RegExp(`<span class="navbar__principio" aria-disabled="true">${texto}</span>`),
      `${texto} debe ser un span deshabilitado`
    );
  });

  /* Las cuatro anclas viejas del navbar ya no existen. */
  ["#quienes-somos", "#servicios", "#herramientas", "#contacto"].forEach((ancla) => {
    assert.doesNotMatch(
      html,
      new RegExp(`<a href="${ancla}" class="navbar__link">`),
      `el navbar ya no debe enlazar ${ancla}`
    );
  });

  /*
    Pero la sección #contacto sigue existiendo: /#contacto es un deep-link
    vivo desde detalle-curso.html y desde el portal.
  */
  assert.match(html, /id="contacto"/);
});

test("the landing navbar principles stay hidden over the hero and appear past it", () => {
  const css = read("src/app/shared/navbar/navbar.css");
  const js = read("src/app/shared/navbar/navbar.js");

  /* Ocultos en la regla base; sólo los revela la clase de "pasé el hero". */
  assert.match(css, /\.navbar__principios\s*{[^}]*visibility:\s*hidden/);
  assert.match(css, /\.navbar--pasado-hero\s+\.navbar__principios\s*{[^}]*visibility:\s*visible/);

  /*
    El corte se calcula contra el borde inferior real del hero, no contra un
    umbral fijo en píxeles: un número hardcodeado se desincroniza apenas el
    hero cambia de alto.
  */
  assert.match(js, /navbar--pasado-hero/);
  assert.match(js, /\.hero[\s\S]{0,200}getBoundingClientRect\(\)\.bottom/);

  /*
    Ocultos con visibility y no con display:none: tienen que seguir ocupando
    su columna de la grilla para que el logo y el botón de cuenta no se muevan
    cuando aparecen.
  */
  const bloque = css.match(/\.navbar__principios\s*{[^}]*}/)[0];
  assert.doesNotMatch(bloque, /display:\s*none/);
});

test("the landing navbar principles are hidden on mobile", () => {
  const css = read("src/app/shared/navbar/navbar.css");

  /*
    Son <span> sin href, así que el selector que oculta las anclas
    (.navbar__link[href^="#"]) no las alcanza: necesitan su propia regla
    dentro del bloque de 760px, o le comerían espacio a la hamburguesa.
  */
  assert.match(
    css,
    /@media\s*\(max-width:\s*760px\)[\s\S]*?\.navbar__principios\s*{[^}]*display:\s*none/
  );
  assert.doesNotMatch(
    css.split(/@media\s*\(max-width:\s*760px\)/)[0],
    /\.navbar__principios\s*{[^}]*display:\s*none/
  );
});

test("live source contains no references to removed pages", () => {
  const source = fs.readdirSync(path.join(ROOT, "src"), { recursive: true })
    .filter((file) => /\.(?:html|js|css)$/.test(file))
    .map((file) => read(path.join("src", file)))
    .join("\n");
  assert.doesNotMatch(source, /(?:explorar|gestionar-cursos)\.html/);
  assert.equal(fs.existsSync(path.join(ROOT, "src/app/features/explore/explorar.html")), false);
  assert.equal(fs.existsSync(path.join(ROOT, "src/app/features/courses/gestionar-cursos.html")), false);
});

test("catalog cover uses the 35 percent 260px desktop target and stacks at exactly 760px", () => {
  const css = read("src/app/features/courses/cursos.css");
  assert.match(css, /grid-template-columns:\s*minmax\(260px,\s*35%\)\s+minmax\(0,\s*1fr\)/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.courses__card--catalog\s*{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /\.courses__card-media\s*{[\s\S]*?aspect-ratio:\s*4\s*\/\s*3/);
  assert.match(css, /\.courses__card-body\s*{[\s\S]*?min-width:\s*0/);
  assert.doesNotMatch(css, /@media\s*\(max-width:\s*761px\)/);
});

test("the course admin grid wires deletion through the typed confirmation dialog", () => {
  const html = read("src/app/features/courses/administrar-cursos.html");
  assert.match(html, /shared\/confirm-dialog\/confirm-dialog\.js/);
  assert.match(html, /shared\/confirm-dialog\/confirm-dialog\.css/);
  assert.match(html, /id="cursoNuevo"/);
  assert.doesNotMatch(html, /Eliminar y el sello/);

  /*
    Storage nunca se muta desde el cliente: el trigger cursos_enqueue_cover_cleanup
    encola la portada al borrar la fila, y las policies de storage.objects rechazan
    cualquier mutación desde el navegador.
  */
  const js = read("src/app/features/courses/administrar-cursos.js");
  assert.doesNotMatch(js, /portadasCurso/);
  assert.doesNotMatch(html, /portadas-curso\.service\.js/);
});

test("the admin grid keeps its track width when only one course is left", () => {
  const css = read("src/app/features/courses/cursos.css");
  /*
    auto-fit colapsaría las pistas vacías y estiraría la última tarjeta a todo el
    ancho, con una portada 4/3 de más de 600px de alto.
  */
  assert.match(css, /\.courses__list\s*{[\s\S]*?repeat\(auto-fill,/);
  assert.doesNotMatch(css, /\.courses__list\s*{[\s\S]*?repeat\(auto-fit,/);
  assert.match(css, /\.courses__empty\s*{[\s\S]*?grid-column:\s*1\s*\/\s*-1/);
});

test("the confirmation dialog ships a backdrop and a reduced-motion fallback", () => {
  const css = read("src/app/shared/confirm-dialog/confirm-dialog.css");
  assert.match(css, /\.confirm-dialog::backdrop/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);

  const catalogCss = read("src/app/features/courses/cursos.css");
  assert.match(catalogCss, /\.courses__action:disabled/);
  assert.match(catalogCss, /\.courses__action\[aria-disabled="true"\][\s\S]*?pointer-events:\s*none/);
});

test("catalog and crop controls retain focus and reduced-motion alternatives", () => {
  const catalogCss = read("src/app/features/courses/cursos.css");
  const adminCss = read("src/app/features/courses/gestionar-cursos.css");
  assert.match(catalogCss, /courses__card-hit-area:focus-visible/);
  assert.match(catalogCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*animation:\s*none/);
  assert.match(adminCss, /courses__cropper-canvas:focus-visible/);
  assert.match(adminCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test("the site width is one knob (--ancho-sitio) with a shared container utility", () => {
  const styles = read("src/styles.css");
  assert.match(styles, /--ancho-sitio:\s*1200px/);
  assert.match(styles, /\.u-contenedor\s*\{[^}]*max-inline-size:\s*var\(--ancho-sitio\)/);
});

test("--ancho-medio and --ancho-contenido derive from --ancho-sitio via calc(), not a resolved pixel value", () => {
  /*
    Si alguien "simplifica" el calc() a un número fijo, el sitio se ve
    idéntico hoy y la perilla deja de existir en silencio. Este test protege
    la derivación, no el valor resultante.
  */
  const styles = read("src/styles.css");
  assert.match(styles, /--ancho-medio:\s*calc\(\s*var\(--ancho-sitio\)/);
  assert.match(styles, /--ancho-contenido:\s*calc\(\s*var\(--ancho-sitio\)/);
});

test("--ancho-lectura stays independent of --ancho-sitio on purpose", () => {
  /*
    El límite de lectura (45-75 caracteres por línea) es función de la
    tipografía, no del ancho del sitio. Colgarlo de la misma perilla
    degradaría la prosa si el sitio creciera.
  */
  const styles = read("src/styles.css");
  const declaracion = styles.match(/--ancho-lectura:\s*([^;]+);/);
  assert.ok(declaracion, "--ancho-lectura debe estar declarada");
  assert.doesNotMatch(declaracion[1], /var\(--ancho-sitio\)/);
});

test("no page container declares a raw pixel width anymore — the utility owns it", () => {
  const cssSource = fs.readdirSync(path.join(ROOT, "src"), { recursive: true })
    .filter((file) => /\.css$/.test(file))
    .map((file) => read(path.join("src", file)))
    .join("\n");

  /*
    Cualquier selector cuyo nombre termine en __container, __panel o
    __content (los tres sufijos de contenedor de página del proyecto) no
    debe volver a declarar max-width/max-inline-size en píxeles crudos: ese
    ancho vive en .u-contenedor y sus modificadores.
  */
  assert.doesNotMatch(
    cssSource,
    /\.[\w-]*(?:__container|__panel|__content)[\w-]*\s*\{[^}]*(?:max-width|max-inline-size)\s*:\s*\d+px/,
  );
});

test("every page container carries its u-contenedor* class in the markup", () => {
  const esperados = [
    { file: "src/index.html", needle: 'class="about__content panel panel--spacious u-contenedor u-contenedor--contenido"' },
    { file: "src/index.html", needle: 'class="services__container u-contenedor"' },
    { file: "src/index.html", needle: 'class="contact__panel panel u-contenedor"' },
    { file: "src/index.html", needle: 'class="footer__container u-contenedor u-contenedor--medio"' },
    { file: "src/index.html", needle: 'class="footer__bottom u-contenedor u-contenedor--medio"' },
    { file: "src/app/features/portal/index.html", needle: 'class="portal__container u-contenedor u-contenedor--medio"' },
    { file: "src/app/features/courses/cursos.html", needle: 'class="courses__container u-contenedor u-contenedor--medio"' },
    { file: "src/app/features/courses/administrar-cursos.html", needle: 'class="courses__container u-contenedor u-contenedor--contenido"' },
    { file: "src/app/features/courses/editar-curso.html", needle: 'class="courses__container u-contenedor u-contenedor--contenido"' },
    { file: "src/app/features/courses/gestionar-categorias.html", needle: 'class="courses__container u-contenedor u-contenedor--contenido"' },
    { file: "src/app/features/legal/privacidad.html", needle: 'class="legal__container panel panel--spacious u-contenedor u-contenedor--lectura"' },
    { file: "src/app/features/courses/detalle-curso.html", needle: 'class="curso-detalle__container u-contenedor u-contenedor--lectura"' },
    { file: "src/index.html", needle: 'class="technology__carousels u-contenedor"' },
    // El hub de Código alinea con el navbar (1200), como sus páginas hijas: con
    // --medio (1080) el logo quedaba 60px afuera del eje de las tarjetas.
    { file: "src/app/features/codigo/index.html", needle: 'class="entorno__container u-contenedor"' },
  ];

  for (const { file, needle } of esperados) {
    assert.ok(read(file).includes(needle), `${file} debe tener ${needle}`);
  }

  /*
    Guarda contra la trampa que causó esto: un modificador --medio/--contenido/
    --lectura SIN la clase base .u-contenedor al lado no centra nada, porque
    solo la base declara margin-inline: auto. Es el mismo patrón que
    .panel/.panel--spacious: el modificador nunca va solo.
  */
  const htmlSource = fs.readdirSync(path.join(ROOT, "src"), { recursive: true })
    .filter((file) => /\.html$/.test(file))
    .map((file) => read(path.join("src", file)))
    .join("\n");
  const clasesSinBase = htmlSource.match(/class="[^"]*\bu-contenedor--(?:medio|contenido|lectura)\b[^"]*"/g) || [];
  for (const claseAttr of clasesSinBase) {
    assert.match(claseAttr, /\bu-contenedor\b(?!-)/, `falta la clase base junto al modificador: ${claseAttr}`);
  }
});

test("the navbar aligns with the content, but scrolling never reimposes a fixed side padding", () => {
  // Sin comentarios ANTES de buscar la regla: la prosa de navbar.css nombra
  // `.navbar--scrolled` y una captura sobre el texto crudo podría engancharla.
  const css = sinComentariosCss(read("src/app/shared/navbar/navbar.css"));

  assert.match(css, /\.navbar\s*\{[^}]*padding-inline:\s*max\(2rem,\s*calc\(\(100%\s*-\s*var\(--ancho-sitio\)\)\s*\/\s*2\)\)/);

  /*
    Con .navbar dimensionado por block-size, .navbar--scrolled deja de
    dimensionar nada: pasa a ser sólo pintura (fondo, borde). La captura
    tolera que el selector se vuelva una lista (`.navbar--scrolled,\n.navbar:not(...) {`),
    que es lo que trae la fase siguiente — de ahí el `(?:,[^{]*)?` antes de la llave.
  */
  const scrolledRule = css.match(/\.navbar--scrolled\s*(?:,[^{]*)?\{([^}]*)\}/);
  assert.ok(scrolledRule, ".navbar--scrolled debe existir");
  const cuerpo = scrolledRule[1];
  assert.doesNotMatch(cuerpo, /\bpadding\b/);
  assert.doesNotMatch(cuerpo, /\bpadding-block\b/);
  assert.doesNotMatch(cuerpo, /\bblock-size\b/);
  assert.doesNotMatch(cuerpo, /\bheight\b/);
});

test("the navbar declares its own height from the token", () => {
  /*
    El alto deja de emerger del logo y los paddings: .navbar lo declara desde
    la perilla única. block-size (no min-block-size) porque el offset de
    abajo tiene que ser exacto por construcción (design.md §2.1).
  */
  const css = read("src/app/shared/navbar/navbar.css");
  const sinComentarios = sinComentariosCss(css);

  const navbarRule = sinComentarios.match(/\.navbar\s*\{([^}]*)\}/);
  assert.ok(navbarRule, ".navbar debe existir");
  assert.match(navbarRule[1], /block-size:\s*var\(--navbar-height\)/);

  // Ni .navbar ni ninguna otra regla del archivo fija height/block-size en px.
  assert.doesNotMatch(sinComentarios, /(?<![\w-])(height|block-size):\s*\d+px/);
});

/*
  === El estado del navbar deja de estar hardcodeado ===

  Las páginas traían `navbar--scrolled` escrito a mano en el HTML (pinta en
  el primer frame, pero es un estado que debería derivarse, no declararse
  por página) y el home resolvía su propio `<nav>` por `id="navbar"`. Los
  tres tests que siguen fijan el reemplazo: reposo pintado por CSS,
  transparencia como opt-in explícito del markup (design.md §0.1, §3).
*/

const paginasHtml = () =>
  fs.readdirSync(path.join(ROOT, "src"), { recursive: true })
    .filter((archivo) => /\.html$/.test(archivo))
    .map((archivo) => archivo.split(path.sep).join("/"));

test("no page hardcodes the navbar state", () => {
  /*
    El estado por scroll lo calcula navbar.js en tiempo de carga; que una
    página lo traiga ya escrito en el HTML es exactamente el defecto que
    corrige esta fase (specs/navegacion/spec.md, "Estado Del Navbar Derivado,
    No Hardcodeado"). El id="navbar" tampoco sobrevive: navbar.js pasa a
    resolver la barra por clase.
  */
  const conEstadoHardcodeado = [];
  const conIdNavbar = [];
  for (const pagina of paginasHtml()) {
    const html = read(`src/${pagina}`);
    if (/navbar--scrolled/.test(html)) conEstadoHardcodeado.push(pagina);
    if (/id="navbar"/.test(html)) conIdNavbar.push(pagina);
  }
  assert.deepEqual(
    conEstadoHardcodeado, [],
    `páginas que todavía escriben navbar--scrolled en el markup: ${conEstadoHardcodeado.join(", ")}`
  );
  assert.deepEqual(
    conIdNavbar, [],
    `páginas que todavía declaran id="navbar": ${conIdNavbar.join(", ")}`
  );
});

test("transparency is declared, not sniffed", () => {
  /*
    La transparencia sobre el hero es opt-in del markup, no inferida de
    `.hero`: el extractor también tiene `.hero` (transactions/index.html:61)
    y NO debe arrancar transparente (design.md §0.1). Sólo el home declara
    navbar--sobre-hero.
  */
  const conClaseSobreHero = paginasHtml().filter((pagina) =>
    /navbar--sobre-hero/.test(read(`src/${pagina}`))
  );
  assert.deepEqual(
    conClaseSobreHero, ["index.html"],
    `se esperaba que sólo src/index.html declarara navbar--sobre-hero; se encontró en: ${conClaseSobreHero.join(", ") || "ninguna página"}`
  );
});

test("a page without JS still paints its navbar", () => {
  /*
    El reposo (fondo + logo) lo pinta CSS, no JS: toda barra que no declare
    navbar--sobre-hero arranca con `::before` visible desde el primer frame,
    sin esperar a que corra navbar.js (design.md §0.2, §3.2) — evita el
    parpadeo que tendrían las 21 páginas si el reposo se calculara recién en
    DOMContentLoaded.
  */
  const css = sinComentariosCss(read("src/app/shared/navbar/navbar.css"));
  const selector = ".navbar:not(.navbar--sobre-hero)::before";
  const inicioSelector = css.indexOf(selector);
  assert.notEqual(inicioSelector, -1, `debe existir el selector ${selector} en navbar.css`);

  const cierre = css.indexOf("}", inicioSelector);
  const apertura = css.lastIndexOf("{", cierre);
  const cuerpo = css.slice(apertura + 1, cierre);
  assert.match(cuerpo, /opacity:\s*1/, "el reposo debe pintar con opacity: 1 sin esperar a navbar.js");
});

/*
  === El offset bajo el navbar fijo ===

  Mismo patrón que --ancho-sitio: una perilla (--navbar-height) y un escalón
  derivado con calc() (--espacio-bajo-navbar). Los tests que siguen protegen
  la derivación y la unicidad de la perilla, no el número que hoy rinde.
*/

// Todas las hojas bajo src/, con las rutas normalizadas a "/" para poder
// compararlas igual en Windows y en el CI.
const hojasDeEstilo = () =>
  fs.readdirSync(path.join(ROOT, "src"), { recursive: true })
    .filter((archivo) => /\.css$/.test(archivo))
    .map((archivo) => archivo.split(path.sep).join("/"));

const sinComentariosCss = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

test("--navbar-height is one knob declared exactly once in the whole stylesheet set", () => {
  /*
    El defecto que originó esto: extractor.css redeclaraba --navbar-height en
    5rem y, como se carga después de styles.css y en la misma capa, pisaba la
    perilla SOLO en esa página. El síntoma visible no era el navbar sino
    scroll-padding-top, que cuelga del mismo token. Una perilla que se puede
    pisar en silencio no es una perilla.
  */
  const declaran = hojasDeEstilo()
    .filter((hoja) => /--navbar-height\s*:/.test(sinComentariosCss(read(`src/${hoja}`))));

  assert.deepEqual(declaran, ["styles.css"]);
});

test("--espacio-bajo-navbar derives from --navbar-height via calc(), not a resolved value", () => {
  /*
    Igual que --ancho-medio con --ancho-sitio: si alguien "simplifica" el
    calc() a 8rem, hoy se ve idéntico y la perilla deja de existir sin que
    nada avise. Este test protege la derivación, no el valor resultante.
  */
  const styles = read("src/styles.css");
  assert.match(styles, /--espacio-bajo-navbar:\s*calc\(\s*var\(--navbar-height\)/);
});

test("--navbar-height has a mobile value inside styles.css", () => {
  /*
    A ≤760px la barra compacta ya mide ~4.1rem hoy (3.1rem del toggle +
    2 × 0.5rem de aire); el token debe redeclararlo ahí en vez de dejar que
    el valor emerja del padding suelto de cada componente.
  */
  const styles = read("src/styles.css");
  assert.match(
    styles,
    /@media\s*\(max-width:\s*760px\)\s*\{\s*:root\s*\{[^}]*--navbar-height\s*:/,
  );
});

test("every page that mounts the navbar derives its top offset from the shared token", () => {
  const esperados = [
    { file: "src/app/features/courses/cursos.css", needle: "padding: var(--espacio-bajo-navbar) 2rem 4rem;" },
    { file: "src/app/features/courses/curso-detalle.css", needle: "padding: var(--espacio-bajo-navbar) 1.5rem 4rem;" },
    { file: "src/app/shared/coming-soon/coming-soon.css", needle: "padding: var(--espacio-bajo-navbar) 2rem 4rem;" },
    { file: "src/app/features/legal/privacidad.css", needle: "padding: var(--espacio-bajo-navbar) 1.5rem 4rem;" },
    { file: "src/app/features/transactions/admin.css", needle: "padding-block-start: var(--espacio-bajo-navbar);" },
    { file: "src/app/features/transactions/extractor.css", needle: "padding-block-start: var(--espacio-bajo-navbar);" },
    // El catálogo en móvil reserva el MISMO aire que en escritorio: con el
    // token móvil ya real (4.1rem), sumarle 0.5rem dejaba 8px entre la barra
    // y el contenido (medido el 2026-09-06).
    { file: "src/app/features/courses/cursos.css", needle: "padding: var(--espacio-bajo-navbar) 1rem 3rem;" },
    // El entorno de práctica se queda deliberadamente más apretado que el
    // token (cada rem es un rem que pierde el editor), pero con aire real:
    // +1.5rem conserva sus 112px de escritorio y da 24px en móvil, no 8.
    { file: "src/app/features/codigo/practica.css", needle: "padding-block: calc(var(--navbar-height) + 1.5rem) 2rem;" },
    // El hub de lenguajes sí usa el aire completo del token: no es un editor,
    // no hay rem que perder.
    { file: "src/app/features/codigo/practica.css", needle: "padding-block: var(--espacio-bajo-navbar) 4rem;" },
    { file: "src/app/features/notas/notas.css", needle: "padding-block: var(--espacio-bajo-navbar) 4rem;" },
    // El portal usa la altura pelada a propósito: su .portal__header ya pone
    // el aire por dentro (ver el comentario en portal.css).
    { file: "src/app/features/portal/portal.css", needle: "padding-block-start: var(--navbar-height);" },
  ];

  for (const { file, needle } of esperados) {
    assert.ok(read(file).includes(needle), `${file} debe declarar ${needle}`);
  }
});

test("no page hardcodes a top offset in rem anymore — the token owns it", () => {
  /*
    Barrido genérico: cualquier padding superior de 5rem o más es, por tamaño,
    un despeje del navbar disfrazado de número suelto. Los comentarios se
    quitan antes de mirar porque varias hojas MENCIONAN el valor viejo en
    prosa al explicar de dónde salía.
  */
  const encontrados = [];
  for (const hoja of hojasDeEstilo()) {
    const css = sinComentariosCss(read(`src/${hoja}`));
    for (const match of css.matchAll(/padding(?:-top|-block(?:-start)?)?\s*:\s*([\d.]+)rem/g)) {
      if (Number(match[1]) >= 5) encontrados.push(`${hoja}: ${match[0]}`);
    }
  }

  /*
    Sin excepciones: auth entró al sistema (decisión del 2026-09-05) y su
    padding superior ahora deriva de --navbar-height en vez de citar un
    número. Ver el test siguiente.
  */
  assert.deepEqual(encontrados, []);
});

test("the auth page derives its top offset from the token and keeps its centering", () => {
  /*
    .auth centra la tarjeta en el viewport (min-height: 100vh +
    justify-content: center). Su padding superior ya no es un 6rem suelto:
    deriva de --navbar-height + 3rem, y el +3rem/3rem (top − bottom = alto
    del navbar) es el desbalance que sigue corriendo el centro óptico hacia
    abajo para compensar la barra fija. El centrado lo pone
    justify-content, no el padding — cambiar el número de aire no lo rompe.
  */
  const auth = read("src/app/features/auth/auth.css");
  const regla = auth.match(/\.auth\s*\{([^}]*)\}/);
  assert.ok(regla, ".auth debe existir");
  assert.match(regla[1], /justify-content:\s*center/);
  assert.match(regla[1], /calc\(var\(--navbar-height\)/);
});

test("the scrollport owns the anchor offset", () => {
  /*
    styles.css ya reserva el espacio de cualquier ancla para todo el
    documento (html { scroll-padding-top }); repetir scroll-margin-top por
    sección es la duplicación que ese token vino a evitar.
  */
  assert.match(
    read("src/styles.css"),
    /html\s*\{\s*scroll-padding-top:\s*var\(--navbar-height\);\s*\}/,
  );
  assert.doesNotMatch(read("src/app/features/legal/privacidad.css"), /scroll-margin-top/);
  assert.doesNotMatch(read("src/app/features/courses/curso-detalle.css"), /scroll-margin-top/);
});

test("the extractor's <main> carries the class that clears the fixed navbar", () => {
  /*
    El defecto que originó todo el cambio: este <main> no tenía ningún padding
    superior y el título del hero quedaba tapado por el navbar fijo.
  */
  assert.ok(
    read("src/app/features/transactions/index.html").includes('<main class="extractor u-contenedor">'),
    "el <main> del extractor debe llevar la clase .extractor junto al contenedor",
  );
  assert.match(
    read("src/app/features/transactions/extractor.css"),
    /\.extractor\s*\{[^}]*padding-block-start:\s*var\(--espacio-bajo-navbar\)/,
  );
});
