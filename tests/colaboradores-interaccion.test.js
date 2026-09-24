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
  MODALIDADES_TRABAJO,
  numeroDeFicha,
  indicePorSlug,
  experienciaDesde,
  enlacesDisponibles,
} = require(path.join(ROOT, CARPETA, "colaboradores.datos.js"));
const { COLABORADORES_MUESTRA: MUESTRA } = require("./fixtures/colaboradores.muestra.js");

const rutaDe = (indice) => `#/${MUESTRA[indice].slug}`;

// Los campos de ficha (0039/0040/0041) de quien todavía no la llenó: el RPC
// hace left join y el servicio los entrega en null.
const FICHA_EN_NULL = Object.freeze({
  puesto: null,
  sector: null,
  ubicacion: null,
  herramientas: null,
  modalidad_trabajo: null,
  anio_inicio: null,
  bio: null,
  linkedin: null,
  github: null,
  correo: null,
});

// Lo que entrega el servicio para alguien sin ficha: su nombre, su slug y la
// ficha en null.
const SAMAEL = Object.freeze({ nombre: "Samael Flores", corto: "Samael", slug: "samael", ...FICHA_EN_NULL });

// La experiencia se calcula con el año en curso, igual que la página.
const experienciaDe = (ficha) => experienciaDesde(ficha.anio_inicio, new Date().getFullYear());

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

/* ---------- Identidad de quien mira ---------- */

// Lo que la página consulta, después de cargar la lista, para saber si quien
// mira es alguien del roster: los dos globales de auth.service.js.
const SESION = Object.freeze({ user: { id: "u-1" } });
const perfilDe = (slug) => ({ nombre: "Quien mira", es_colaborador: true, slug });

const comoFuncion = (valor) => (typeof valor === "function" ? valor : async () => valor);

/*
  La identidad se resuelve DESPUÉS de la lista y sin bloquearla, así que no la
  cubre la promesa de la primera carga. Un salto a la cola de macrotareas deja
  correr todas las microtareas pendientes (las promesas de los dobles de auth)
  antes de mirar el DOM.
*/
const esperarIdentidad = () => new Promise((resolve) => setImmediate(resolve));

function muestraConRetoques(retoques) {
  const lista = structuredClone(MUESTRA);
  for (const [indice, campos] of Object.entries(retoques)) Object.assign(lista[indice], campos);
  return lista;
}

/*
  El servicio REAL, corrido en su propio vm contra un RPC falso que responde
  con estas filas. Así la página recibe exactamente lo que arma el servicio con
  lo que devuelve la base, y no una ficha escrita a mano con la forma que el
  test cree que tiene.
*/
const SERVICIO = fs.readFileSync(path.join(ROOT, "src/app/core/colaboradores/colaboradores.service.js"), "utf8");

