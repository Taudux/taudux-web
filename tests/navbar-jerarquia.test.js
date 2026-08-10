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

test("'Transacciones financieras' under Tools is enabled for everyone, no admin gating", () => {
  const { ENLACES_NAVEGACION_BASE } = cargarNavbar();

  const tools = ENLACES_NAVEGACION_BASE.find((enlace) => enlace.texto === "Tools");
  const hijo = tools.hijos.find((hijo) => hijo.texto === "Transacciones financieras");

  assert.equal(hijo.habilitado, true);
  assert.equal(hijo.href, "/app/features/detector/detector.html");
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
  assert.deepEqual(textos, ["Cursos", "Notas"]);

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
