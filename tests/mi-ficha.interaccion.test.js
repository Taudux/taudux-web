/*
  Tests de COMPORTAMIENTO de "Mi ficha". A diferencia de mi-ficha.pagina.test.js
  (que sólo lee los fuentes), acá se EJECUTAN mi-ficha.logica.js, el auth-ui.js
  real (de ahí sale establecerFormularioOcupado) y mi-ficha.js dentro de un vm,
  contra un DOM falso armado a partir del index.html real. Toda aserción es
  sobre estado observable del DOM (texto, hidden, atributos, foco) o sobre lo
  que la página le pidió a los servicios, nunca sobre el texto del script.

  Los servicios (auth.service, ficha.service) y el toast son falsos que se
  inyectan en el vm: cada uno anota con qué se lo llamó.
*/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const leer = (relativo) => fs.readFileSync(path.join(ROOT, relativo), "utf8");

const CARPETA = "src/app/features/colaboradores/mi-ficha";
const HTML = leer(`${CARPETA}/index.html`);
const LOGICA = leer(`${CARPETA}/mi-ficha.logica.js`);
const LOGICA_STACK = leer(`${CARPETA}/mi-ficha.stack.logica.js`);
const PAGINA = leer(`${CARPETA}/mi-ficha.js`);
const AUTH_UI = leer("src/app/features/auth/auth-ui.js");

// El lado "esperado" de cada comparación sale de la misma lógica que corre en
// el vm.
const { CAMPOS_MI_FICHA, validarMiFicha } = require(`../${CARPETA}/mi-ficha.logica.js`);

const CARGANDO = "Cargando tu ficha…";
const ERROR_DE_CUENTA = "No se pudo cargar tu cuenta. Intenta de nuevo.";
const ERROR_DE_PAGINA = "No se pudo cargar la página. Recárgala para intentar de nuevo.";
const SOLO_COLABORADORES = "Esta sección es sólo para colaboradores.";

const SESION = Object.freeze({ user: Object.freeze({ id: "u-1" }) });

// Lo que devuelve obtenerPerfil() para una colaboradora (auth.service.js).
const PERFIL = Object.freeze({
  nombre: "Valeria",
  apellidos: "Ortiz",
  telefono: null,
  rol: "usuario",
  avisos_curso_nuevo: false,
  es_colaborador: true,
  slug: "valeria",
});
const NO_COLABORADOR = Object.freeze({ ...PERFIL, es_colaborador: false, slug: null });

// Una ficha como la devuelve obtenerMiFicha(): las diez columnas.
const FICHA = Object.freeze({
  rol: "Desarrolladora backend",
  especialidad: "Bases de datos",
  ubicacion: "Querétaro, México",
  stack: Object.freeze(["PostgreSQL", "Python", "GCP"]),
  disponibilidad: "Parcial",
  anio_inicio: 2018,
  bio: "Diseño esquemas y migraciones.\nMe gusta que los datos cuadren.",
  linkedin: "https://www.linkedin.com/in/valeria-ortiz",
  github: null,
  correo: null,
});

const exito = (data) => ({ ok: true, data });
const FALLO_AL_CARGAR = Object.freeze({ ok: false, mensaje: "No se pudo cargar tu ficha. Intenta de nuevo." });
const FALLO_AL_GUARDAR = Object.freeze({ ok: false, mensaje: "Revisa tu ficha: algún dato no tiene el formato esperado." });

// Los ids de cada campo de texto, en el orden de la ficha.
const ID_DE = Object.freeze({
  rol: "miFichaRol",
  especialidad: "miFichaEspecialidad",
  ubicacion: "miFichaUbicacion",
  stack: "miFichaStack",
  anio_inicio: "miFichaAnioInicio",
  bio: "miFichaBio",
  linkedin: "miFichaLinkedin",
  github: "miFichaGithub",
  correo: "miFichaCorreo",
});
const RADIOS = Object.freeze({ Disponible: "miFichaDisponible", Parcial: "miFichaParcial", "No disponible": "miFichaNoDisponible" });

/* ---------- Servicios falsos ---------- */

// Una respuesta por llamada, en orden; la última se repite. Un Error se lanza.
// Anota los argumentos de cada llamada, copiados al realm del test.
function enSecuencia(...respuestas) {
  let llamada = 0;
  const falso = async (...argumentos) => {
    falso.llamadas.push(structuredClone(argumentos));
    const respuesta = respuestas[Math.min(llamada++, respuestas.length - 1)];
    if (respuesta instanceof Error) throw respuesta;
    if (respuesta && typeof respuesta.then === "function") return respuesta;
    return structuredClone(respuesta);
  };
  falso.llamadas = [];
  return falso;
}

// Una respuesta que el test entrega cuando quiere, para ver el estado ocupado.
function diferido() {
  let resolver;
  const promesa = new Promise((resolve) => { resolver = resolve; });
  return { promesa, resolver };
}

/* ---------- DOM falso: sólo lo que la página y auth-ui.js usan ---------- */

const CONTROLES = new Set(["INPUT", "TEXTAREA", "SELECT", "BUTTON"]);

// data-loading-text ⇄ dataset.loadingText, como en el navegador.
const aAtributoData = (clave) => `data-${clave.replace(/[A-Z]/g, (letra) => `-${letra.toLowerCase()}`)}`;

class Nodo {
  constructor(documento, etiqueta) {
    this.documento = documento;
    this.tagName = etiqueta.toUpperCase();
    this.parent = null;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.value = "";
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

    this.dataset = new Proxy({}, {
      get: (_, clave) => (typeof clave === "string" ? this.getAttribute(aAtributoData(clave)) ?? undefined : undefined),
      set: (_, clave, valor) => { this.setAttribute(aAtributoData(clave), valor); return true; },
      deleteProperty: (_, clave) => { this.removeAttribute(aAtributoData(clave)); return true; },
      has: (_, clave) => this.getAttribute(aAtributoData(clave)) !== null,
    });
  }

  get id() { return this.attributes.id || ""; }