function servicioReal(filas) {
  const contexto = {
    console: { error() {} },
    supabaseClient: { rpc: async () => ({ data: structuredClone(filas), error: null }) },
  };
  vm.runInNewContext(SERVICIO, contexto);
  return contexto.listarColaboradores;
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

// El primer descendiente con esa etiqueta, o null. El DOM falso no tiene
// querySelector: sólo lo que la página de verdad usa. `tagName` va en
// mayúsculas, como en el navegador.
function porEtiqueta(raiz, etiqueta) {
  let hallado = null;
  recorrer(raiz, (nodo) => { if (!hallado && nodo.tagName === etiqueta.toUpperCase()) hallado = nodo; });
  return hallado;
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
    auth         con qué resuelve la página quién está mirando: { sesion,
                 perfil }. Cada uno puede ser el valor que devuelven o una
                 función (para fallar, demorar o contar llamadas). Por
                 defecto, visitante anónimo.
    sinAuth      no hay obtenerSesion ni obtenerPerfil (su script no llegó).
*/
function abrirPagina({
  sinIds = [],
  servicio,
  retoques = {},
  sinDatos = false,
  sinServicio = false,
  hash = "",
  auth = {},
  sinAuth = false,
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
  if (!sinAuth) {
    contexto.obtenerSesion = comoFuncion(auth.sesion ?? null);
    contexto.obtenerPerfil = comoFuncion(auth.perfil ?? null);
  }
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

// Lo mismo, pero esperando también a que se resuelva quién está mirando.
async function cargarPaginaConIdentidad(opciones) {
  const pagina = await cargarPagina(opciones);
  await esperarIdentidad();
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
  assert.equal(pagina.texto("previaRol"), ficha.puesto);
  assert.equal(pagina.porId("previaRol").hidden, false);
  assert.equal(pagina.texto("previaBio"), ficha.bio);
  assert.equal(pagina.porId("previaBio").classList.contains("colaboradores__bio--vacia"), false);
}

/*
  Qué ficha está ENCENDIDA (`--activa`), o `null` si ninguna. La enciende sólo
  el cursor: con teclado el resplandor lo pone `:focus-visible` en la hoja, que
  el navegador prende al tabular y no al llegar con el mouse. Por eso la vista
  previa puede estar mostrando a alguien sin que ninguna ficha esté encendida.
*/
function assertFichaEncendida(pagina, indice) {
  const encendidas = pagina.fichas()
    .flatMap((boton, i) => (boton.classList.contains("colaboradores__ficha--activa") ? [i] : []));
  assert.deepEqual(encendidas, indice === null ? [] : [indice]);
}

// Ninguna ficha queda marcada como "la actual": la elección no se anuncia ni
// se pinta, sólo decide a quién vuelve la vista previa.
function assertSinMarcaPegada(pagina) {
  assert.deepEqual(
    pagina.fichas().map((boton) => boton.getAttribute("aria-current")),
    pagina.fichas().map(() => null),
  );
  assert.ok(
    pagina.fichas().every((boton) => !boton.classList.contains("colaboradores__ficha--seleccionada")),
    "la clase de la ficha elegida ya no existe",
  );
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
  assert.equal(pagina.texto("perfilPuesto"), ficha.puesto);
  assert.equal(pagina.texto("perfilSector"), ficha.sector);
  assert.equal(pagina.texto("perfilUbicacion"), ficha.ubicacion);
  assert.equal(pagina.texto("perfilExperiencia"), experienciaDe(ficha));
  assert.equal(pagina.texto("perfilModalidadTrabajo"), ficha.modalidad_trabajo);
  for (const campo of ["herramientas", "habilidades", "idiomas"]) {
    assert.deepEqual(etiquetasDe(pagina, campo), ficha[campo], campo);
  }
  assert.equal(pagina.texto("perfilBio"), ficha.bio);
}

// El texto de las etiquetas pintadas de una de las tres listas, en orden.
// Los ids del perfil siguen el nombre del campo: #perfilHerramientas,
// #perfilHabilidades, #perfilIdiomas.
function etiquetasDe(pagina, campo) {
  const id = `perfil${campo[0].toUpperCase()}${campo.slice(1)}`;
  return porClase(pagina.porId(id), "colaboradores__etiquetas-item").map((etiqueta) => etiqueta.textContent);
}

/*
  De vuelta en el roster, la ficha que se estaba viendo recibe el FOCO y con él
  manda en la vista previa. Nada más: sin cursor encima no hay ficha encendida
  y no queda ninguna marca pegada, que es justo lo que se veía antes al volver.
*/
function assertRosterConSeleccion(pagina, indice) {
  assert.equal(pagina.porId("colaboradoresRoster").hidden, false);
  assert.equal(pagina.porId("colaboradoresPerfil").hidden, true);
  assertFocoEn(pagina, pagina.fichas()[indice]);
  assertFichaEncendida(pagina, null);
  assertSinMarcaPegada(pagina);
  assertVistaPreviaDe(pagina, indice);
}

/* ---------- Roster ---------- */

test("renders one tile button per collaborator, named with full name and role", async () => {
  const pagina = await cargarPagina();
  const celdas = pagina.porId("colaboradoresGrilla").children;

  assert.equal(celdas.length, MUESTRA.length);
  celdas.forEach((celda, indice) => {
    assert.equal(celda.tagName, "LI");
    // La ficha y, detrás, su enlace a "Mi ficha": oculto salvo en la ficha de
    // quien mira, y acá el visitante es anónimo.
    assert.deepEqual(celda.children.map((hijo) => hijo.tagName), ["BUTTON", "A"]);
    assert.equal(celda.children[1].hidden, true);
    const boton = celda.children[0];
    assert.equal(boton.tagName, "BUTTON");
    assert.equal(boton.type, "button");
    const nombreAccesible = boton.getAttribute("aria-label");
    assert.ok(nombreAccesible.includes(MUESTRA[indice].nombre), nombreAccesible);
    assert.ok(nombreAccesible.includes(MUESTRA[indice].puesto), nombreAccesible);
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
  assertFichaEncendida(pagina, 3);

  // Pasar a otra ficha sin mouseleave intermedio cambia la vista previa.
  fichas[8].disparar("mouseenter");
  assertVistaPreviaDe(pagina, 8);
  assertFichaEncendida(pagina, 8);

  // El mouseleave atrasado de la ficha anterior no apaga a la actual.
  fichas[3].disparar("mouseleave");
  assertVistaPreviaDe(pagina, 8);
  assertFichaEncendida(pagina, 8);

  fichas[8].disparar("mouseleave");
  assertVistaPreviaVacia(pagina);
  assertFichaEncendida(pagina, null);
  // Hover nunca abre el perfil.
  assert.equal(pagina.porId("colaboradoresPerfil").hidden, true);
});

/*
  El foco mueve la vista previa igual que el cursor, pero NO enciende la ficha:
  el resplandor del teclado lo pone `:focus-visible` en la hoja. Así el
  script no tiene que adivinar si el foco llegó con Tab o con un clic — eso lo
  sabe el navegador— y al volver de un perfil con el mouse no queda nada
  encendido.
*/
test("focusing a tile previews it like hover does, and blur clears it", async () => {
  const pagina = await cargarPagina();
  const fichas = pagina.fichas();

  fichas[5].focus();
  assertFocoEn(pagina, fichas[5]);
  assertVistaPreviaDe(pagina, 5);
  assertFichaEncendida(pagina, null);

  // Tab a la siguiente: blur de una + focus de la otra.
  fichas[6].focus();
  assertVistaPreviaDe(pagina, 6);
  assertFichaEncendida(pagina, null);

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
  assertFichaEncendida(pagina, 5);
  fichas[5].disparar("mouseleave");
  assertVistaPreviaDe(pagina, 5);
  // La sigue mostrando por el foco, pero ya sin cursor no está encendida.
  assertFichaEncendida(pagina, null);

  // El cursor manda mientras está encima de OTRA ficha, y al irse la vista
  // vuelve a la que tiene el foco, no al vacío.
  fichas[2].disparar("mouseenter");
  assertVistaPreviaDe(pagina, 2);
  assertFichaEncendida(pagina, 2);
  fichas[2].disparar("mouseleave");
  assertVistaPreviaDe(pagina, 5);
  assertFichaEncendida(pagina, null);

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
  // Índice 2 es "Híbrido": cubre también un valor de modalidad distinto de "Remoto".
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

/*
  La base guarda el año de inicio, no un texto: la experiencia se calcula al
  pintar con el año en curso. El esperado sale de la misma función pura y,
  para no probar la función contra sí misma, también del texto literal.
*/
test("the profile shows the experience computed from anio_inicio and the current year", async () => {
  const anioActual = new Date().getFullYear();
  // [índice de la ficha, años desde que empezó, texto esperado]
  const casos = [[0, 8, "8 años"], [1, 1, "1 año"], [2, 0, "Menos de un año"]];
  const retoques = Object.fromEntries(
    casos.map(([indice, anios]) => [indice, { anio_inicio: anioActual - anios }]),
  );
  const pagina = await cargarPagina({ retoques });

  for (const [indice, anios, esperado] of casos) {
    pagina.irA(rutaDe(indice));
    assert.equal(pagina.porId("colaboradoresPerfil").hidden, false);
    assert.equal(pagina.texto("perfilExperiencia"), experienciaDesde(anioActual - anios, anioActual));
    assert.equal(pagina.texto("perfilExperiencia"), esperado);
  }
});



test("the profile shows the tools as one tag per technology", async () => {
  const pagina = await cargarPagina();

  pagina.fichas()[0].disparar("click");
  assert.deepEqual(etiquetasDe(pagina, "herramientas"), ["PostgreSQL", "Python", "GCP"]);

  // Un solo elemento sigue siendo una sola etiqueta.
  const conUno = await cargarPagina({ retoques: { 0: { herramientas: ["Python"] } } });
  conUno.fichas()[0].disparar("click");
  assert.deepEqual(etiquetasDe(conUno, "herramientas"), ["Python"]);
});

/*
  El bug que motivó el cambio: con el separador " · " era imposible saber si
  un punto medio separaba tecnologías o era parte del nombre de una. Una
  tecnología que TRAE un punto medio en su propio texto tiene que quedar como
  UNA sola etiqueta, no partirse en dos.
*/
test("a technology name that contains a middle dot stays as a single tag", async () => {
  const conPuntoMedio = await cargarPagina({
    retoques: { 0: { herramientas: ["System Architecture (GCloud · Supabase)", "Python"] } },
  });

  conPuntoMedio.fichas()[0].disparar("click");
  assert.deepEqual(
    etiquetasDe(conPuntoMedio, "herramientas"),
    ["System Architecture (GCloud · Supabase)", "Python"],
  );
});

/*
  La empresa: con enlace válido el nombre es clicable, sin enlace queda como
  texto plano, y sin nombre se oculta la celda entera.

  El cuarto caso es el que de verdad vale: un `empresa_enlace` que la base
  nunca habría aceptado —porque llegó por otro camino, o porque el CHECK
  cambió— tiene que DEGRADAR a texto plano, nunca pintar el <a>. Es el que
  falla si alguien "simplifica" empresaDelPerfil() más adelante.
*/
test("the company name links out only when its link passes the whitelist", async () => {
  const anclaDeEmpresa = (pagina) => porEtiqueta(pagina.porId("perfilEmpresa"), "a");

  const conEnlace = await cargarPagina();
  conEnlace.fichas()[0].disparar("click");
  assert.equal(conEnlace.porId("perfilEmpresaCelda").hidden, false);
  assert.equal(conEnlace.texto("perfilEmpresa"), "Taudux");
  const ancla = anclaDeEmpresa(conEnlace);
  assert.ok(ancla, "con enlace válido el nombre tiene que ser clicable");
  assert.equal(ancla.href, "https://taudux.com");
  assert.equal(ancla.target, "_blank");
  assert.equal(ancla.rel, "noopener noreferrer");

  const sinEnlace = await cargarPagina();
  sinEnlace.fichas()[1].disparar("click");
  assert.equal(sinEnlace.porId("perfilEmpresaCelda").hidden, false);
  assert.equal(sinEnlace.texto("perfilEmpresa"), "Nube Verde");
  assert.equal(anclaDeEmpresa(sinEnlace), null, "sin enlace, texto plano");

  const sinEmpresa = await cargarPagina({ retoques: { 0: { empresa: null, empresa_enlace: null } } });
  sinEmpresa.fichas()[0].disparar("click");
  assert.equal(sinEmpresa.porId("perfilEmpresaCelda").hidden, true, "sin nombre, la celda no se ve");
  assert.equal(sinEmpresa.texto("perfilEmpresa"), "");

  for (const enlaceMalo of ["javascript:alert(1)", "http://taudux.com", "https://intranet", "//taudux.com"]) {
    const degradado = await cargarPagina({ retoques: { 0: { empresa_enlace: enlaceMalo } } });
    degradado.fichas()[0].disparar("click");
    assert.equal(degradado.texto("perfilEmpresa"), "Taudux", enlaceMalo);
    assert.equal(anclaDeEmpresa(degradado), null, `${enlaceMalo} no puede terminar en un href`);
  }
});

/*
  Dos perfiles seguidos con el MISMO nombre de empresa, uno con enlace y otro
  sin él. escribir() se salta la escritura cuando el texto no cambió, así que
  pintar con ella dejaría el <a> del anterior pegado, apuntando a otro sitio.
  Por eso pintarEmpresa() reemplaza siempre el contenido.
*/
test("going from a linked company to an unlinked one with the same name drops the anchor", async () => {
  const pagina = await cargarPagina({ retoques: { 1: { empresa: "Taudux", empresa_enlace: null } } });

  pagina.fichas()[0].disparar("click");
  assert.ok(porEtiqueta(pagina.porId("perfilEmpresa"), "a"), "premisa: la primera sí enlaza");

  pagina.irA("#/");
  pagina.fichas()[1].disparar("click");
  assert.equal(pagina.texto("perfilEmpresa"), "Taudux");
  assert.equal(porEtiqueta(pagina.porId("perfilEmpresa"), "a"), null, "el <a> viejo no puede quedar pegado");
});

/*
  El sector también es opcional (0042) y su celda se oculta igual que las de
  empresa, habilidades e idiomas. Lo que lo distingue de todas ellas: el
  sector ANTES era obligatorio y estaba en CAMPOS_DE_TEXTO_DEL_PERFIL, así
  que si volviera, una ficha sin sector no abriría perfil y esta prueba
  fallaría en su primer click, no en el assert de la celda.
*/
test("the sector row hides when there is no sector, and the profile still opens", async () => {
  const pagina = await cargarPagina({ retoques: { 0: { sector: null } } });

  pagina.fichas()[0].disparar("click");

  assert.equal(pagina.porId("perfilSectorCelda").hidden, true, "sin sector, la celda no se ve");
  assert.equal(pagina.texto("perfilSector"), "", "y no queda texto viejo adentro");
  // El resto del perfil se pinta igual: perder el sector no es perder la ficha.
  assert.ok(pagina.texto("perfilPuesto").length > 0);
  assert.ok(pagina.texto("perfilUbicacion").length > 0);

  pagina.irA("#/");
  pagina.fichas()[1].disparar("click");
  assert.equal(pagina.porId("perfilSectorCelda").hidden, false, "con sector, vuelve");
  assert.ok(pagina.texto("perfilSector").length > 0);

  /*
    Y al revés: del perfil CON sector al perfil sin él. Ocultar la celda sin
    limpiar su texto dejaría el sector del anterior guardado adentro, listo
    para aparecer atribuido a la persona equivocada en cuanto algo muestre la
    celda. Es la misma trampa que el <a> pegado de pintarEmpresa().
  */
  pagina.irA("#/");
  pagina.fichas()[0].disparar("click");
  assert.equal(pagina.porId("perfilSectorCelda").hidden, true);
  assert.equal(pagina.texto("perfilSector"), "", "el sector del perfil anterior no puede quedar adentro");
});

/*
  Un sector en blanco no es lo mismo que uno ausente para la base, pero para
  la página sí: los dos dejan la fila sin nada que mostrar. Si escribirEnCelda
  sólo mirara el null, un "   " pintaría una celda vacía con su rótulo.
*/
test("a blank sector hides the row just like a missing one", async () => {
  const pagina = await cargarPagina({ retoques: { 0: { sector: "   " } } });

  pagina.fichas()[0].disparar("click");

  assert.equal(pagina.porId("perfilSectorCelda").hidden, true);
  assert.equal(pagina.texto("perfilSector"), "");
});

/*
  Habilidades e idiomas son opcionales (0041: `between 0 and 12`). Con la
  lista vacía se oculta la CELDA ENTERA, no sólo la <ul>: si se ocultara nada
  más la lista, quedaría el rótulo "HABILIDADES" en versalitas flotando sobre
  el vacío.

  Que el `hidden` gane depende de que la hoja traiga
  `.colaboradores [hidden] { display: none }`: la <ul> declara `display: flex`
  y se lo comería. La celda no tiene display propio, pero la regla igual hace
  falta para la <ul> de adentro, así que se fija acá.
*/
test("optional tag rows hide the whole cell when the list is empty", async () => {
  const pagina = await cargarPagina({
    retoques: { 0: { habilidades: [], idiomas: ["Español"] } },
  });

  pagina.fichas()[0].disparar("click");

  assert.equal(pagina.porId("perfilHabilidadesCelda").hidden, true, "sin habilidades, la celda no se ve");
  assert.equal(pagina.porId("perfilIdiomasCelda").hidden, false, "con idiomas, la celda se ve");
  // La <ul> vacía también se oculta, aunque su celda ya lo esté: sin eso
  // seguiría ocupando su hueco en el flex y anunciándose como "lista, 0
  // elementos" el día que alguien muestre la celda por otro motivo.
  assert.equal(pagina.porId("perfilHabilidades").hidden, true);
  assert.equal(pagina.porId("perfilIdiomas").hidden, false);
  assert.deepEqual(etiquetasDe(pagina, "idiomas"), ["Español"]);

  // Y vuelve a aparecer al abrir un perfil que sí las tiene: el pintado no
  // deja pegado el estado del anterior.
  pagina.irA("#/");
  pagina.fichas()[1].disparar("click");
  assert.equal(pagina.porId("perfilHabilidadesCelda").hidden, false);
  assert.deepEqual(etiquetasDe(pagina, "habilidades"), ["Microservicios"]);
});

/*
  La modalidad de trabajo no tiene bueno ni malo: remoto no es peor que
  presencial. Por eso el valor se escribe tal cual, como texto plano, y
  ningún valor le agrega una clase de estado al nodo (nada de semáforo por
  color).
*/
test("the work modality value is written as plain text and the node gains no class per value", async () => {
  const pagina = await cargarPagina();
  const nodo = pagina.porId("perfilModalidadTrabajo");
  const clasesOriginales = nodo.className;

  for (const modalidad_trabajo of MODALIDADES_TRABAJO) {
    const indice = MUESTRA.findIndex((persona) => persona.modalidad_trabajo === modalidad_trabajo);
    assert.notEqual(indice, -1, `premisa: la muestra tiene a alguien "${modalidad_trabajo}"`);

    pagina.irA(rutaDe(indice));
    assert.equal(pagina.texto("perfilModalidadTrabajo"), modalidad_trabajo);
    assert.equal(nodo.className, clasesOriginales, `${modalidad_trabajo} no debe agregar una clase de estado`);
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

test("contact pills: none for a person without links; safe links render with the right href, target and rel", async () => {
  assert.deepEqual(enlacesDisponibles(MUESTRA[0]), [], "premisa: la ficha 0 no tiene enlaces");
  assert.deepEqual(enlacesDisponibles(MUESTRA[1]), [], "premisa: la ficha 1 no tiene enlaces");

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

test("a sample person with every link shows one pill per link, in a fixed order", async () => {
  const indice = MUESTRA.findIndex((persona) => enlacesDisponibles(persona).length === 3);
  assert.notEqual(indice, -1, "premisa: alguien de la muestra tiene los tres enlaces");
  const ficha = MUESTRA[indice];

  const pagina = await cargarPagina();
  pagina.irA(rutaDe(indice));

  const lista = pagina.porId("perfilEnlaces");
  assert.equal(lista.hidden, false);
  assert.deepEqual(
    lista.children.map((item) => item.children[0].href),
    [ficha.linkedin, ficha.github, `mailto:${ficha.correo}`],
  );
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
  assertFocoEn(pagina, fichaSamael);
  assertVistaPreviaSoloNombre(pagina, SAMAEL);
  assertSinMarcaPegada(pagina);
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
  assertFocoEn(pagina, ficha);
  // La elección no se pinta ni se anuncia: no deja marca en la ficha.
  assertSinMarcaPegada(pagina);
  assertFichaEncendida(pagina, null);

  // Ya sin foco ni cursor, la vista previa vuelve a la elegida: sólo el nombre.
  // Eso es lo único que la elección sigue decidiendo.
  ficha.disparar("blur");
  assertVistaPreviaSoloNombre(pagina, SAMAEL);
  assert.equal(pagina.porId("colaboradoresResumen").hidden, true);
});

test("a profile hash of a person without profile data selects them, stays in the roster and cleans the hash", async () => {
  const pagina = await cargarPagina({ servicio: conLista([SAMAEL]), hash: "#/samael" });

  assert.equal(pagina.porId("colaboradoresRoster").hidden, false);
  assert.equal(pagina.porId("colaboradoresPerfil").hidden, true);
  // Queda elegido sin que se le note: lo único que lo delata es la vista previa.
  assertSinMarcaPegada(pagina);
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
  assert.equal(conPerfil.getAttribute("aria-label"), `${MUESTRA[0].nombre}, ${MUESTRA[0].puesto}`);
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

/*
  De punta a punta, con el servicio real: las filas tal como las devuelve
  `listar_colaboradores()` de la 0041. Quien no llenó su ficha trae los campos
  en null (left join) y sólo se elige; quien la llenó abre su perfil pintado
  con los nombres de la base.
*/
test("rows from the service: a collaborator whose card fields are null only gets selected, one with a card opens", async () => {
  const conFicha = MUESTRA[4];
  const filas = [
    { nombre: "Samael", apellidos: "Flores", slug: "samael", ...FICHA_EN_NULL },
    {
      nombre: "Renata",
      apellidos: "Solís",
      slug: conFicha.slug,
      puesto: conFicha.puesto,
      sector: conFicha.sector,
      ubicacion: conFicha.ubicacion,
      herramientas: [...conFicha.herramientas],
      modalidad_trabajo: conFicha.modalidad_trabajo,
      anio_inicio: conFicha.anio_inicio,
      bio: conFicha.bio,
      linkedin: null,
      github: null,
      correo: null,
      // Lo que el servicio recorta: nunca llega a la página.
      telefono: "+52 442 000 0000",
    },
  ];
  const pagina = await cargarPagina({ servicio: servicioReal(filas) });
  const [sinFicha, renata] = pagina.fichas();

  assert.equal(sinFicha.getAttribute("aria-label"), "Samael Flores");
  assert.equal(pagina.porId("colaboradoresResumen").hidden, false, "alguien de la lista sí tiene ficha");

  sinFicha.disparar("click");
  assert.equal(pagina.hash(), "");
  assert.equal(pagina.historial(), 1, "elegir no agrega entradas al historial");
  assert.equal(pagina.porId("colaboradoresPerfil").hidden, true);
  assertSinMarcaPegada(pagina);
  assertVistaPreviaSoloNombre(pagina, SAMAEL);

  renata.disparar("click");
  assert.equal(pagina.hash(), `#/${conFicha.slug}`);
  assertPerfilDe(pagina, 1, [SAMAEL, conFicha]);
  assert.equal(conFicha.modalidad_trabajo, "Presencial", "premisa: cubre también el valor \"Presencial\"");
  assert.ok(!pagina.raiz.textContent.includes("442"), "el teléfono no llega a la página");
});
/* ---------- "Editar" en la ficha propia ---------- */

/*
  El enlace a "Mi ficha" no está en ningún menú: vive en la esquina de UNA
  ficha del roster, la de quien mira, y ahí se queda. No depende del cursor,
  del foco ni de la selección, y la vista de perfil no lo tiene.
*/
const RUTA_MI_FICHA = "/app/features/colaboradores/mi-ficha/";

// Otra persona sin ficha, para un roster donde NADIE llenó la suya.
const ANA = Object.freeze({ nombre: "Ana Paredes", corto: "Ana", slug: "ana", ...FICHA_EN_NULL });

// Los enlaces de edición de la grilla, en el orden de las fichas: uno por
// celda, montados junto con la lista.
const enlacesDeEdicion = (pagina) => porClase(pagina.porId("colaboradoresGrilla"), "colaboradores__editar");

// Los índices de las fichas que muestran su enlace.
const fichasConEditar = (pagina) =>
  enlacesDeEdicion(pagina).flatMap((enlace, indice) => (enlace.hidden ? [] : [indice]));

test("an anonymous visitor gets no edit link, and their profile is never asked for", async () => {
  let sesiones = 0;
  let perfiles = 0;
  const pagina = await cargarPaginaConIdentidad({
    auth: {
      sesion: async () => { sesiones += 1; return null; },
      perfil: async () => { perfiles += 1; return perfilDe(MUESTRA[0].slug); },
    },
  });

  assert.equal(sesiones, 1, "la sesión se consulta una vez, al cargar la lista");
  assert.equal(perfiles, 0, "sin sesión no hay perfil que pedir");
  assert.deepEqual(fichasConEditar(pagina), []);

  pagina.fichas()[0].disparar("mouseenter");
  assert.deepEqual(fichasConEditar(pagina), [], "el cursor no lo hace aparecer");
});

// Con sesión pero sin cuenta colaboradora —o sin un slug con el que comparar—
// no hay ficha propia que editar. Sólo el `true` de la columna cuenta.
test("a signed-in visitor who does not collaborate gets no edit link", async () => {
  const slug = MUESTRA[0].slug;
  for (const perfil of [
    null,
    { nombre: "X", es_colaborador: false, slug },
    { nombre: "X", es_colaborador: "true", slug },
    { nombre: "X", es_colaborador: true, slug: null },
    { nombre: "X", es_colaborador: true, slug: "   " },
  ]) {
    const pagina = await cargarPaginaConIdentidad({ auth: { sesion: SESION, perfil } });

    pagina.fichas()[0].disparar("mouseenter");
    assert.deepEqual(fichasConEditar(pagina), [], JSON.stringify(perfil));
  }
});

/*
  El enlace va en la CELDA y no dentro del botón: un <a> dentro de un <button>
  es HTML inválido. Queda detrás de él en el orden de tabulación —la ficha es
  la acción principal de la celda— y la hoja lo apila en la esquina.
*/
test("the edit link sits in the collaborator's own tile and stays put", async () => {
  const yo = 3;
  const pagina = await cargarPaginaConIdentidad({ auth: { sesion: SESION, perfil: perfilDe(MUESTRA[yo].slug) } });
  const fichas = pagina.fichas();

  assert.deepEqual(fichasConEditar(pagina), [yo]);

  const enlace = enlacesDeEdicion(pagina)[yo];
  assert.equal(enlace.href, RUTA_MI_FICHA);
  assert.equal(enlace.textContent, "Editar");
  assert.equal(enlace.getAttribute("aria-label"), "Editar mi ficha");

  const celda = pagina.porId("colaboradoresGrilla").children[yo];
  assert.deepEqual(celda.children.map((hijo) => hijo.tagName), ["BUTTON", "A"]);
  assert.ok(enlace.parent === celda, "el enlace cuelga de la celda, nunca del botón");

  // Ni el cursor, ni el foco, ni la selección lo mueven de ahí.
  fichas[7].disparar("mouseenter");
  assert.deepEqual(fichasConEditar(pagina), [yo]);
  fichas[7].disparar("mouseleave");
  fichas[7].focus();
  assert.deepEqual(fichasConEditar(pagina), [yo]);
  fichas[yo].disparar("mouseenter");
  assert.deepEqual(fichasConEditar(pagina), [yo]);
});

// El enlace se suma a la ficha sin quitarle nada: el clic sigue abriendo el
// perfil, que no tiene enlace propio.
test("clicking the tile still opens the profile, which has no edit link of its own", async () => {
  const yo = 3;
  const pagina = await cargarPaginaConIdentidad({ auth: { sesion: SESION, perfil: perfilDe(MUESTRA[yo].slug) } });

  pagina.fichas()[yo].disparar("click");

  assert.equal(pagina.hash(), rutaDe(yo));
  assertPerfilDe(pagina, yo);
  assert.equal(
    porClase(pagina.porId("colaboradoresPerfil"), "colaboradores__editar").length,
    0,
    "el perfil no tiene enlace de editar",
  );

  pagina.atras();
  assertRosterConSeleccion(pagina, yo);
  assert.deepEqual(fichasConEditar(pagina), [yo]);
});

/*
  El caso que importa: el PRIMER colaborador que entra a llenar su ficha. Nadie
  del roster tiene ficha —él tampoco—, así que no hay perfil que abrir ni
  tarjeta de resumen que mostrar; el enlace en su ficha es su única puerta.
*/
test("a collaborator with no card yet gets the edit link in their own tile", async () => {
  const pagina = await cargarPaginaConIdentidad({
    servicio: conLista([SAMAEL, ANA]),
    auth: { sesion: SESION, perfil: perfilDe(SAMAEL.slug) },
  });
  const [mia] = pagina.fichas();

  assert.equal(pagina.porId("colaboradoresResumen").hidden, true, "nadie tiene ficha: no hay tarjeta");
  assert.deepEqual(fichasConEditar(pagina), [0]);

  mia.disparar("click");
  assert.equal(pagina.porId("colaboradoresPerfil").hidden, true, "sin ficha no hay perfil que abrir");
  assertVistaPreviaSoloNombre(pagina, SAMAEL);
  assert.deepEqual(fichasConEditar(pagina), [0]);
});

// El enlace es un extra: nada de lo que pase al averiguar quién mira puede
// tumbar la página ni dejarla a medio pintar.
test("a failing identity lookup leaves the page working with no edit link", async () => {
  const caer = async () => { throw new Error("sin red"); };

  for (const auth of [
    { sesion: caer },
    { sesion: SESION, perfil: caer },
  ]) {
    const pagina = await cargarPaginaConIdentidad({ auth });

    assert.equal(pagina.fichas().length, MUESTRA.length);
    assertSinAviso(pagina);
    pagina.fichas()[0].disparar("mouseenter");
    assertVistaPreviaDe(pagina, 0);
    assert.deepEqual(fichasConEditar(pagina), []);
  }

  // Y si el script de auth no llegó, llamarlo lanza ReferenceError: lo mismo.
  const pagina = await cargarPaginaConIdentidad({ sinAuth: true });
  assert.equal(pagina.fichas().length, MUESTRA.length);
  pagina.fichas()[1].disparar("click");
  assertPerfilDe(pagina, 1);
  assert.deepEqual(fichasConEditar(pagina), []);
});

// La lista NO espera a la identidad: el roster se pinta con lo que ya tiene y
// el enlace se suma a su ficha cuando se sabe quién mira.
test("the roster paints without waiting for the identity and the link appears when it arrives", async () => {
  const yo = 4;
  const identidad = diferido();
  const pagina = await cargarPagina({
    auth: { sesion: SESION, perfil: () => identidad.promesa },
  });

  assert.equal(pagina.fichas().length, MUESTRA.length);
  assertSinAviso(pagina);
  pagina.fichas()[yo].disparar("mouseenter");
  assertVistaPreviaDe(pagina, yo);
  assert.deepEqual(fichasConEditar(pagina), [], "mientras no se sepa quién mira, no es la ficha de nadie");

  identidad.resolver(perfilDe(MUESTRA[yo].slug));
  await esperarIdentidad();

  // Aparece sola, sin mover la vista previa ni la selección.
  assert.deepEqual(fichasConEditar(pagina), [yo]);
  assertVistaPreviaDe(pagina, yo);
});

/*
  Un enlace compartido (#/<mi-slug>) abre el PERFIL: la identidad se resuelve
  con el roster oculto. El enlace tiene que quedar puesto igual — si el pintado
  de la identidad diera por sentado que el roster está a la vista, o capturara
  la vista al salir a preguntar, esto se rompería en silencio.
*/
test("an identity resolved while a shared profile is open still lands the link in the tile", async () => {
  const yo = 6;
  const identidad = diferido();
  const pagina = await cargarPagina({
    hash: rutaDe(yo),
    auth: { sesion: SESION, perfil: () => identidad.promesa },
  });

  assertPerfilDe(pagina, yo);
  assert.deepEqual(fichasConEditar(pagina), []);

  identidad.resolver(perfilDe(MUESTRA[yo].slug));
  await esperarIdentidad();

  // Nada se movió: el mismo perfil abierto, sin tocar el hash ni el foco.
  assertPerfilDe(pagina, yo);
  assert.equal(pagina.hash(), rutaDe(yo));
  assert.equal(pagina.historial(), 1);
  assert.equal(pagina.documento.activeElement, null);
  // Y el enlace ya espera en su ficha, debajo del perfil.
  assert.deepEqual(fichasConEditar(pagina), [yo]);

  pagina.irA("#");
  assertRosterConSeleccion(pagina, yo);
  assert.deepEqual(fichasConEditar(pagina), [yo]);
});
