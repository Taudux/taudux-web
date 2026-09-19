/*
  Tests de COMPORTAMIENTO de la página de colaboradores. A diferencia de
  colaboradores-pagina.test.js (que sólo lee los fuentes), acá se EJECUTAN
  colaboradores.datos.js + colaboradores.js dentro de un vm, contra un DOM falso
  armado a partir del index.html real. Toda aserción es sobre estado observable
  del DOM (texto, hidden, atributos, foco), nunca sobre el texto del script.

  La lista la da un listarColaboradores() falso que se inyecta en el vm: por
  defecto, las doce fichas de muestra con perfil completo.
*/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const CARPETA = "src/app/features/colaboradores";
const leer = (archivo) => fs.readFileSync(path.join(ROOT, CARPETA, archivo), "utf8");

// La lógica sale del mismo archivo que corre en el vm y las fichas, de la
// muestra que le sirve el servicio falso: es el lado "esperado" de cada
// comparación.
const {
  numeroDeFicha,
  indicePorSlug,
} = require(path.join(ROOT, CARPETA, "colaboradores.datos.js"));
const { COLABORADORES_MUESTRA: MUESTRA } = require("./fixtures/colaboradores.muestra.js");

const rutaDe = (indice) => `#/${MUESTRA[indice].slug}`;

// Lo que hoy entrega la base: nombre, corto y slug, sin ficha de perfil.
const SAMAEL = Object.freeze({ nombre: "Samael Flores", corto: "Samael", slug: "samael" });

const CARGANDO = "Cargando colaboradores…";
const ERROR_DE_CARGA = "No se pudo cargar la lista de colaboradores. Reintenta cuando tengas conexión.";
const VACIO = "Aún no hay colaboradores para mostrar.";

/* ---------- listarColaboradores() falsos ---------- */

// Mismo contrato que el servicio real: nunca lanza, devuelve { ok, ... }.
const FALLO = Object.freeze({ ok: false, mensaje: "No se pudo cargar la lista de colaboradores." });
const exito = (lista) => ({ ok: true, data: structuredClone(lista) });

// Cada llamada entrega su propia copia: la página nunca comparte objetos con
// el test ni con la llamada anterior.
const conLista = (lista) => async () => exito(lista);

// Una respuesta por llamada, en orden: la carga inicial y cada reintento.
function enSecuencia(...respuestas) {
  let llamada = 0;
  return async () => structuredClone(respuestas[Math.min(llamada++, respuestas.length - 1)]);
}

// Una respuesta que el test entrega cuando quiere, para ver el "Cargando…".
function diferido() {
  let resolver;
  const promesa = new Promise((resolve) => { resolver = resolve; });
  return { promesa, resolver };
}