  get type() {
    if ("type" in this.attributes) return this.attributes.type;
    if (this.tagName === "BUTTON") return "submit";
    return this.tagName === "INPUT" ? "text" : "";
  }
  set type(valor) { this.setAttribute("type", valor); }

  get className() { return [...this._clases].join(" "); }
  set className(valor) {
    this._clases.clear();
    String(valor).split(/\s+/).filter(Boolean).forEach((nombre) => this._clases.add(nombre));
  }

  // Como en el navegador: leer junta el texto de los descendientes, escribir
  // reemplaza a los hijos.
  get textContent() {
    if (this.children.length === 0) return this._texto;
    return this.children.map((hijo) => hijo.textContent).join(" ").replace(/\s+/g, " ").trim();
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

  // No-ops: el arrastre del stack los llama, pero no hay puntero real que
  // capturar en este DOM falso.
  setPointerCapture() {}
  releasePointerCapture() {}

  setAttribute(nombre, valor) { this.attributes[nombre] = String(valor); }
  getAttribute(nombre) { return nombre in this.attributes ? this.attributes[nombre] : null; }
  hasAttribute(nombre) { return nombre in this.attributes; }
  removeAttribute(nombre) { delete this.attributes[nombre]; }

  addEventListener(tipo, manejador) {
    (this.listeners[tipo] ||= []).push(manejador);
  }

  // Lo que el test usa para simular al usuario. Devuelve lo que devolvió cada
  // manejador, para poder esperar a los asíncronos.
  disparar(tipo, evento = {}) {
    const completo = {
      type: tipo,
      target: this,
      defaultPrevented: false,
      preventDefault() { completo.defaultPrevented = true; },
      ...evento,
    };
    return (this.listeners[tipo] || []).map((manejador) => manejador(completo));
  }

  // Un nodo dentro de algo `hidden` no es enfocable: así un focus() llamado
  // ANTES de mostrar la vista falla acá igual que en el navegador.
  estaFueraDeJuego() {
    for (let nodo = this; nodo; nodo = nodo.parent) {
      if (nodo.hidden) return true;
    }
    return false;
  }

  // Controles nativos habilitados, enlaces con href y lo que tenga tabindex.
  esEnfocable() {
    if (this.disabled) return false;
    if (CONTROLES.has(this.tagName)) return true;
    if (this.tagName === "A") return "href" in this.attributes;
    return "tabindex" in this.attributes;
  }

  focus() {
    if (!this.esEnfocable() || this.estaFueraDeJuego()) return;
    this.documento.activeElement = this;
  }

  querySelectorAll(selectores) {
    const lista = selectores.split(",").map((selector) => selector.trim());
    const hallados = [];
    recorrer(this, (nodo) => { if (lista.some((selector) => coincide(nodo, selector))) hallados.push(nodo); });
    return hallados;
  }

  querySelector(selectores) {
    return this.querySelectorAll(selectores)[0] || null;
  }
}

/*
  Selectores: etiqueta, clases y atributos ([a] o [a="v"]) en un compuesto, y
  el combinador descendiente. Nada más: un selector que no entienda lanza, para
  que un cambio en los scripts no pase por un "no encontró nada" silencioso.
*/
function coincideCompuesto(nodo, compuesto) {
  const partes = compuesto.match(/^([a-zA-Z][\w-]*)?((?:\.[\w-]+)*)((?:\[[\w-]+(?:="[^"]*")?\])*)$/);
  if (!partes) throw new Error(`selector no soportado por el DOM falso: ${compuesto}`);
  const [, etiqueta, clases, atributos] = partes;
  if (nodo.tagName.startsWith("#")) return false;
  if (etiqueta && nodo.tagName !== etiqueta.toUpperCase()) return false;
  for (const clase of clases.split(".").filter(Boolean)) {
    if (!nodo.classList.contains(clase)) return false;
  }
  for (const [, nombre, valor] of atributos.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
    const actual = nodo.getAttribute(nombre);
    if (actual === null) return false;
    if (valor !== undefined && actual !== valor) return false;
  }
  return true;
}

function coincide(nodo, selector) {
  const pasos = selector.split(/\s+/);
  if (!coincideCompuesto(nodo, pasos[pasos.length - 1])) return false;
  let pendiente = pasos.length - 2;
  for (let ancestro = nodo.parent; ancestro && pendiente >= 0; ancestro = ancestro.parent) {
    if (coincideCompuesto(ancestro, pasos[pendiente])) pendiente -= 1;
  }
  return pendiente < 0;
}

function recorrer(raiz, visitar) {
  raiz.children.forEach((hijo) => { visitar(hijo); recorrer(hijo, visitar); });
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
      if (visible) {
        const nodo = new Nodo(documento, "#text");
        nodo._texto = visible;
        abierto.append(nodo);
      }
    } else if (cierra) {
      pila.pop();
    } else {
      const nodo = new Nodo(documento, etiqueta);
      for (const [, nombre, valor = ""] of atributos.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
        if (nombre === "class") nodo.className = valor;
        else if (nombre === "hidden") nodo.hidden = true;
        else if (nombre === "disabled") nodo.disabled = true;
        else if (nombre === "checked") nodo.checked = true;
        else {
          nodo.setAttribute(nombre, valor);
          if (nombre === "value") nodo.value = valor;
        }
      }
      abierto.append(nodo);
      if (!ETIQUETAS_SIN_CIERRE.has(etiqueta.toLowerCase())) pila.push(nodo);
    }
  }
  return raiz;
}

/*
  Abre la página en un contexto NUEVO y dispara DOMContentLoaded, SIN esperar
  la carga: `iniciada` es la promesa del arranque.
    sesion        lo que devuelve requerirSesion() (null: visitante anónimo).
    perfil        el obtenerPerfil() falso (por defecto, una colaboradora).
    ficha         el obtenerMiFicha() falso (por defecto, sin ficha todavía).
    guardar       el guardarMiFicha() falso (por defecto, devuelve lo que recibe).
    catalogo      arreglo de tecnologías para el cargarCatalogoDeTecnologias()
                  falso; sin pasarlo, la función no existe (el script no
                  llegó), como en la mayoría de las páginas de verdad.
    sin           nombres de funciones globales que NO se inyectan (un script
                  que no llegó).
*/
function abrirPagina({
  sesion = SESION,
  perfil = enSecuencia(PERFIL),
  ficha = enSecuencia(exito(null)),
  guardar,
  catalogo,
  sin = [],
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
    getElementById: (id) => ids.get(id) || null,
    querySelectorAll: (selectores) => raiz.querySelectorAll(selectores),
    querySelector: (selectores) => raiz.querySelector(selectores),
  };

  const raiz = montarEsqueleto(documento, HTML);
  const ids = new Map();
  recorrer(raiz, (nodo) => { if (nodo.attributes.id) ids.set(nodo.attributes.id, nodo); });

  const requerirSesion = enSecuencia(sesion);
  const guardarMiFicha = guardar ?? (async (...argumentos) => {
    guardarMiFicha.llamadas.push(structuredClone(argumentos));
    return exito(structuredClone(argumentos[1]));
  });
  guardarMiFicha.llamadas ||= [];
  const toasts = [];
  const errores = [];

  const globales = {
    requerirSesion,
    obtenerPerfil: perfil,
    obtenerMiFicha: ficha,
    guardarMiFicha,
    mostrarToast: (mensaje, tipo) => toasts.push([mensaje, tipo]),
    // auth-ui.js la llama al cargar (agregarDestinoAEnlaces): sin destino.
    obtenerDestinoAuth: () => "",
  };
  // Sin `catalogo`, cargarCatalogoDeTecnologias no existe: el script del
  // catálogo no llegó, y el editor de etiquetas se degrada solo a texto libre.
  if (catalogo !== undefined) {
    globales.cargarCatalogoDeTecnologias = async () => ({ ok: true, tecnologias: structuredClone(catalogo) });
  }
  for (const nombre of sin) delete globales[nombre];

  const oyentesDeVentana = [];
  const contexto = vm.createContext({
    ...globales,
    document: documento,
    console: { error: (...argumentos) => errores.push(argumentos) },
    addEventListener: (tipo) => oyentesDeVentana.push(tipo),
    // El resaltado de una etiqueta duplicada se apaga solo con un temporizador
    // real; unref() para que no deje colgado al proceso de los tests.
    setTimeout: (...argumentos) => { const id = setTimeout(...argumentos); id?.unref?.(); return id; },
    clearTimeout: (...argumentos) => clearTimeout(...argumentos),
  });
  // Como en el navegador, `window` es el propio global.
  contexto.window = contexto;

  vm.runInContext(LOGICA, contexto);
  vm.runInContext(AUTH_UI, contexto);
  vm.runInContext(LOGICA_STACK, contexto);
  vm.runInContext(PAGINA, contexto);
  const iniciada = Promise.all(alCargar.map((manejador) => manejador()));

  const porId = (id) => {
    const nodo = ids.get(id);
    assert.ok(nodo, `el index.html no tiene #${id}`);
    return nodo;
  };
  const radios = () => Object.values(RADIOS).map(porId);

  return {
    documento,
    raiz,
    porId,
    iniciada,
    radios,
    requerirSesion,
    obtenerPerfil: perfil,
    obtenerMiFicha: ficha,
    guardarMiFicha,
    toasts,
    errores,
    texto: (id) => porId(id).textContent,
    activo: () => documento.activeElement,
    // Quien escribe en un campo: cambia el valor y el navegador emite input.
    escribir(campo, valor) {
      const control = porId(ID_DE[campo]);
      control.value = valor;
      control.disparar("input");
    },
    // Quien marca una opción: se desmarcan las otras y emite input y change.
    elegir(disponibilidad) {
      for (const [valor, id] of Object.entries(RADIOS)) porId(id).checked = valor === disponibilidad;
      const radio = porId(RADIOS[disponibilidad]);
      radio.disparar("input");
      radio.disparar("change");
    },
    // Quien agrega una tecnología al stack: la escribe y confirma con Enter,
    // como haría alguien de verdad con el combobox.
    agregarStack(texto) {
      const control = porId("miFichaStack");
      control.value = texto;
      control.disparar("input");
      control.disparar("keydown", { key: "Enter" });
    },
    // Las tecnologías tal como quedaron pintadas en la lista de etiquetas.
    stackEnPantalla() {
      return porId("miFichaStackLista").children.map((item) => item.children[1].textContent);
    },
    // Envía el formulario; la promesa se cumple cuando termina el guardado.
    enviar() {
      const evento = { defaultPrevented: false };
      const pendientes = porId("formMiFicha").disparar("submit", {
        preventDefault() { evento.defaultPrevented = true; },
      });
      return Promise.all(pendientes).then(() => evento);
    },
    // Clic en "Reintentar"; la promesa se cumple cuando termina la carga.
    reintentar: () => Promise.all(porId("miFichaReintentar").disparar("click")),
  };
}

async function cargarPagina(opciones) {
  const pagina = abrirPagina(opciones);
  await pagina.iniciada;
  return pagina;
}

// Se compara por identidad pero se informa con una descripción corta: dejar
// que assert arme el diff de dos nodos (grafos circulares) tarda muchísimo.
const describir = (nodo) => (nodo ? `${nodo.tagName} #${nodo.attributes.id || "?"}` : "(nada)");

function assertFocoEn(pagina, id) {
  const actual = pagina.activo();
  assert.ok(actual === pagina.porId(id), `el foco está en ${describir(actual)}; se esperaba en #${id}`);
}

function assertAviso(pagina, mensaje, { error, reintentar, colaboradores }) {
  assert.equal(pagina.porId("miFichaAviso").hidden, false, "el aviso debería verse");
  assert.equal(pagina.texto("miFichaAvisoMensaje"), mensaje);
  assert.equal(pagina.porId("miFichaAviso").classList.contains("mi-ficha__aviso--error"), error, "clase de error");
  assert.equal(pagina.porId("miFichaReintentar").hidden, !reintentar, "botón de reintentar");
  assert.equal(pagina.porId("miFichaIrColaboradores").hidden, !colaboradores, "enlace a Colaboradores");
  assert.equal(pagina.porId("miFichaContenido").hidden, true, "el formulario no se ve");
}

function assertFormularioVisible(pagina) {
  assert.equal(pagina.porId("miFichaContenido").hidden, false, "el formulario debería verse");
  assert.equal(pagina.porId("miFichaAviso").hidden, true, "el aviso de carga se oculta");
  assert.equal(pagina.porId("miFichaAviso").getAttribute("aria-busy"), "false");
}

// Los valores que el formulario muestra, campo por campo. El stack ya no es
// el .value del combobox (que sólo lleva lo que se está escribiendo): son las
// tecnologías que quedaron pintadas como etiquetas.
function valoresEnPantalla(pagina) {
  const valores = {};
  for (const campo of CAMPOS_MI_FICHA) {
    if (campo === "disponibilidad") {
      valores[campo] = Object.keys(RADIOS).find((valor) => pagina.porId(RADIOS[valor]).checked) ?? "";
    } else if (campo === "stack") {
      valores[campo] = pagina.stackEnPantalla();
    } else {
      valores[campo] = pagina.porId(ID_DE[campo]).value;
    }
  }
  return valores;
}

// El stack se llena de a una tecnología por vez, como en el widget: cada
// elemento del arreglo se escribe y se confirma con Enter.
function llenar(pagina, valores) {
  for (const [campo, valor] of Object.entries(valores)) {
    if (campo === "disponibilidad") pagina.elegir(valor);
    else if (campo === "stack") valor.forEach((tecnologia) => pagina.agregarStack(tecnologia));
    else pagina.escribir(campo, valor);
  }
}

const VALORES_VALIDOS = Object.freeze({
  rol: "  Desarrolladora backend ",
  especialidad: "Bases de datos",
  ubicacion: "Querétaro, México",
  stack: Object.freeze(["PostgreSQL", "Python", "GCP"]),
  disponibilidad: "Parcial",
  anio_inicio: "2018",
  bio: "\nDiseño esquemas y migraciones.\nMe gusta que los datos cuadren.\n",
  linkedin: "https://www.linkedin.com/in/valeria-ortiz",
  github: "",
  correo: " valeria@example.com ",
});

// El estado de error de un campo de texto: mensaje visible, aria-invalid y el
// mensaje enlazado por aria-describedby sin perder la ayuda.
function assertCampoConError(pagina, campo, mensaje) {
  const id = ID_DE[campo];
  const control = pagina.porId(id);
  const error = pagina.porId(`${id}Error`);
  assert.equal(error.hidden, false, `el error de ${campo} debería verse`);
  assert.equal(error.textContent, mensaje, campo);
  assert.equal(control.getAttribute("aria-invalid"), "true", `${campo} sin aria-invalid`);
  const describe = (control.getAttribute("aria-describedby") || "").split(/\s+/);
  assert.ok(describe.includes(`${id}Error`), `${campo} no describe su error`);
  assert.ok(describe.includes(`${id}Ayuda`), `${campo} perdió su ayuda`);
}

function assertCampoSinError(pagina, campo) {
  const id = ID_DE[campo];
  const control = pagina.porId(id);
  assert.equal(pagina.porId(`${id}Error`).hidden, true, `el error de ${campo} no debería verse`);
  assert.equal(control.getAttribute("aria-invalid"), null, `${campo} con aria-invalid`);
  assert.equal(control.getAttribute("aria-describedby"), `${id}Ayuda`, `${campo} describe sólo su ayuda`);
}

function assertDisponibilidadConError(pagina, mensaje) {
  const error = pagina.porId("miFichaDisponibilidadError");
  assert.equal(error.hidden, false);
  assert.equal(error.textContent, mensaje);
  assert.match(pagina.porId("miFichaDisponibilidad").getAttribute("aria-describedby") || "", /\bmiFichaDisponibilidadError\b/);
  for (const radio of pagina.radios()) assert.equal(radio.getAttribute("aria-invalid"), "true");
}

function assertDisponibilidadSinError(pagina) {
  assert.equal(pagina.porId("miFichaDisponibilidadError").hidden, true);
  assert.equal(pagina.porId("miFichaDisponibilidad").getAttribute("aria-describedby"), null);
  for (const radio of pagina.radios()) assert.equal(radio.getAttribute("aria-invalid"), null);
}

/* ---------- Arranque ---------- */

test("an anonymous visitor stops right after requerirSesion: no profile, no card, no form", async () => {
  const pagina = await cargarPagina({ sesion: null });

  assert.equal(pagina.requerirSesion.llamadas.length, 1);
  assert.equal(pagina.obtenerPerfil.llamadas.length, 0);
  assert.equal(pagina.obtenerMiFicha.llamadas.length, 0);
  assert.equal(pagina.porId("miFichaContenido").hidden, true);
  // requerirSesion ya está navegando al login: la página no dice nada más.
  assert.equal(pagina.texto("miFichaAvisoMensaje"), CARGANDO);
});

test("while the profile loads, the notice says so and is busy", async () => {
  const respuesta = diferido();
  const pagina = abrirPagina({ perfil: enSecuencia(respuesta.promesa) });

  assert.equal(pagina.porId("miFichaAviso").hidden, false);
  assert.equal(pagina.texto("miFichaAvisoMensaje"), CARGANDO);
  assert.equal(pagina.porId("miFichaContenido").hidden, true);

  respuesta.resolver(structuredClone(PERFIL));
  await pagina.iniciada;
  assertFormularioVisible(pagina);
});

test("a failed profile shows an error with an enabled retry, and never asks for the card", async () => {
  const pagina = await cargarPagina({ perfil: enSecuencia(null) });

  assertAviso(pagina, ERROR_DE_CUENTA, { error: true, reintentar: true, colaboradores: false });
  assert.equal(pagina.porId("miFichaReintentar").disabled, false);
  assert.equal(pagina.porId("miFichaAviso").getAttribute("aria-busy"), "false");
  assert.equal(pagina.obtenerMiFicha.llamadas.length, 0);
  // Cargar la página no mueve el foco.
  assert.equal(pagina.activo(), null);
});

test("a profile call that throws is shown as the same error, not an unhandled rejection", async () => {
  const pagina = await cargarPagina({ perfil: enSecuencia(new Error("red caída")) });

  assertAviso(pagina, ERROR_DE_CUENTA, { error: true, reintentar: true, colaboradores: false });
  assert.equal(pagina.errores.length, 1, "el fallo queda en la consola");
});

test("a successful retry reuses the session, shows the form and focuses the public-data warning", async () => {
  const pagina = await cargarPagina({ perfil: enSecuencia(null, PERFIL) });
  const boton = pagina.porId("miFichaReintentar");
  boton.focus();

  const reintento = pagina.reintentar();
  // Mientras vuelve a cargar: aviso de carga y el botón no responde.
  assert.equal(boton.disabled, true);
  assert.equal(pagina.texto("miFichaAvisoMensaje"), CARGANDO);
  assert.equal(pagina.porId("miFichaAviso").getAttribute("aria-busy"), "true");
  await reintento;

  assertFormularioVisible(pagina);
  assert.equal(pagina.requerirSesion.llamadas.length, 1, "la sesión ya estaba: no se vuelve a pedir");
  assert.equal(pagina.obtenerPerfil.llamadas.length, 2);
  assert.deepEqual(pagina.obtenerPerfil.llamadas[1], [SESION]);
  assert.deepEqual(pagina.obtenerMiFicha.llamadas, [["u-1"]]);
  // El botón que tenía el foco se ocultó con el aviso: el foco no cae al
  // <body>, va a lo primero que hay que leer.
  assertFocoEn(pagina, "miFichaPublico");
});

test("a failed retry keeps the error and moves focus to the notice", async () => {
  const pagina = await cargarPagina({ perfil: enSecuencia(null, null) });
  pagina.porId("miFichaReintentar").focus();

  await pagina.reintentar();

  assertAviso(pagina, ERROR_DE_CUENTA, { error: true, reintentar: true, colaboradores: false });
  assert.equal(pagina.porId("miFichaReintentar").disabled, false);
  assertFocoEn(pagina, "miFichaAviso");
});

test("an account that is not a collaborator gets a message and a link to Colaboradores, never the form", async () => {
  for (const perfil of [NO_COLABORADOR, { ...PERFIL, es_colaborador: undefined }, { ...PERFIL, es_colaborador: "true" }]) {
    const pagina = await cargarPagina({ perfil: enSecuencia(perfil) });

    assertAviso(pagina, SOLO_COLABORADORES, { error: false, reintentar: false, colaboradores: true });
    assert.equal(pagina.porId("miFichaIrColaboradores").getAttribute("href"), "/app/features/colaboradores/");
    assert.equal(pagina.obtenerMiFicha.llamadas.length, 0, "ni se pide la ficha");
    // Sin redirección silenciosa: nadie navegó.
    assert.equal(pagina.requerirSesion.llamadas.length, 1);
  }
});

test("a failed card load shows the service message with a retry, and the retry fills the form", async () => {
  const pagina = await cargarPagina({ ficha: enSecuencia(FALLO_AL_CARGAR, exito(FICHA)) });

  assertAviso(pagina, FALLO_AL_CARGAR.mensaje, { error: true, reintentar: true, colaboradores: false });

  await pagina.reintentar();
  assertFormularioVisible(pagina);
  assert.equal(pagina.porId("miFichaRol").value, FICHA.rol);
});

test("a missing script shows a page error instead of throwing, and asks nothing", async () => {
  for (const faltante of ["guardarMiFicha", "obtenerPerfil", "requerirSesion", "mostrarToast"]) {
    const pagina = await cargarPagina({ sin: [faltante] });

    assertAviso(pagina, ERROR_DE_PAGINA, { error: true, reintentar: false, colaboradores: false });
    assert.equal(pagina.requerirSesion.llamadas.length, 0, `${faltante}: no se llegó a pedir la sesión`);
  }
});

/* ---------- Formulario lleno o vacío ---------- */

test("a collaborator without a card gets an empty form with their name, and no profile link yet", async () => {
  const pagina = await cargarPagina();

  assertFormularioVisible(pagina);
  assert.deepEqual(pagina.obtenerMiFicha.llamadas, [["u-1"]]);
  assert.deepEqual(valoresEnPantalla(pagina), Object.fromEntries(CAMPOS_MI_FICHA.map((campo) => [campo, campo === "stack" ? [] : ""])));
  assert.equal(pagina.texto("miFichaNombre"), "Valeria Ortiz");
  assert.equal(pagina.porId("miFichaVerPerfil").hidden, true);
  assert.equal(pagina.porId("miFichaStatus").hidden, true);
  assert.equal(pagina.porId("miFichaProyectos").disabled, true);
  assert.equal(pagina.activo(), null, "cargar la página no mueve el foco");
});

test("a collaborator with a card gets it prefilled, with the stack shown as tags", async () => {
  const pagina = await cargarPagina({ ficha: enSecuencia(exito(FICHA)) });

  assertFormularioVisible(pagina);
  assert.deepEqual(valoresEnPantalla(pagina), {
    rol: "Desarrolladora backend",
    especialidad: "Bases de datos",
    ubicacion: "Querétaro, México",
    stack: ["PostgreSQL", "Python", "GCP"],
    disponibilidad: "Parcial",
    anio_inicio: "2018",
    bio: "Diseño esquemas y migraciones.\nMe gusta que los datos cuadren.",
    linkedin: "https://www.linkedin.com/in/valeria-ortiz",
    github: "",
    correo: "",
  });
  // Sólo una opción marcada.
  assert.deepEqual(pagina.radios().map((radio) => radio.checked), [false, true, false]);
  // El combobox arranca vacío: no repite lo que ya está en las etiquetas.
  assert.equal(pagina.porId("miFichaStack").value, "");
});

/* ---------- Validación ---------- */

test("an empty submit marks every required field at once, focuses the first and never calls the service", async () => {
  const pagina = await cargarPagina();

  const evento = await pagina.enviar();

  assert.equal(evento.defaultPrevented, true, "el formulario no navega");
  assert.equal(pagina.guardarMiFicha.llamadas.length, 0);

  const esperados = validarMiFicha(Object.fromEntries(CAMPOS_MI_FICHA.map((campo) => [campo, ""])), new Date().getFullYear()).errores;
  for (const { campo, mensaje } of esperados) {
    if (campo === "disponibilidad") assertDisponibilidadConError(pagina, mensaje);
    else assertCampoConError(pagina, campo, mensaje);
  }
  // Los enlaces son opcionales: vacíos no tienen error.
  for (const campo of ["linkedin", "github", "correo"]) assertCampoSinError(pagina, campo);

  assertFocoEn(pagina, "miFichaRol");
  // La región role="alert" es sólo para errores del servidor.
  assert.equal(pagina.porId("miFichaStatus").hidden, true);
  assert.equal(pagina.toasts.length, 0);
});

test("when availability is the first invalid field, focus goes to its first option", async () => {
  const pagina = await cargarPagina();
  const { disponibilidad, ...sinDisponibilidad } = VALORES_VALIDOS;
  assert.ok(disponibilidad, "premisa: la ficha válida trae disponibilidad");
  llenar(pagina, sinDisponibilidad);

  await pagina.enviar();

  assertDisponibilidadConError(pagina, "Elige tu disponibilidad.");
  for (const campo of Object.keys(ID_DE)) assertCampoSinError(pagina, campo);
  assertFocoEn(pagina, "miFichaDisponible");
  assert.equal(pagina.guardarMiFicha.llamadas.length, 0);
});

test("a malformed optional link is its own error, and the rest of the form stays clean", async () => {
  const pagina = await cargarPagina();
  llenar(pagina, { ...VALORES_VALIDOS, github: "http://github.com/valeria" });

  await pagina.enviar();

  const [{ mensaje }] = validarMiFicha({ ...VALORES_VALIDOS, github: "http://github.com/valeria" }, new Date().getFullYear()).errores;
  assertCampoConError(pagina, "github", mensaje);
  for (const campo of ["rol", "stack", "bio", "linkedin", "correo"]) assertCampoSinError(pagina, campo);
  assertDisponibilidadSinError(pagina);
  assertFocoEn(pagina, "miFichaGithub");
  assert.equal(pagina.guardarMiFicha.llamadas.length, 0);
});

test("editing a field clears only that field's error", async () => {
  const pagina = await cargarPagina();
  await pagina.enviar();

  pagina.escribir("rol", "D");
  assertCampoSinError(pagina, "rol");
  assert.equal(pagina.porId("miFichaEspecialidadError").hidden, false, "los demás errores siguen");

  pagina.elegir("Disponible");
  assertDisponibilidadSinError(pagina);
  assert.equal(pagina.porId("miFichaBioError").hidden, false);

  // Un envío nuevo vuelve a validar todo: "D" sigue siendo corto.
  await pagina.enviar();
  assert.equal(pagina.porId("miFichaRolError").hidden, false);
  assertDisponibilidadSinError(pagina);
});

/* ---------- Guardar ---------- */

test("a valid submit sends the exact normalized card, toasts, and offers the public profile link", async () => {
  const pagina = await cargarPagina();
  llenar(pagina, VALORES_VALIDOS);

  await pagina.enviar();

  assert.deepEqual(pagina.guardarMiFicha.llamadas, [["u-1", {
    rol: "Desarrolladora backend",
    especialidad: "Bases de datos",
    ubicacion: "Querétaro, México",
    stack: ["PostgreSQL", "Python", "GCP"],
    disponibilidad: "Parcial",
    anio_inicio: 2018,
    bio: "Diseño esquemas y migraciones.\nMe gusta que los datos cuadren.",
    linkedin: "https://www.linkedin.com/in/valeria-ortiz",
    github: null,
    correo: "valeria@example.com",
  }]]);
  assert.deepEqual(pagina.toasts, [["Ficha guardada.", "success"]]);

  const verPerfil = pagina.porId("miFichaVerPerfil");
  assert.equal(verPerfil.hidden, false);
  assert.equal(verPerfil.getAttribute("href"), "/app/features/colaboradores/#/valeria");
  assert.equal(verPerfil.textContent, "Ver mi perfil");

  // El formulario queda con lo que devolvió la base, ya normalizado.
  assert.deepEqual(pagina.stackEnPantalla(), ["PostgreSQL", "Python", "GCP"]);
  assert.equal(pagina.porId("miFichaRol").value, "Desarrolladora backend");
  assert.equal(pagina.porId("miFichaStatus").hidden, true);
  for (const campo of Object.keys(ID_DE)) assertCampoSinError(pagina, campo);
});

test("a profile without a well-formed slug saves but offers no broken profile link", async () => {
  const pagina = await cargarPagina({ perfil: enSecuencia({ ...PERFIL, slug: null }) });
  llenar(pagina, VALORES_VALIDOS);

  await pagina.enviar();

  assert.equal(pagina.guardarMiFicha.llamadas.length, 1);
  assert.deepEqual(pagina.toasts, [["Ficha guardada.", "success"]]);
  assert.equal(pagina.porId("miFichaVerPerfil").hidden, true);
});

test("a service failure shows its message in the alert, focused, with no toast and no profile link", async () => {
  const pagina = await cargarPagina({ guardar: enSecuencia(FALLO_AL_GUARDAR) });
  llenar(pagina, VALORES_VALIDOS);

  await pagina.enviar();

  assert.equal(pagina.guardarMiFicha.llamadas.length, 1);
  const estado = pagina.porId("miFichaStatus");
  assert.equal(estado.hidden, false);
  assert.equal(estado.textContent, FALLO_AL_GUARDAR.mensaje);
  assertFocoEn(pagina, "miFichaStatus");
  assert.deepEqual(pagina.toasts, []);
  assert.equal(pagina.porId("miFichaVerPerfil").hidden, true);
  // Lo escrito no se pierde.
  assert.deepEqual(pagina.stackEnPantalla(), [...VALORES_VALIDOS.stack]);
  assert.equal(pagina.porId("formMiFicha").getAttribute("aria-busy"), "false");

  // El siguiente intento esconde el aviso anterior antes de validar.
  pagina.escribir("rol", "");
  await pagina.enviar();
  assert.equal(estado.hidden, true);
});

test("the form is busy while saving and comes back as it was, the disabled Proyectos field included", async () => {
  const respuesta = diferido();
  const pagina = await cargarPagina({ guardar: enSecuencia(respuesta.promesa) });
  llenar(pagina, VALORES_VALIDOS);
  const form = pagina.porId("formMiFicha");
  const boton = pagina.porId("miFichaGuardar");

  const envio = pagina.enviar();

  assert.equal(form.getAttribute("aria-busy"), "true");
  assert.equal(boton.disabled, true);
  assert.equal(boton.textContent, "Guardando…");
  for (const id of [...Object.values(ID_DE), ...Object.values(RADIOS), "miFichaProyectos"]) {
    assert.equal(pagina.porId(id).disabled, true, `#${id} debería estar deshabilitado mientras guarda`);
  }

  // Un segundo envío mientras guarda no dispara otro guardado.
  pagina.enviar();
  assert.equal(pagina.guardarMiFicha.llamadas.length, 1);

  respuesta.resolver(exito(structuredClone(pagina.guardarMiFicha.llamadas[0][1])));
  await envio;

  assert.equal(form.getAttribute("aria-busy"), "false");
  assert.equal(boton.disabled, false);
  assert.equal(boton.textContent, "Guardar ficha");
  for (const id of [...Object.values(ID_DE), ...Object.values(RADIOS)]) {
    assert.equal(pagina.porId(id).disabled, false, `#${id} debería volver a estar habilitado`);
  }
  assert.equal(pagina.porId("miFichaProyectos").disabled, true, "Proyectos sigue apagado");
  assert.deepEqual(pagina.toasts, [["Ficha guardada.", "success"]]);
});

test("an existing card saved again sends the edited values, not the loaded ones", async () => {
  const pagina = await cargarPagina({ ficha: enSecuencia(exito(FICHA)) });
  pagina.escribir("rol", "Arquitecta de datos");
  pagina.elegir("No disponible");

  await pagina.enviar();

  assert.deepEqual(pagina.guardarMiFicha.llamadas, [["u-1", {
    ...structuredClone(FICHA),
    rol: "Arquitecta de datos",
    disponibilidad: "No disponible",
  }]]);
});

/* ---------- Stack: el editor de etiquetas ---------- */

// La manija de la etiqueta en el índice dado (hijo 0 de su <li>).
function manijaStack(pagina, indice) {
  return pagina.porId("miFichaStackLista").children[indice].children[0];
}

// El botón de quitar de la etiqueta en el índice dado (hijo 2 de su <li>).
function quitarStack(pagina, indice) {
  return pagina.porId("miFichaStackLista").children[indice].children[2];
}

// La opción resaltada del desplegable, si hay alguna.
function opcionResaltada(pagina) {
  return pagina.porId("miFichaStackOpciones").children
    .find((opcion) => opcion.classList.contains("mi-ficha__stack-opcion--resaltada"));
}

test("typing filters the catalog into the listbox, prefix matches first", async () => {
  const pagina = await cargarPagina({ catalogo: ["PostgreSQL", "Python", "AWS"] });
  const opciones = () => pagina.porId("miFichaStackOpciones");

  pagina.escribir("stack", "p");

  assert.equal(opciones().hidden, false);
  assert.deepEqual(opciones().children.map((opcion) => opcion.textContent), ["PostgreSQL", "Python"]);
  assert.equal(pagina.porId("miFichaStack").getAttribute("aria-expanded"), "true");

  pagina.escribir("stack", "");
  assert.equal(opciones().hidden, true);
  assert.equal(pagina.porId("miFichaStack").getAttribute("aria-expanded"), "false");
});

test("ArrowDown and ArrowUp move the highlighted suggestion, clamped at the edges", async () => {
  const pagina = await cargarPagina({ catalogo: ["Postgres", "Python", "PHP"] });
  const input = pagina.porId("miFichaStack");
  pagina.escribir("stack", "p");

  input.disparar("keydown", { key: "ArrowDown" });
  assert.equal(opcionResaltada(pagina).textContent, "Postgres");
  assert.equal(input.getAttribute("aria-activedescendant"), "miFichaStackOpcion0");

  input.disparar("keydown", { key: "ArrowDown" });
  input.disparar("keydown", { key: "ArrowDown" });
  assert.equal(opcionResaltada(pagina).textContent, "PHP");
  // Tope superior: un cuarto ArrowDown no sale de la última.
  input.disparar("keydown", { key: "ArrowDown" });
  assert.equal(opcionResaltada(pagina).textContent, "PHP");

  input.disparar("keydown", { key: "ArrowUp" });
  input.disparar("keydown", { key: "ArrowUp" });
  assert.equal(opcionResaltada(pagina).textContent, "Postgres");
  // Tope inferior: sin dar la vuelta a la última.
  input.disparar("keydown", { key: "ArrowUp" });
  assert.equal(opcionResaltada(pagina).textContent, "Postgres");
});

test("Enter without a highlighted option adds the typed text and clears the input", async () => {
  const pagina = await cargarPagina();
  pagina.escribir("stack", "Rust");

  pagina.porId("miFichaStack").disparar("keydown", { key: "Enter" });

  assert.deepEqual(pagina.stackEnPantalla(), ["Rust"]);
  assert.equal(pagina.porId("miFichaStack").value, "");
  assert.equal(pagina.porId("miFichaStackOpciones").hidden, true);
});

test("Enter with a highlighted suggestion confirms that suggestion, not the typed text", async () => {
  const pagina = await cargarPagina({ catalogo: ["PostgreSQL", "Python"] });
  const input = pagina.porId("miFichaStack");
  pagina.escribir("stack", "pos");
  input.disparar("keydown", { key: "ArrowDown" });

  input.disparar("keydown", { key: "Enter" });

  assert.deepEqual(pagina.stackEnPantalla(), ["PostgreSQL"]);
});

test("a comma confirms the entry, just like Enter", async () => {
  const pagina = await cargarPagina();
  pagina.escribir("stack", "Go");

  pagina.porId("miFichaStack").disparar("keydown", { key: "," });

  assert.deepEqual(pagina.stackEnPantalla(), ["Go"]);
});

test("Escape closes the listbox without touching the text or the stack", async () => {
  const pagina = await cargarPagina({ catalogo: ["PostgreSQL", "Python"] });
  const input = pagina.porId("miFichaStack");
  pagina.escribir("stack", "pos");

  input.disparar("keydown", { key: "Escape" });

  assert.equal(pagina.porId("miFichaStackOpciones").hidden, true);
  assert.equal(input.value, "pos");
  assert.deepEqual(pagina.stackEnPantalla(), []);
});

test("adding a duplicate announces it, highlights the existing tag and does not grow the stack", async () => {
  const pagina = await cargarPagina();
  pagina.agregarStack("PostgreSQL");

  pagina.agregarStack("  POSTGRESQL  ");

  assert.deepEqual(pagina.stackEnPantalla(), ["PostgreSQL"]);
  assert.equal(pagina.texto("miFichaStackEstado"), "PostgreSQL ya está en tu stack.");
  assert.ok(manijaStack(pagina, 0).parent.classList.contains("mi-ficha__etiqueta--duplicada"));
});

test("the twelfth technology disables the input and the help says so; removing one re-enables it", async () => {
  const pagina = await cargarPagina();
  for (let i = 0; i < 12; i += 1) pagina.agregarStack(`T${i}`);

  assert.equal(pagina.stackEnPantalla().length, 12);
  assert.equal(pagina.porId("miFichaStack").disabled, true);
  assert.match(pagina.texto("miFichaStackAyuda"), /12/);

  quitarStack(pagina, 0).disparar("click");

  assert.equal(pagina.stackEnPantalla().length, 11);
  assert.equal(pagina.porId("miFichaStack").disabled, false);
});

test("removing a tag moves focus to the handle at the same index, then the previous one, then the input when the list empties", async () => {
  const pagina = await cargarPagina();
  ["A", "B", "C"].forEach((tecnologia) => pagina.agregarStack(tecnologia));

  // Quita "B" (índice 1): el foco va a la manija que ocupa ese índice ahora ("C").
  quitarStack(pagina, 1).disparar("click");
  assert.deepEqual(pagina.stackEnPantalla(), ["A", "C"]);
  assert.equal(pagina.activo(), manijaStack(pagina, 1));

  // Quita "C", que ahora es la última (índice 1 de 2): el foco va a la anterior.
  quitarStack(pagina, 1).disparar("click");
  assert.deepEqual(pagina.stackEnPantalla(), ["A"]);
  assert.equal(pagina.activo(), manijaStack(pagina, 0));

  // Quita la última que queda: la lista se vacía y el foco va al input.
  quitarStack(pagina, 0).disparar("click");
  assert.deepEqual(pagina.stackEnPantalla(), []);
  assertFocoEn(pagina, "miFichaStack");
});

test("Backspace on an empty input removes the last tag and keeps focus on the input", async () => {
  const pagina = await cargarPagina();
  ["A", "B"].forEach((tecnologia) => pagina.agregarStack(tecnologia));
  const input = pagina.porId("miFichaStack");
  input.focus();

  input.disparar("keydown", { key: "Backspace" });

  assert.deepEqual(pagina.stackEnPantalla(), ["A"]);
  assertFocoEn(pagina, "miFichaStack");
});

test("keyboard reordering from the handle moves the tag and focus follows it", async () => {
  const pagina = await cargarPagina();
  ["A", "B", "C"].forEach((tecnologia) => pagina.agregarStack(tecnologia));

  manijaStack(pagina, 0).disparar("keydown", { key: "ArrowRight" });

  assert.deepEqual(pagina.stackEnPantalla(), ["B", "A", "C"]);
  assert.equal(pagina.activo(), manijaStack(pagina, 1));
  assert.equal(pagina.texto("miFichaStackEstado"), "A, posición 2 de 3.");

  manijaStack(pagina, 1).disparar("keydown", { key: "End" });
  assert.deepEqual(pagina.stackEnPantalla(), ["B", "C", "A"]);
  assert.equal(pagina.activo(), manijaStack(pagina, 2));
});

test("a missing technology catalog script degrades silently: no suggestions, but free text still works", async () => {
  const pagina = await cargarPagina(); // sin `catalogo`: el script del catálogo no llegó.

  pagina.escribir("stack", "cualquier cosa");
  assert.equal(pagina.porId("miFichaStackOpciones").hidden, true, "sin catálogo no hay nada que sugerir");

  pagina.porId("miFichaStack").disparar("keydown", { key: "Enter" });
  assert.deepEqual(pagina.stackEnPantalla(), ["cualquier cosa"]);
  assert.equal(pagina.errores.length, 0, "la ausencia del catálogo no se avisa ni se reintenta");
});

test("preloading a card with a technology outside the catalog keeps it exactly as it is", async () => {
  const pagina = await cargarPagina({
    catalogo: ["Python", "PostgreSQL"],
    ficha: enSecuencia(exito({ ...structuredClone(FICHA), stack: ["Un framework rarísimo"] })),
  });

  assert.deepEqual(pagina.stackEnPantalla(), ["Un framework rarísimo"]);
});
