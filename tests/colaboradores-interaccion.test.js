/*
  Tests de COMPORTAMIENTO de la página de colaboradores. A diferencia de
  colaboradores-pagina.test.js (que sólo lee los fuentes), acá se EJECUTAN
  colaboradores.datos.js + colaboradores.js dentro de un vm, contra un DOM falso
  armado a partir del index.html real. Toda aserción es sobre estado observable
  del DOM (texto, hidden, atributos, foco), nunca sobre el texto del script.
*/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const CARPETA = "src/app/features/colaboradores";
const leer = (archivo) => fs.readFileSync(path.join(ROOT, CARPETA, archivo), "utf8");

// Los datos de referencia salen del mismo archivo que corre en el vm: es el
// lado "esperado" de cada comparación.
const {
  COLABORADORES,
  ETIQUETAS_ATRIBUTOS,
  colegaSugerido,
  numeroDeFicha,
  slugDeColaborador,
  indicePorSlug,
} = require(path.join(ROOT, CARPETA, "colaboradores.datos.js"));

const rutaDe = (indice) => `#/${slugDeColaborador(COLABORADORES[indice])}`;

/* ---------- DOM falso: sólo lo que colaboradores.js usa ---------- */

const ETIQUETAS_ENFOCABLES = new Set(["A", "BUTTON"]);

class Nodo {
  constructor(documento, etiqueta) {
    this.documento = documento;
    this.tagName = etiqueta.toUpperCase();
    this.parent = null;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.hidden = false;
    this.inert = false;
    this._texto = "";

    const clases = new Set();
    this._clases = clases;
    this.classList = {
      add: (...nombres) => nombres.forEach((nombre) => clases.add(nombre)),
      remove: (...nombres) => nombres.forEach((nombre) => clases.delete(nombre)),
      contains: (nombre) => clases.has(nombre),
      toggle: (nombre, forzar) => {
        const poner = forzar === undefined ? !clases.has(nombre) : Boolean(forzar);
        if (poner) clases.add(nombre);
        else clases.delete(nombre);
        return poner;
      },
    };
  }

  get className() { return [...this._clases].join(" "); }
  set className(valor) {
    this._clases.clear();
    String(valor).split(/\s+/).filter(Boolean).forEach((nombre) => this._clases.add(nombre));
  }

  // Como en el navegador: leer junta el texto de los descendientes, escribir
  // reemplaza a los hijos.
  get textContent() {
    if (this.children.length === 0) return this._texto;
    return this.children.map((hijo) => hijo.textContent).join("");
  }
  set textContent(valor) {
    this.children = [];
    this._texto = String(valor);
  }

  append(...hijos) {
    hijos.forEach((hijo) => { hijo.parent = this; this.children.push(hijo); });
  }
  appendChild(hijo) { this.append(hijo); return hijo; }
  replaceChildren(...hijos) { this.children = []; this.append(...hijos); }

  setAttribute(nombre, valor) { this.attributes[nombre] = String(valor); }
  getAttribute(nombre) { return nombre in this.attributes ? this.attributes[nombre] : null; }
  removeAttribute(nombre) { delete this.attributes[nombre]; }

  addEventListener(tipo, manejador) {
    (this.listeners[tipo] ||= []).push(manejador);
  }

  // Lo que el test usa para simular al usuario.
  disparar(tipo) {
    (this.listeners[tipo] || []).forEach((manejador) => manejador({ type: tipo, target: this }));
  }

  // Un nodo dentro de algo `hidden` o `inert` no es enfocable: así un focus()
  // llamado ANTES de mostrar la vista falla acá igual que en el navegador.
  estaFueraDeJuego() {
    for (let nodo = this; nodo; nodo = nodo.parent) {
      if (nodo.hidden || nodo.inert) return true;
    }
    return false;
  }

  // Sólo recibe foco un control nativo o algo con tabindex: así un focus()
  // sobre el <h1> del perfil sin tabindex="-1" falla acá igual que allá.
  esEnfocable() {
    return ETIQUETAS_ENFOCABLES.has(this.tagName) || "tabindex" in this.attributes;
  }