function muestraConRetoques(retoques) {
  const lista = structuredClone(MUESTRA);
  for (const [indice, campos] of Object.entries(retoques)) Object.assign(lista[indice], campos);
  return lista;
}

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

  // Lo que el test usa para simular al usuario. Devuelve lo que devolvió cada
  // manejador, para poder esperar a los asíncronos (el reintento de carga).
  disparar(tipo) {
    return (this.listeners[tipo] || []).map((manejador) => manejador({ type: tipo, target: this }));
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
  Abre la página en un contexto NUEVO y dispara DOMContentLoaded, SIN esperar
  a que la lista cargue: `iniciada` es la promesa de esa primera carga.
    sinIds       ids que getElementById no encuentra (página a medio montar).
    servicio     el listarColaboradores() que ve la página. Por defecto, la
                 muestra completa.
    retoques     { indice: campos } que se mezclan en una copia de la muestra
                 antes de servirla (sólo sin `servicio`).
    sinDatos     no carga colaboradores.datos.js.
    sinServicio  no hay listarColaboradores (su script no llegó).
    hash         el hash con el que se abre la página (un enlace compartido).
*/
function abrirPagina({
  sinIds = [],
  servicio,
  retoques = {},
  sinDatos = false,
  sinServicio = false,
  hash = "",
} = {}) {
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
  if (!sinServicio) contexto.listarColaboradores = servicio ?? conLista(muestraConRetoques(retoques));
  if (!sinDatos) vm.runInContext(leer("colaboradores.datos.js"), contexto);
  vm.runInContext(leer("colaboradores.js"), contexto);
  // El manejador devuelve la promesa de la primera carga; el navegador la
  // ignora, el test la espera.
  const iniciada = Promise.all(alCargar.map((manejador) => manejador()));

  const porId = (id) => ids.get(id);
  return {
    documento,
    raiz,
    porId,
    iniciada,
    fichas: () => porClase(porId("colaboradoresGrilla"), "colaboradores__ficha"),
    texto: (id) => porId(id).textContent,
    hash: () => navegador.location.hash,
    url: () => navegador.location.href,
    historial: () => navegador.history.length,
    oyentesDeHash: navegador.oyentes,
    atras: navegador.atras,
    // Quien escribe otro hash en la barra de direcciones.
    irA: (nuevo) => { navegador.location.hash = nuevo; },
    // Clic en "Reintentar carga"; la promesa se cumple cuando termina la carga.
    reintentar: () => Promise.all(porId("colaboradoresReintentar").disparar("click")),
  };
}

// Abre la página y espera a que la primera carga termine.
async function cargarPagina(opciones) {
  const pagina = abrirPagina(opciones);
  await pagina.iniciada;
  return pagina;
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
  assert.equal(pagina.texto("previaRol"), "Pasa el cursor o elige una ficha");
  assert.equal(pagina.porId("previaRol").hidden, false);
  assert.equal(pagina.texto("previaInicial"), "?");
  assert.match(pagina.texto("previaBio"), /^Elige una ficha del roster/);
  assert.ok(pagina.porId("previaBio").classList.contains("colaboradores__bio--vacia"));
  // Sin nadie a la vista no hay enlaces: la lista se oculta, no queda vacía.
  assert.equal(pagina.porId("previaEnlaces").hidden, true);
  assert.equal(pagina.porId("previaEnlaces").children.length, 0);
}

function assertVistaPreviaDe(pagina, indice, lista = MUESTRA) {
  const ficha = lista[indice];
  assert.equal(pagina.texto("previaNombre"), ficha.nombre);
  assert.equal(pagina.texto("previaRol"), ficha.rol);
  assert.equal(pagina.porId("previaRol").hidden, false);
  assert.equal(pagina.texto("previaBio"), ficha.bio);
  assert.equal(pagina.porId("previaBio").classList.contains("colaboradores__bio--vacia"), false);

  // Sólo la ficha mostrada queda marcada como activa.
  const activas = pagina.fichas().map((boton) => boton.classList.contains("colaboradores__ficha--activa"));
  assert.deepEqual(activas, lista.map((_, i) => i === indice));
}

/*
  Persona sin ficha de perfil: la vista previa muestra SÓLO su nombre. Nada de
  rol ni bio, y ningún enlace.
*/
function assertVistaPreviaSoloNombre(pagina, persona) {
  assert.equal(pagina.texto("previaNombre"), persona.nombre);
  assert.equal(pagina.porId("previaRol").hidden, true);
  assert.equal(pagina.texto("previaBio"), "");
  assert.equal(pagina.porId("previaEnlaces").hidden, true);
  assert.equal(pagina.porId("previaEnlaces").children.length, 0);
}

function assertAviso(pagina, mensaje, { reintentar }) {
  assert.equal(pagina.porId("colaboradoresAviso").hidden, false);
  assert.equal(pagina.texto("colaboradoresAvisoMensaje"), mensaje);
  assert.equal(pagina.porId("colaboradoresReintentar").hidden, !reintentar);
}

function assertSinAviso(pagina) {
  assert.equal(pagina.porId("colaboradoresAviso").hidden, true);
  assert.notEqual(pagina.porId("colaboradoresGrilla").getAttribute("aria-busy"), "true");
}

function assertPerfilDe(pagina, indice, lista = MUESTRA) {
  const ficha = lista[indice];
  assert.equal(pagina.porId("colaboradoresRoster").hidden, true);
  assert.equal(pagina.porId("colaboradoresPerfil").hidden, false);
  assert.equal(pagina.texto("perfilNombre"), ficha.nombre);
  assert.equal(pagina.texto("perfilNumero"), numeroDeFicha(indice));
  assert.equal(pagina.texto("perfilRol"), ficha.rol);
  assert.equal(pagina.texto("perfilEspecialidad"), ficha.esp);
  assert.equal(pagina.texto("perfilUbicacion"), ficha.ciudad);
  assert.equal(pagina.texto("perfilExperiencia"), ficha.anios);
  assert.equal(pagina.texto("perfilDisponibilidad"), ficha.disp);
  assert.equal(pagina.texto("perfilStack"), ficha.stack);
  assert.equal(pagina.texto("perfilBio"), ficha.bio);
  assert.equal(
    pagina.porId("perfilPunto").classList.contains("colaboradores__punto--disponible"),
    ficha.disp === "Disponible",
  );
}

// De vuelta en el roster, la ficha que se estaba viendo queda como selección:
// la única marcada y la que muestra la vista previa.
function assertRosterConSeleccion(pagina, indice) {
  const fichas = pagina.fichas();
  assert.equal(pagina.porId("colaboradoresRoster").hidden, false);
  assert.equal(pagina.porId("colaboradoresPerfil").hidden, true);
  assert.deepEqual(
    fichas.map((boton) => boton.getAttribute("aria-current")),
    MUESTRA.map((_, i) => (i === indice ? "true" : null)),
  );
  assert.ok(fichas[indice].classList.contains("colaboradores__ficha--seleccionada"));
  assertVistaPreviaDe(pagina, indice);
}

/* ---------- Roster ---------- */

test("renders one tile button per collaborator, named with full name and role", async () => {
  const pagina = await cargarPagina();
  const celdas = pagina.porId("colaboradoresGrilla").children;

  assert.equal(celdas.length, MUESTRA.length);
  celdas.forEach((celda, indice) => {
    assert.equal(celda.tagName, "LI");
    assert.equal(celda.children.length, 1);
    const boton = celda.children[0];
    assert.equal(boton.tagName, "BUTTON");
    assert.equal(boton.type, "button");
    const nombreAccesible = boton.getAttribute("aria-label");
    assert.ok(nombreAccesible.includes(MUESTRA[indice].nombre), nombreAccesible);
    assert.ok(nombreAccesible.includes(MUESTRA[indice].rol), nombreAccesible);
    assert.equal(boton.getAttribute("aria-current"), null);
  });

  // Recién cargada: roster a la vista, perfil oculto, vista previa vacía, sin
  // aviso de carga y con la tarjeta de perfil (todas las de muestra tienen ficha).
  assert.equal(pagina.porId("colaboradoresRoster").hidden, false);
  assert.equal(pagina.porId("colaboradoresPerfil").hidden, true);
  assertSinAviso(pagina);
  assert.equal(pagina.porId("colaboradoresResumen").hidden, false);
  assertVistaPreviaVacia(pagina);
});

test("hovering a tile previews that card and leaving it returns to the empty state", async () => {
  const pagina = await cargarPagina();
  const fichas = pagina.fichas();

  fichas[3].disparar("mouseenter");
  assertVistaPreviaDe(pagina, 3);

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

test("focusing a tile previews it like hover does, and blur clears it", async () => {
  const pagina = await cargarPagina();
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
test("the pointer leaving a tile does not drop the preview of the tile that still has keyboard focus", async () => {
  const pagina = await cargarPagina();
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

test("clicking a tile puts its profile in the hash as a new history entry and moves focus to the profile name", async () => {
  const pagina = await cargarPagina();
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

test("the browser back button returns to the roster and restores focus to the opened tile", async () => {
  const pagina = await cargarPagina();
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

/*
  Del perfil al roster, el foco va a la ficha del perfil que se estaba VIENDO,
  no a la que se abrió con el clic. Sin "Suele trabajar con" (retirado), la
  única forma de cambiar de perfil sin pasar por el roster es otro #/<slug>
  en la barra: cambiar de perfil a perfil no mueve el foco, y cada perfil
  escrito ahí es una entrada propia del historial.
*/
test("returning to the roster focuses the tile of the profile being viewed, not the one first opened", async () => {
  const pagina = await cargarPagina();
  const fichas = pagina.fichas();

  fichas[2].disparar("click");
  assertFocoEn(pagina, pagina.porId("perfilNombre"));

  pagina.irA(rutaDe(9));
  assertPerfilDe(pagina, 9);
  assert.equal(pagina.historial(), 3);
  assertFocoEn(pagina, pagina.porId("perfilNombre"));

  // Quien borra el slug de la barra (y deja el "#") vuelve al roster.
  pagina.irA("#");
  assertFocoEn(pagina, fichas[9]);
  assertRosterConSeleccion(pagina, 9);

  // Y atrás recorre cada perfil visitado hasta la entrada del roster.
  pagina.atras();
  assertPerfilDe(pagina, 9);
  pagina.atras();
  assertPerfilDe(pagina, 2);
  pagina.atras();
  assert.equal(pagina.hash(), "");
  assertFocoEn(pagina, fichas[2]);
  assertRosterConSeleccion(pagina, 2);
});

/*
  La ficha técnica ya no tiene clase, atributos, proyectos, colega sugerido
  ni "Contactar" (retirados el 2026-09-19): arriba queda sólo el número.
*/
test("the profile shows only its card number, with no class, attributes, projects, colleague or contact button", async () => {
  const pagina = await cargarPagina();

  pagina.fichas()[0].disparar("click");
  assertPerfilDe(pagina, 0);
  assert.equal(pagina.texto("perfilNumero"), "01");

  for (const id of ["previaClase", "previaAtributos", "perfilAtributos", "perfilProyectos", "perfilColega"]) {
    assert.equal(pagina.porId(id), undefined, `#${id} no debería existir`);
  }
  assert.equal(porClase(pagina.raiz, "colaboradores__segmento").length, 0, "no quedan barras de atributos");

  const texto = pagina.raiz.textContent;
  for (const retirado of ["Contactar", "Suele trabajar con", "Proyectos", "Atributos", "Sin selección"]) {
    assert.ok(!texto.includes(retirado), `la página todavía dice "${retirado}"`);
  }
});

/* ---------- Perfil en el hash ---------- */

test("loading with a profile hash shows that profile without moving focus or adding history", async () => {
  const mariana = indicePorSlug(MUESTRA, "mariana");
  assert.notEqual(mariana, -1, "premisa: hay una ficha con el slug mariana");

  const pagina = await cargarPagina({ hash: "#/mariana" });

  assertPerfilDe(pagina, mariana);
  assert.equal(pagina.documento.activeElement, null, "cargar la página no mueve el foco");
  assert.equal(pagina.hash(), "#/mariana");
  assert.equal(pagina.historial(), 1);

  // Mariana también es la selección: quien borra el slug de la barra (y deja
  // el "#") vuelve al roster con su ficha marcada.
  pagina.irA("#");
  assertRosterConSeleccion(pagina, mariana);
});

test("an unknown profile slug falls back to the roster and cleans the hash without adding history", async () => {
  const pagina = await cargarPagina({ hash: "#/nadie" });

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
test("a hash that is not a profile route shows the roster and is left alone", async () => {
  const pagina = await cargarPagina({ hash: "#access_token=abc" });

  assert.equal(pagina.porId("colaboradoresRoster").hidden, false);
  assert.equal(pagina.porId("colaboradoresPerfil").hidden, true);
  assert.equal(pagina.hash(), "#access_token=abc");
  assert.equal(pagina.historial(), 1);
});

/* ---------- Enlaces de contacto ---------- */

test("contact pills: none with the sample data; safe links render with the right href, target and rel", async () => {
  const deMuestra = await cargarPagina();
  deMuestra.fichas()[0].disparar("mouseenter");
  assert.equal(deMuestra.porId("previaEnlaces").hidden, true);
  assert.equal(deMuestra.porId("previaEnlaces").children.length, 0);
  deMuestra.fichas()[0].disparar("click");
  assert.equal(deMuestra.porId("perfilEnlaces").hidden, true);
  assert.equal(deMuestra.porId("perfilEnlaces").children.length, 0);

  const pagina = await cargarPagina({
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
  // De un perfil a otro sin pasar por el roster: tampoco se quedan pegadas.
  pagina.irA(rutaDe(1));
  assert.equal(pagina.porId("perfilEnlaces").hidden, true);
  assert.equal(pagina.porId("perfilEnlaces").children.length, 0);
});

/* ---------- Página a medio montar ---------- */

test("a half-mounted page or missing roster logic leaves the static HTML untouched instead of throwing", async () => {
  let llamadas = 0;
  const servicio = async () => { llamadas += 1; return exito(MUESTRA); };

  let pagina = await cargarPagina({ sinIds: ["colaboradoresPerfil"], servicio });
  // Todo o nada: sin la sección de perfil no se pinta ni una ficha. Esto es lo
  // que distingue a los tests de arriba de un DOM falso que acepta cualquier cosa.
  assert.equal(pagina.porId("colaboradoresGrilla").children.length, 0);
  assert.equal(pagina.texto("previaNombre"), "¿Quién?");
  // Nada quedó conectado: ni el hash ni el reintento. Y la lista ni se pidió:
  // no había dónde pintarla.
  assert.deepEqual(pagina.porId("colaboradoresReintentar").listeners, {});
  assert.equal(pagina.oyentesDeHash(), 0);
  assert.equal(llamadas, 0);

  pagina = await cargarPagina({ sinDatos: true, servicio });
  assert.equal(pagina.porId("colaboradoresGrilla").children.length, 0);
  assert.equal(pagina.texto("previaNombre"), "¿Quién?");
  assert.equal(pagina.porId("colaboradoresAviso").hidden, true);
  assert.equal(llamadas, 0);
});

/* ---------- Carga de la lista ---------- */

test("while the list loads the grid is busy and the notice says it is loading", async () => {
  const respuesta = diferido();
  const pagina = abrirPagina({ servicio: () => respuesta.promesa });

  assert.equal(pagina.porId("colaboradoresGrilla").getAttribute("aria-busy"), "true");
  assertAviso(pagina, CARGANDO, { reintentar: false });
  assert.equal(pagina.fichas().length, 0);

  respuesta.resolver(exito(MUESTRA));
  await pagina.iniciada;

  assertSinAviso(pagina);
  assert.equal(pagina.porId("colaboradoresGrilla").getAttribute("aria-busy"), "false");
  assert.equal(pagina.fichas().length, MUESTRA.length);
});

// Un enlace compartido que llega mientras la lista carga se resuelve al cargar,
// no antes: con la lista vacía, #/mariana se habría limpiado por desconocido.
test("a profile hash present while loading opens once the list arrives", async () => {
  const respuesta = diferido();
  const pagina = abrirPagina({ servicio: () => respuesta.promesa, hash: "#/mariana" });

  assert.equal(pagina.hash(), "#/mariana", "no se limpia antes de saber quién existe");
  respuesta.resolver(exito(MUESTRA));
  await pagina.iniciada;

  assertPerfilDe(pagina, indicePorSlug(MUESTRA, "mariana"));
  assert.equal(pagina.hash(), "#/mariana");
});

test("a failed load shows the error and an enabled retry button, with no tiles", async () => {
  const pagina = await cargarPagina({ servicio: enSecuencia(FALLO) });

  assertAviso(pagina, ERROR_DE_CARGA, { reintentar: true });
  const boton = pagina.porId("colaboradoresReintentar");
  assert.equal(boton.disabled, false);
  assert.equal(boton.textContent, "Reintentar carga");
  assert.ok(pagina.porId("colaboradoresAviso").classList.contains("colaboradores__aviso--error"));
  assert.equal(pagina.porId("colaboradoresGrilla").getAttribute("aria-busy"), "false");
  assert.equal(pagina.fichas().length, 0);
  assert.equal(pagina.porId("colaboradoresResumen").hidden, true);
});

// Si el script del servicio no llegó, la llamada lanza ReferenceError: la
// página lo trata como cualquier otro fallo de carga.
test("a missing service script shows the load error instead of throwing", async () => {
  const pagina = await cargarPagina({ sinServicio: true });

  assertAviso(pagina, ERROR_DE_CARGA, { reintentar: true });
  assert.equal(pagina.fichas().length, 0);
});

test("a successful retry renders the tiles and moves focus to the first one", async () => {
  const pagina = await cargarPagina({ servicio: enSecuencia(FALLO, exito(MUESTRA)) });
  const boton = pagina.porId("colaboradoresReintentar");
  boton.focus();

  const reintento = pagina.reintentar();
  // Mientras vuelve a cargar: aviso de carga y el botón no responde.
  assert.equal(boton.disabled, true);
  assert.equal(pagina.texto("colaboradoresAvisoMensaje"), CARGANDO);
  assert.equal(pagina.porId("colaboradoresGrilla").getAttribute("aria-busy"), "true");
  await reintento;

  assertSinAviso(pagina);
  assert.equal(pagina.fichas().length, MUESTRA.length);
  assert.equal(pagina.porId("colaboradoresResumen").hidden, false);
  // El botón que tenía el foco se ocultó con el aviso: el foco no cae al <body>.
  assertFocoEn(pagina, pagina.fichas()[0]);
});

test("a failed retry keeps the error and moves focus to the notice", async () => {
  const pagina = await cargarPagina({ servicio: enSecuencia(FALLO, FALLO) });
  pagina.porId("colaboradoresReintentar").focus();

  await pagina.reintentar();

  assertAviso(pagina, ERROR_DE_CARGA, { reintentar: true });
  assert.equal(pagina.porId("colaboradoresReintentar").disabled, false);
  assertFocoEn(pagina, pagina.porId("colaboradoresAviso"));
});

// Con un enlace a un perfil en la barra, el reintento exitoso abre ese perfil:
// la grilla queda oculta y el foco va a lo primero que hay que leer.
test("a retry that lands on a shared profile link moves focus to the profile name", async () => {
  const pagina = await cargarPagina({ servicio: enSecuencia(FALLO, exito(MUESTRA)), hash: "#/mariana" });
  assert.equal(pagina.hash(), "#/mariana", "un fallo de carga no limpia el enlace");

  await pagina.reintentar();

  assertPerfilDe(pagina, indicePorSlug(MUESTRA, "mariana"));
  assertFocoEn(pagina, pagina.porId("perfilNombre"));
});

// Si el enlace era de alguien sin ficha y no es la primera ficha, el foco va a
// SU ficha: enfocar la primera la pondría en la vista previa por encima de la
// elegida, y Enter activaría a otra persona.
test("a retry that lands on a no-profile link focuses that person's tile, not the first one", async () => {
  const pagina = await cargarPagina({ servicio: enSecuencia(FALLO, exito([MUESTRA[0], SAMAEL])), hash: "#/samael" });
  pagina.porId("colaboradoresReintentar").focus();

  await pagina.reintentar();

  const [, fichaSamael] = pagina.fichas();
  assert.equal(fichaSamael.getAttribute("aria-current"), "true");
  assertFocoEn(pagina, fichaSamael);
  assertVistaPreviaSoloNombre(pagina, SAMAEL);
});

test("an empty list shows its own message, no tiles and no retry", async () => {
  const pagina = await cargarPagina({ servicio: conLista([]) });

  assertAviso(pagina, VACIO, { reintentar: false });
  assert.equal(pagina.porId("colaboradoresAviso").classList.contains("colaboradores__aviso--error"), false);
  assert.equal(pagina.fichas().length, 0);
  assert.equal(pagina.porId("colaboradoresResumen").hidden, true);
  assertVistaPreviaVacia(pagina);
});

test("the hash listener is wired once, on the first successful load", async () => {
  const pagina = await cargarPagina({ servicio: enSecuencia(FALLO, FALLO, exito(MUESTRA)) });
  assert.equal(pagina.oyentesDeHash(), 0, "sin lista no hay perfil que abrir");

  await pagina.reintentar();
  assert.equal(pagina.oyentesDeHash(), 0);

  await pagina.reintentar();
  assert.equal(pagina.oyentesDeHash(), 1);

  // Una carga más (la última respuesta se repite) no suma otro oyente.
  await pagina.reintentar();
  assert.equal(pagina.oyentesDeHash(), 1);

  // Y ese único oyente atiende el hash: abrir y volver funcionan una vez cargada.
  pagina.irA(rutaDe(4));
  assertPerfilDe(pagina, 4);
  pagina.atras();
  assertRosterConSeleccion(pagina, 4);
});

/* ---------- Personas sin ficha de perfil ---------- */

test("a tile without profile data only gets selected: no hash, name-only preview, no profile card", async () => {
  const pagina = await cargarPagina({ servicio: conLista([SAMAEL]) });
  const [ficha] = pagina.fichas();

  // Sin rol que agregar, el nombre accesible es sólo el nombre.
  assert.equal(ficha.getAttribute("aria-label"), SAMAEL.nombre);
  // Nadie tiene ficha: la tarjeta de perfil del roster no aparece.
  assert.equal(pagina.porId("colaboradoresResumen").hidden, true);

  ficha.focus();
  ficha.disparar("click");

  assert.equal(pagina.hash(), "");
  assert.equal(pagina.historial(), 1, "elegir no agrega entradas al historial");
  assert.equal(pagina.porId("colaboradoresRoster").hidden, false);
  assert.equal(pagina.porId("colaboradoresPerfil").hidden, true);
  assert.equal(ficha.getAttribute("aria-current"), "true");
  assert.ok(ficha.classList.contains("colaboradores__ficha--seleccionada"));
  assertFocoEn(pagina, ficha);

  // Ya sin foco ni cursor, la vista previa vuelve a la elegida: sólo el nombre.
  ficha.disparar("blur");
  assertVistaPreviaSoloNombre(pagina, SAMAEL);
  assert.equal(pagina.porId("colaboradoresResumen").hidden, true);
});

test("a profile hash of a person without profile data selects them, stays in the roster and cleans the hash", async () => {
  const pagina = await cargarPagina({ servicio: conLista([SAMAEL]), hash: "#/samael" });

  assert.equal(pagina.porId("colaboradoresRoster").hidden, false);
  assert.equal(pagina.porId("colaboradoresPerfil").hidden, true);
  assert.equal(pagina.fichas()[0].getAttribute("aria-current"), "true");
  assertVistaPreviaSoloNombre(pagina, SAMAEL);
  assert.equal(pagina.hash(), "");
  assert.equal(pagina.url(), URL_DE_LA_PAGINA, "se limpia sólo el hash: la ruta queda");
  assert.equal(pagina.historial(), 1, "limpiar reemplaza la entrada, no agrega otra");
  assert.equal(pagina.documento.activeElement, null, "cargar la página no mueve el foco");
});

/*
  Con al menos una ficha de perfil en la lista, la tarjeta aparece y se queda:
  prenderla y apagarla según la ficha bajo el cursor haría saltar la grilla.
*/
test("in a mixed list the profile card shows and stays while the preview follows each person", async () => {
  const lista = [MUESTRA[0], SAMAEL];
  const pagina = await cargarPagina({ servicio: conLista(lista) });
  const [conPerfil, sinPerfil] = pagina.fichas();
  const resumen = pagina.porId("colaboradoresResumen");

  assert.equal(resumen.hidden, false);
  assert.equal(conPerfil.getAttribute("aria-label"), `${MUESTRA[0].nombre}, ${MUESTRA[0].rol}`);
  assert.equal(sinPerfil.getAttribute("aria-label"), SAMAEL.nombre);

  sinPerfil.disparar("mouseenter");
  assertVistaPreviaSoloNombre(pagina, SAMAEL);
  assert.equal(resumen.hidden, false);

  sinPerfil.disparar("mouseleave");
  conPerfil.disparar("mouseenter");
  assertVistaPreviaDe(pagina, 0, lista);
  assert.equal(resumen.hidden, false);

  // Quien sí tiene ficha abre su perfil como siempre.
  conPerfil.disparar("click");
  assert.equal(pagina.hash(), rutaDe(0));
  assertPerfilDe(pagina, 0, lista);
});