  // focus() real: mueve activeElement y emite blur en el anterior y focus en
  // el nuevo (colaboradores.js escucha ambos en cada ficha).
  focus() {
    if (!this.esEnfocable() || this.estaFueraDeJuego()) return;
    const anterior = this.documento.activeElement;
    if (anterior === this) return;
    this.documento.activeElement = this;
    if (anterior) anterior.disparar("blur");
    this.disparar("focus");
  }
}

/*
  Esqueleto estático: se levanta del index.html real con un parser mínimo de
  etiquetas (pila de abiertos). Así un id renombrado en el HTML rompe estos
  tests, que es justo lo que pasaría en la página.
*/
const ETIQUETAS_SIN_CIERRE = new Set(["meta", "link", "img", "br", "hr", "input"]);

function montarEsqueleto(documento, html) {
  const raiz = new Nodo(documento, "#raiz");
  const pila = [raiz];
  const limpio = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<!DOCTYPE[^>]*>/i, "");
  const trozos = /<(\/)?([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/g;

  for (const [, cierra, etiqueta, atributos, texto] of limpio.matchAll(trozos)) {
    const abierto = pila[pila.length - 1];
    if (texto !== undefined) {
      const visible = texto.replace(/\s+/g, " ").trim();
      if (visible) abierto.append(documento.createTextNode(visible));
    } else if (cierra) {
      pila.pop();
    } else {
      const nodo = new Nodo(documento, etiqueta);
      for (const [, nombre, valor = ""] of atributos.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
        if (nombre === "class") nodo.className = valor;
        else if (nombre === "hidden") nodo.hidden = true;
        else nodo.setAttribute(nombre, valor);
      }
      abierto.append(nodo);
      if (!ETIQUETAS_SIN_CIERRE.has(etiqueta.toLowerCase())) pila.push(nodo);
    }
  }
  return raiz;
}

function recorrer(raiz, visitar) {
  raiz.children.forEach((hijo) => { visitar(hijo); recorrer(hijo, visitar); });
}

function porClase(raiz, clase) {
  const hallados = [];
  recorrer(raiz, (nodo) => { if (nodo.classList.contains(clase)) hallados.push(nodo); });
  return hallados;
}

/*
  Historial falso: una lista de URLs y un cursor, con sólo lo que el perfil en
  el hash le pide al navegador:
    location.hash = x      agrega una entrada (descarta las de "adelante") y
                           emite hashchange. Con el hash que ya está, nada.
    location.replace(url)  reemplaza la entrada actual; emite si cambió el hash.
    history.replaceState   reemplaza la entrada actual SIN emitir nada.
    atras()                el botón del navegador: una entrada atrás, y emite.
  Las URLs se resuelven con URL, como allá. Todo es síncrono: en el navegador
  hashchange llega en una tarea aparte, y el script no depende de ese orden.
*/
const URL_DE_LA_PAGINA = "https://taudux.com/app/features/colaboradores/";

function crearNavegador(hashInicial) {
  const entradas = [new URL(hashInicial, URL_DE_LA_PAGINA)];
  let actual = 0;
  const oyentes = [];

  const avisar = (antes) => {
    if (entradas[actual].hash !== antes.hash) oyentes.forEach((manejador) => manejador({ type: "hashchange" }));
  };

  const navegar = (url, { reemplazar, emitir }) => {
    const antes = entradas[actual];
    const destino = new URL(url, antes);
    if (reemplazar) {
      entradas[actual] = destino;
    } else {
      actual += 1;
      entradas.splice(actual, entradas.length, destino);
    }
    if (emitir) avisar(antes);
  };

  return {
    location: {
      get hash() { return entradas[actual].hash; },
      set hash(valor) {
        const destino = new URL(entradas[actual]);
        destino.hash = valor;
        if (destino.hash !== entradas[actual].hash) navegar(destino, { reemplazar: false, emitir: true });
      },
      get href() { return entradas[actual].href; },
      get pathname() { return entradas[actual].pathname; },
      get search() { return entradas[actual].search; },
      replace: (url) => navegar(url, { reemplazar: true, emitir: true }),
    },
    history: {
      get length() { return entradas.length; },
      replaceState: (_estado, _titulo, url) => navegar(url, { reemplazar: true, emitir: false }),
    },
    addEventListener: (tipo, manejador) => { if (tipo === "hashchange") oyentes.push(manejador); },
    oyentes: () => oyentes.length,
    atras() {
      assert.ok(actual > 0, "no hay entrada anterior: atrás saldría de la página");
      const antes = entradas[actual];
      actual -= 1;
      avisar(antes);
    },
  };
}

/*
  Carga la página en un contexto NUEVO y dispara DOMContentLoaded.
    sinIds    ids que getElementById no encuentra (página a medio montar).
    retoques  { indice: campos } que se mezclan en COLABORADORES dentro del vm,
              sin tocar el archivo de datos.
    sinDatos  no carga colaboradores.datos.js.
    hash      el hash con el que se abre la página (un enlace compartido).
*/
function cargarPagina({ sinIds = [], retoques = {}, sinDatos = false, hash = "" } = {}) {
  const alCargar = [];
  const documento = {
    activeElement: null,
    createElement: (etiqueta) => new Nodo(documento, etiqueta),
    createTextNode: (texto) => {
      const nodo = new Nodo(documento, "#text");
      nodo._texto = String(texto);
      return nodo;
    },
    addEventListener: (tipo, manejador) => { if (tipo === "DOMContentLoaded") alCargar.push(manejador); },
    getElementById: (id) => (sinIds.includes(id) ? null : ids.get(id) || null),
  };

  const raiz = montarEsqueleto(documento, leer("index.html"));
  const ids = new Map();
  recorrer(raiz, (nodo) => { if (nodo.attributes.id) ids.set(nodo.attributes.id, nodo); });

  const navegador = crearNavegador(hash);
  const contexto = vm.createContext({
    document: documento,
    location: navegador.location,
    history: navegador.history,
    addEventListener: navegador.addEventListener,
  });
  // Como en el navegador, `window` es el propio global.
  contexto.window = contexto;
  if (!sinDatos) {
    vm.runInContext(leer("colaboradores.datos.js"), contexto);
    vm.runInContext(
      `for (const [i, campos] of Object.entries(${JSON.stringify(retoques)})) Object.assign(COLABORADORES[i], campos);`,
      contexto,
    );
  }
  vm.runInContext(leer("colaboradores.js"), contexto);
  alCargar.forEach((manejador) => manejador());

  const porId = (id) => ids.get(id);
  return {
    documento,
    porId,
    fichas: () => porClase(porId("colaboradoresGrilla"), "colaboradores__ficha"),
    texto: (id) => porId(id).textContent,
    hash: () => navegador.location.hash,
    url: () => navegador.location.href,
    historial: () => navegador.history.length,
    oyentesDeHash: navegador.oyentes,
    atras: navegador.atras,
    // Quien escribe otro hash en la barra de direcciones.
    irA: (nuevo) => { navegador.location.hash = nuevo; },
  };
}

// Por cada fila de atributos: cuántos segmentos llenos y qué valor declara.
function leerAtributos(contenedor) {
  return porClase(contenedor, "colaboradores__atributo").map((fila) => ({
    nombre: porClase(fila, "colaboradores__atributo-nombre")[0].textContent,
    llenos: porClase(fila, "colaboradores__segmento--lleno").length,
    segmentos: porClase(fila, "colaboradores__segmento").length,
    valor: fila.children[fila.children.length - 1].textContent,
  }));
}

// Se compara por identidad pero se informa con una descripción corta: dejar que
// assert arme el diff de dos nodos (grafos circulares enormes) tarda decenas de
// segundos cuando el test falla.
const describir = (nodo) => (nodo ? `${nodo.tagName} ${nodo.attributes.id || nodo.attributes["aria-label"] || ""}`.trim() : "(nada)");

function assertFocoEn(pagina, esperado) {
  const actual = pagina.documento.activeElement;
  assert.ok(actual === esperado, `el foco está en ${describir(actual)}; se esperaba en ${describir(esperado)}`);
}

function assertVistaPreviaVacia(pagina) {
  assert.equal(pagina.texto("previaNombre"), "¿Quién?");
  assert.equal(pagina.texto("previaClase"), "Sin selección");
  assert.equal(pagina.texto("previaInicial"), "?");
  assert.match(pagina.texto("previaBio"), /^Elige una ficha del roster/);
  assert.ok(pagina.porId("previaBio").classList.contains("colaboradores__bio--vacia"));
  assert.equal(pagina.porId("previaAcciones").inert, true);
  assert.deepEqual(leerAtributos(pagina.porId("previaAtributos")).map((fila) => fila.llenos), [0, 0, 0, 0, 0]);
}

function assertVistaPreviaDe(pagina, indice) {
  const ficha = COLABORADORES[indice];
  assert.equal(pagina.texto("previaNombre"), ficha.nombre);
  assert.equal(pagina.texto("previaRol"), ficha.rol);
  assert.equal(pagina.texto("previaClase"), ficha.clase);
  assert.equal(pagina.texto("previaBio"), ficha.bio);
  assert.equal(pagina.porId("previaBio").classList.contains("colaboradores__bio--vacia"), false);
  assert.equal(pagina.porId("previaAcciones").inert, false);

  const filas = leerAtributos(pagina.porId("previaAtributos"));
  assert.deepEqual(filas.map((fila) => fila.nombre), ETIQUETAS_ATRIBUTOS);
  assert.deepEqual(filas.map((fila) => fila.llenos), ficha.stats);
  // Sólo la ficha mostrada queda marcada como activa.
  const activas = pagina.fichas().map((boton) => boton.classList.contains("colaboradores__ficha--activa"));
  assert.deepEqual(activas, COLABORADORES.map((_, i) => i === indice));
}

function assertPerfilDe(pagina, indice) {
  const ficha = COLABORADORES[indice];
  assert.equal(pagina.porId("colaboradoresRoster").hidden, true);
  assert.equal(pagina.porId("colaboradoresPerfil").hidden, false);
  assert.equal(pagina.texto("perfilNombre"), ficha.nombre);
  assert.equal(pagina.texto("perfilNumero"), `${numeroDeFicha(indice)} · ${ficha.clase}`);
  assert.equal(pagina.texto("perfilRol"), ficha.rol);
  assert.equal(pagina.texto("perfilEspecialidad"), ficha.esp);
  assert.equal(pagina.texto("perfilProyectos"), String(ficha.proyectos));
  assert.equal(pagina.texto("perfilUbicacion"), ficha.ciudad);
  assert.equal(pagina.texto("perfilExperiencia"), ficha.anios);
  assert.equal(pagina.texto("perfilDisponibilidad"), ficha.disp);
  assert.equal(pagina.texto("perfilStack"), ficha.stack);
  assert.equal(pagina.texto("perfilBio"), ficha.bio);
  assert.equal(
    pagina.porId("perfilPunto").classList.contains("colaboradores__punto--disponible"),
    ficha.disp === "Disponible",
  );

  const filas = leerAtributos(pagina.porId("perfilAtributos"));
  assert.deepEqual(filas.map((fila) => fila.nombre), ETIQUETAS_ATRIBUTOS);
  assert.deepEqual(filas.map((fila) => fila.valor), ficha.stats.map((n) => `${n}/5`));
  assert.deepEqual(filas.map((fila) => fila.llenos), ficha.stats);

  const colega = COLABORADORES[colegaSugerido(indice, COLABORADORES.length)];
  assert.equal(pagina.porId("perfilColega").hidden, false);
  assert.equal(pagina.texto("perfilColegaNombre"), colega.nombre);
  assert.equal(pagina.texto("perfilColegaInicial"), colega.nombre.charAt(0));
}

// De vuelta en el roster, la ficha que se estaba viendo queda como selección:
// la única marcada y la que muestra la vista previa.
function assertRosterConSeleccion(pagina, indice) {
  const fichas = pagina.fichas();
  assert.equal(pagina.porId("colaboradoresRoster").hidden, false);
  assert.equal(pagina.porId("colaboradoresPerfil").hidden, true);
  assert.deepEqual(
    fichas.map((boton) => boton.getAttribute("aria-current")),
    COLABORADORES.map((_, i) => (i === indice ? "true" : null)),
  );
  assert.ok(fichas[indice].classList.contains("colaboradores__ficha--seleccionada"));
  assertVistaPreviaDe(pagina, indice);
}

/* ---------- Roster ---------- */

test("renders one tile button per collaborator, named with full name and role", () => {
  const pagina = cargarPagina();
  const celdas = pagina.porId("colaboradoresGrilla").children;

  assert.equal(celdas.length, COLABORADORES.length);
  celdas.forEach((celda, indice) => {
    assert.equal(celda.tagName, "LI");
    assert.equal(celda.children.length, 1);
    const boton = celda.children[0];
    assert.equal(boton.tagName, "BUTTON");
    assert.equal(boton.type, "button");
    const nombreAccesible = boton.getAttribute("aria-label");
    assert.ok(nombreAccesible.includes(COLABORADORES[indice].nombre), nombreAccesible);
    assert.ok(nombreAccesible.includes(COLABORADORES[indice].rol), nombreAccesible);
    assert.equal(boton.getAttribute("aria-current"), null);
  });

  // Recién cargada: roster a la vista, perfil oculto, vista previa vacía.
  assert.equal(pagina.porId("colaboradoresRoster").hidden, false);
  assert.equal(pagina.porId("colaboradoresPerfil").hidden, true);
  assertVistaPreviaVacia(pagina);
});

test("hovering a tile previews that card and leaving it returns to the empty state", () => {
  const pagina = cargarPagina();
  const fichas = pagina.fichas();

  fichas[3].disparar("mouseenter");
  assertVistaPreviaDe(pagina, 3);
  // Las barras tienen cinco segmentos; el valor va oculto para lectores.
  const filas = leerAtributos(pagina.porId("previaAtributos"));
  assert.deepEqual(filas.map((fila) => fila.segmentos), [5, 5, 5, 5, 5]);
  assert.deepEqual(filas.map((fila) => fila.valor), COLABORADORES[3].stats.map((n) => `${n}/5`));

  // Pasar a otra ficha sin mouseleave intermedio cambia la vista previa.
  fichas[8].disparar("mouseenter");
  assertVistaPreviaDe(pagina, 8);

  // El mouseleave atrasado de la ficha anterior no apaga a la actual.
  fichas[3].disparar("mouseleave");
  assertVistaPreviaDe(pagina, 8);

  fichas[8].disparar("mouseleave");
  assertVistaPreviaVacia(pagina);
  assert.ok(pagina.fichas().every((boton) => !boton.classList.contains("colaboradores__ficha--activa")));
  // Hover nunca abre el perfil.
  assert.equal(pagina.porId("colaboradoresPerfil").hidden, true);
});

test("focusing a tile previews it like hover does, and blur clears it", () => {
  const pagina = cargarPagina();
  const fichas = pagina.fichas();

  fichas[5].focus();
  assertFocoEn(pagina, fichas[5]);
  assertVistaPreviaDe(pagina, 5);

  // Tab a la siguiente: blur de una + focus de la otra.
  fichas[6].focus();
  assertVistaPreviaDe(pagina, 6);

  fichas[6].disparar("blur");
  assertVistaPreviaVacia(pagina);
});

/*
  El cursor y el foco son dos dueños distintos del resaltado. Compartían una
  sola variable: con el foco del teclado en una ficha, pasar el mouse por encima
  y sacarlo apagaba la vista previa aunque la ficha siguiera enfocada.
*/
test("the pointer leaving a tile does not drop the preview of the tile that still has keyboard focus", () => {
  const pagina = cargarPagina();
  const fichas = pagina.fichas();

  fichas[5].focus();
  fichas[5].disparar("mouseenter");
  fichas[5].disparar("mouseleave");
  assertVistaPreviaDe(pagina, 5);

  // El cursor manda mientras está encima de OTRA ficha, y al irse la vista
  // vuelve a la que tiene el foco, no al vacío.
  fichas[2].disparar("mouseenter");
  assertVistaPreviaDe(pagina, 2);
  fichas[2].disparar("mouseleave");
  assertVistaPreviaDe(pagina, 5);

  fichas[5].disparar("blur");
  assertVistaPreviaVacia(pagina);
});

/* ---------- Perfil ---------- */

test("clicking a tile puts its profile in the hash as a new history entry and moves focus to the profile name", () => {
  const pagina = cargarPagina();
  const ficha = pagina.fichas()[2];

  ficha.focus();
  ficha.disparar("click");

  assert.equal(pagina.hash(), rutaDe(2));
  assert.equal(pagina.historial(), 2, "abrir un perfil agrega UNA entrada: la que el botón atrás deshace");
  // Índice 2 es "Parcial": cubre también el punto de disponibilidad apagado.
  assertPerfilDe(pagina, 2);
  // La ficha que tenía el foco se ocultó con el roster.
  assertFocoEn(pagina, pagina.porId("perfilNombre"));
});

test("the browser back button returns to the roster and restores focus to the opened tile", () => {
  const pagina = cargarPagina();
  const fichas = pagina.fichas();

  fichas[7].disparar("click");
  assert.equal(pagina.porId("colaboradoresPerfil").hidden, false);

  pagina.atras();

  assert.equal(pagina.hash(), "");
  assertFocoEn(pagina, fichas[7]);
  assertRosterConSeleccion(pagina, 7);

  // Con una selección hecha, salir de otra ficha vuelve a ELLA, no al vacío.
  fichas[0].disparar("mouseenter");
  assertVistaPreviaDe(pagina, 0);
  fichas[0].disparar("mouseleave");
  assertVistaPreviaDe(pagina, 7);
});

test("'Suele trabajar con' swaps the whole profile to the suggested colleague, wrapping last to first", () => {
  const pagina = cargarPagina();
  const total = COLABORADORES.length;
  const penultima = total - 2;
  const ultima = total - 1;
  assert.equal(colegaSugerido(ultima, total), 0, "premisa: la última ficha sugiere a la primera");

  pagina.fichas()[penultima].disparar("click");
  assertPerfilDe(pagina, penultima);
  assert.equal(pagina.texto("perfilColegaNombre"), COLABORADORES[ultima].nombre);

  const colega = pagina.porId("perfilColega");
  colega.focus();
  colega.disparar("click");
  assertPerfilDe(pagina, ultima);
  assert.equal(pagina.hash(), rutaDe(ultima));
  assert.equal(pagina.texto("perfilColegaNombre"), COLABORADORES[0].nombre);
  // El salto no se lleva el foco: sigue en el botón, que no se ocultó.
  assertFocoEn(pagina, colega);

  // La vuelta: de la última a la primera.
  colega.disparar("click");
  assertPerfilDe(pagina, 0);
  assert.equal(pagina.hash(), rutaDe(0));
  assert.equal(pagina.texto("perfilNumero"), `01 · ${COLABORADORES[0].clase}`);

  // Cada salto REEMPLAZA la entrada del perfil: atrás, desde cualquier perfil,
  // deja en el roster de una vez, sin recorrer cada colega visitado.
  assert.equal(pagina.historial(), 2);
  pagina.atras();

  // Y el foco va a la ficha que se estaba viendo, no a la que se abrió.
  assert.equal(pagina.hash(), "");
  assertFocoEn(pagina, pagina.fichas()[0]);
  assertRosterConSeleccion(pagina, 0);
});

/* ---------- Perfil en el hash ---------- */

test("loading with a profile hash shows that profile without moving focus or adding history", () => {
  const mariana = indicePorSlug("mariana");
  assert.notEqual(mariana, -1, "premisa: hay una ficha con el slug mariana");

  const pagina = cargarPagina({ hash: "#/mariana" });

  assertPerfilDe(pagina, mariana);
  assert.equal(pagina.documento.activeElement, null, "cargar la página no mueve el foco");
  assert.equal(pagina.hash(), "#/mariana");
  assert.equal(pagina.historial(), 1);

  // Mariana también es la selección: quien borra el slug de la barra (y deja
  // el "#") vuelve al roster con su ficha marcada.
  pagina.irA("#");
  assertRosterConSeleccion(pagina, mariana);
});

test("an unknown profile slug falls back to the roster and cleans the hash without adding history", () => {
  const pagina = cargarPagina({ hash: "#/nadie" });

  assert.equal(pagina.porId("colaboradoresRoster").hidden, false);
  assert.equal(pagina.porId("colaboradoresPerfil").hidden, true);
  assertVistaPreviaVacia(pagina);
  assert.equal(pagina.hash(), "");
  assert.equal(pagina.url(), URL_DE_LA_PAGINA, "se limpia sólo el hash: la ruta queda");
  assert.equal(pagina.historial(), 1, "limpiar reemplaza la entrada, no agrega otra");
  assert.equal(pagina.documento.activeElement, null);

  // Igual si llega con un perfil abierto: roster, con el foco en la ficha que
  // se estaba viendo. La entrada que creó quien escribió el hash queda, pero
  // ya corregida (3 y no 4: no se apiló una más para limpiarla).
  pagina.fichas()[4].disparar("click");
  pagina.irA("#/nadie");
  assert.equal(pagina.hash(), "");
  assert.equal(pagina.historial(), 3);
  assertFocoEn(pagina, pagina.fichas()[4]);
  assertRosterConSeleccion(pagina, 4);
});

/*
  Sólo #/<slug> es del perfil. Otro hash puede ser de otro script: el cliente de
  Supabase lee y limpia los tokens de sesión que llegan en el hash, y borrarlos
  antes que él rompería el inicio de sesión.
*/
test("a hash that is not a profile route shows the roster and is left alone", () => {
  const pagina = cargarPagina({ hash: "#access_token=abc" });

  assert.equal(pagina.porId("colaboradoresRoster").hidden, false);
  assert.equal(pagina.porId("colaboradoresPerfil").hidden, true);
  assert.equal(pagina.hash(), "#access_token=abc");
  assert.equal(pagina.historial(), 1);
});

/* ---------- Enlaces de contacto ---------- */

test("contact pills: none with the sample data; safe links render with the right href, target and rel", () => {
  const deMuestra = cargarPagina();
  deMuestra.fichas()[0].disparar("mouseenter");
  assert.equal(deMuestra.porId("previaEnlaces").hidden, true);
  assert.equal(deMuestra.porId("previaEnlaces").children.length, 0);
  deMuestra.fichas()[0].disparar("click");
  assert.equal(deMuestra.porId("perfilEnlaces").hidden, true);
  assert.equal(deMuestra.porId("perfilEnlaces").children.length, 0);

  const pagina = cargarPagina({
    retoques: {
      0: {
        linkedin: "https://www.linkedin.com/in/valeria-ortiz",
        correo: "valeria@example.com",
        // Un destino que no es https no debe llegar nunca a un href.
        github: "javascript:alert(1)",
      },
    },
  });

  const assertPildoras = (lista) => {
    assert.equal(lista.hidden, false);
    const anclas = lista.children.map((item) => {
      assert.equal(item.tagName, "LI");
      return item.children[0];
    });
    assert.deepEqual(anclas.map((a) => a.href), [
      "https://www.linkedin.com/in/valeria-ortiz",
      "mailto:valeria@example.com",
    ]);
    const [linkedin, correo] = anclas;
    assert.equal(linkedin.target, "_blank");
    assert.match(linkedin.rel, /\bnoopener\b/);
    assert.match(linkedin.textContent, /LinkedIn$/);
    assert.equal(correo.target, undefined);
    assert.equal(correo.rel, undefined);
    assert.match(correo.textContent, /Correo$/);
  };

  pagina.fichas()[0].disparar("mouseenter");
  assertPildoras(pagina.porId("previaEnlaces"));

  // Otra ficha sin contacto: las píldoras de la anterior no se quedan pegadas.
  pagina.fichas()[1].disparar("mouseenter");
  assert.equal(pagina.porId("previaEnlaces").hidden, true);
  assert.equal(pagina.porId("previaEnlaces").children.length, 0);

  pagina.fichas()[0].disparar("click");
  assertPildoras(pagina.porId("perfilEnlaces"));
  pagina.porId("perfilColega").disparar("click");
  assert.equal(pagina.porId("perfilEnlaces").hidden, true);
  assert.equal(pagina.porId("perfilEnlaces").children.length, 0);
});

/* ---------- Página a medio montar ---------- */

test("a half-mounted page or a missing roster leaves the static HTML untouched instead of throwing", () => {
  let pagina;
  assert.doesNotThrow(() => { pagina = cargarPagina({ sinIds: ["colaboradoresPerfil"] }); });
  // Todo o nada: sin la sección de perfil no se pinta ni una ficha. Esto es lo
  // que distingue a los tests de arriba de un DOM falso que acepta cualquier cosa.
  assert.equal(pagina.porId("colaboradoresGrilla").children.length, 0);
  assert.equal(pagina.texto("previaNombre"), "¿Quién?");
  // Nada quedó conectado: ni el colega ni el hash.
  assert.deepEqual(pagina.porId("perfilColega").listeners, {});
  assert.equal(pagina.oyentesDeHash(), 0);

  assert.doesNotThrow(() => { pagina = cargarPagina({ sinDatos: true }); });
  assert.equal(pagina.porId("colaboradoresGrilla").children.length, 0);
  assert.equal(pagina.texto("previaNombre"), "¿Quién?");
});
