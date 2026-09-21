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
const LOGICA_ETIQUETAS = leer(`${CARPETA}/mi-ficha.etiquetas.logica.js`);
const ETIQUETAS = leer(`${CARPETA}/mi-ficha.etiquetas.js`);
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

// Una ficha como la devuelve obtenerMiFicha(): las catorce columnas.
const FICHA = Object.freeze({
  puesto: "Desarrolladora backend",
  sector: "Bases de datos",
  ubicacion: "Querétaro, México",
  herramientas: Object.freeze(["PostgreSQL", "Python", "GCP"]),
  habilidades: Object.freeze(["Modelado de datos", "ETL"]),
  idiomas: Object.freeze(["Español", "Inglés"]),
  empresa: "Taudux",
  empresa_enlace: "https://taudux.com",
  modalidad_trabajo: "Híbrido",
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
  puesto: "miFichaPuesto",
  sector: "miFichaSector",
  ubicacion: "miFichaUbicacion",
  herramientas: "miFichaHerramientas",
  habilidades: "miFichaHabilidades",
  idiomas: "miFichaIdiomas",
  empresa: "miFichaEmpresa",
  empresa_enlace: "miFichaEmpresaEnlace",
  anio_inicio: "miFichaAnioInicio",
  bio: "miFichaBio",
  linkedin: "miFichaLinkedin",
  github: "miFichaGithub",
  correo: "miFichaCorreo",
});
const RADIOS = Object.freeze({ Presencial: "miFichaPresencial", Híbrido: "miFichaHibrido", Remoto: "miFichaRemoto" });

/*
  Los tres campos que son listas de etiquetas. Su valor no vive en el .value
  del combobox (que sólo lleva lo que se está escribiendo) sino en las
  etiquetas pintadas, así que los ayudantes de esta suite los tratan aparte.
  Herramientas es obligatoria; habilidades e idiomas se pueden guardar vacías.
*/
const LISTAS_DE_ETIQUETAS = Object.freeze(["herramientas", "habilidades", "idiomas"]);

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

  // No-ops: el arrastre de las herramientas los llama, pero no hay puntero
  // real que capturar en este DOM falso.
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
    catalogo      sugerencias para el cargarCatalogoDeEtiquetas() falso: un
                  arreglo (sólo herramientas) o un objeto por nombre de
                  catálogo. Es el
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
  // Sin `catalogo`, cargarCatalogoDeEtiquetas no existe: el script del
  // catálogo no llegó, y los tres editores se degradan solos a texto libre.
  // Un arreglo suelto es el catálogo de herramientas y los otros dos quedan
  // sin sugerencias, que es lo que le hace falta a casi toda la suite.
  if (catalogo !== undefined) {
    const porNombre = Array.isArray(catalogo) ? { herramientas: catalogo } : catalogo;
    globales.cargarCatalogoDeEtiquetas = async (nombre) => (porNombre[nombre]
      ? { ok: true, etiquetas: structuredClone(porNombre[nombre]) }
      : { ok: false, mensaje: `El catálogo de ${nombre} está vacío.` });
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

  /*
    `sin` borra globales inyectadas, pero las que define un script de la propia
    página no se inyectan: existen porque el script CORRE. Para fingir que uno
    no llegó —un 404, un error de sintaxis— hay que no correrlo, que es
    exactamente lo que pasa en el navegador.
  */
  const GLOBAL_DEL_SCRIPT = [
    [LOGICA_ETIQUETAS, "agregarEtiqueta"],
    [ETIQUETAS, "crearEditorDeEtiquetas"],
  ];

  vm.runInContext(LOGICA, contexto);
  vm.runInContext(AUTH_UI, contexto);
  for (const [fuente, global] of GLOBAL_DEL_SCRIPT) {
    if (!sin.includes(global)) vm.runInContext(fuente, contexto);
  }
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
    elegir(modalidad_trabajo) {
      for (const [valor, id] of Object.entries(RADIOS)) porId(id).checked = valor === modalidad_trabajo;
      const radio = porId(RADIOS[modalidad_trabajo]);
      radio.disparar("input");
      radio.disparar("change");
    },
    // Quien agrega una etiqueta a una de las tres listas: la escribe y
    // confirma con Enter, como haría alguien de verdad con el combobox.
    agregarEtiqueta(campo, texto) {
      const control = porId(ID_DE[campo]);
      control.value = texto;
      control.disparar("input");
      control.disparar("keydown", { key: "Enter" });
    },
    // Las etiquetas de un campo tal como quedaron pintadas en su lista.
    etiquetasEnPantalla(campo) {
      return porId(`${ID_DE[campo]}Lista`).children.map((item) => item.children[1].textContent);
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

// Los valores que el formulario muestra, campo por campo. Las herramientas
// ya no son el .value del combobox (que sólo lleva lo que se está
// escribiendo): son las tecnologías que quedaron pintadas como etiquetas.
function valoresEnPantalla(pagina) {
  const valores = {};
  for (const campo of CAMPOS_MI_FICHA) {
    if (campo === "modalidad_trabajo") {
      valores[campo] = Object.keys(RADIOS).find((valor) => pagina.porId(RADIOS[valor]).checked) ?? "";
    } else if (LISTAS_DE_ETIQUETAS.includes(campo)) {
      valores[campo] = pagina.etiquetasEnPantalla(campo);
    } else {
      valores[campo] = pagina.porId(ID_DE[campo]).value;
    }
  }
  return valores;
}

// Las listas de etiquetas se llenan de a una por vez, como en el widget: cada
// elemento del arreglo se escribe y se confirma con Enter.
function llenar(pagina, valores) {
  for (const [campo, valor] of Object.entries(valores)) {
    if (campo === "modalidad_trabajo") pagina.elegir(valor);
    else if (LISTAS_DE_ETIQUETAS.includes(campo)) valor.forEach((etiqueta) => pagina.agregarEtiqueta(campo, etiqueta));
    else pagina.escribir(campo, valor);
  }
}

const VALORES_VALIDOS = Object.freeze({
  puesto: "  Desarrolladora backend ",
  sector: "Bases de datos",
  ubicacion: "Querétaro, México",
  herramientas: Object.freeze(["PostgreSQL", "Python", "GCP"]),
  habilidades: Object.freeze(["Modelado de datos", "ETL"]),
  idiomas: Object.freeze(["Español", "Inglés"]),
  empresa: "Taudux",
  empresa_enlace: "https://taudux.com",
  modalidad_trabajo: "Híbrido",
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

// El bio describe dos ids (su ayuda y su contador); todos los demás, uno solo.
const AYUDA_DE = Object.freeze({ bio: "miFichaBioAyuda miFichaBioContador" });

function assertCampoSinError(pagina, campo) {
  const id = ID_DE[campo];
  const control = pagina.porId(id);
  assert.equal(pagina.porId(`${id}Error`).hidden, true, `el error de ${campo} no debería verse`);
  assert.equal(control.getAttribute("aria-invalid"), null, `${campo} con aria-invalid`);
  assert.equal(control.getAttribute("aria-describedby"), AYUDA_DE[campo] ?? `${id}Ayuda`, `${campo} describe sólo su ayuda`);
}

function assertModalidadTrabajoConError(pagina, mensaje) {
  const error = pagina.porId("miFichaModalidadTrabajoError");
  assert.equal(error.hidden, false);
  assert.equal(error.textContent, mensaje);
  assert.match(pagina.porId("miFichaModalidadTrabajo").getAttribute("aria-describedby") || "", /\bmiFichaModalidadTrabajoError\b/);
  for (const radio of pagina.radios()) assert.equal(radio.getAttribute("aria-invalid"), "true");
}

function assertModalidadTrabajoSinError(pagina) {
  assert.equal(pagina.porId("miFichaModalidadTrabajoError").hidden, true);
  assert.equal(pagina.porId("miFichaModalidadTrabajo").getAttribute("aria-describedby"), null);
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
  assert.equal(pagina.porId("miFichaPuesto").value, FICHA.puesto);
});

test("a missing script shows a page error instead of throwing, and asks nothing", async () => {
  // crearEditorDeEtiquetas va en la lista por un motivo que las otras no
  // tienen: es lo único que se INVOCA al iniciar, no una referencia que se usa
  // más tarde. Si la instanciación quedara antes del guardián de
  // dependencias, un script ausente lanzaría un TypeError sin capturar en vez
  // de mostrar el aviso de error con gracia.
  for (const faltante of [
    "guardarMiFicha", "obtenerPerfil", "requerirSesion", "mostrarToast",
    "crearEditorDeEtiquetas",
  ]) {
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
  assert.deepEqual(
    valoresEnPantalla(pagina),
    Object.fromEntries(CAMPOS_MI_FICHA.map((campo) => [campo, LISTAS_DE_ETIQUETAS.includes(campo) ? [] : ""])),
  );
  assert.equal(pagina.texto("miFichaNombre"), "Valeria Ortiz");
  assert.equal(pagina.porId("miFichaVerPerfil").hidden, true);
  assert.equal(pagina.porId("miFichaStatus").hidden, true);
  assert.equal(pagina.porId("miFichaProyectos").disabled, true);
  assert.equal(pagina.activo(), null, "cargar la página no mueve el foco");
});

test("a collaborator with a card gets it prefilled, with the tools shown as tags", async () => {
  const pagina = await cargarPagina({ ficha: enSecuencia(exito(FICHA)) });

  assertFormularioVisible(pagina);
  assert.deepEqual(valoresEnPantalla(pagina), {
    puesto: "Desarrolladora backend",
    sector: "Bases de datos",
    ubicacion: "Querétaro, México",
    herramientas: ["PostgreSQL", "Python", "GCP"],
    habilidades: ["Modelado de datos", "ETL"],
    idiomas: ["Español", "Inglés"],
    empresa: "Taudux",
    empresa_enlace: "https://taudux.com",
    modalidad_trabajo: "Híbrido",
    anio_inicio: "2018",
    bio: "Diseño esquemas y migraciones.\nMe gusta que los datos cuadren.",
    linkedin: "https://www.linkedin.com/in/valeria-ortiz",
    github: "",
    correo: "",
  });
  // Sólo una opción marcada.
  assert.deepEqual(pagina.radios().map((radio) => radio.checked), [false, true, false]);
  // El combobox arranca vacío: no repite lo que ya está en las etiquetas.
  assert.equal(pagina.porId("miFichaHerramientas").value, "");
});

/* ---------- Validación ---------- */

test("an empty submit marks every required field at once, focuses the first and never calls the service", async () => {
  const pagina = await cargarPagina();

  const evento = await pagina.enviar();

  assert.equal(evento.defaultPrevented, true, "el formulario no navega");
  assert.equal(pagina.guardarMiFicha.llamadas.length, 0);

  const esperados = validarMiFicha(Object.fromEntries(CAMPOS_MI_FICHA.map((campo) => [campo, ""])), new Date().getFullYear()).errores;
  for (const { campo, mensaje } of esperados) {
    if (campo === "modalidad_trabajo") assertModalidadTrabajoConError(pagina, mensaje);
    else assertCampoConError(pagina, campo, mensaje);
  }
  // Los enlaces son opcionales: vacíos no tienen error.
  for (const campo of ["linkedin", "github", "correo"]) assertCampoSinError(pagina, campo);

  assertFocoEn(pagina, "miFichaPuesto");
  // La región role="alert" es sólo para errores del servidor.
  assert.equal(pagina.porId("miFichaStatus").hidden, true);
  assert.equal(pagina.toasts.length, 0);
});

test("when work modality is the first invalid field, focus goes to its first option", async () => {
  const pagina = await cargarPagina();
  const { modalidad_trabajo, ...sinModalidadTrabajo } = VALORES_VALIDOS;
  assert.ok(modalidad_trabajo, "premisa: la ficha válida trae modalidad de trabajo");
  llenar(pagina, sinModalidadTrabajo);

  await pagina.enviar();

  assertModalidadTrabajoConError(pagina, "Elige tu modalidad de trabajo.");
  for (const campo of Object.keys(ID_DE)) assertCampoSinError(pagina, campo);
  assertFocoEn(pagina, "miFichaPresencial");
  assert.equal(pagina.guardarMiFicha.llamadas.length, 0);
});

test("a malformed optional link is its own error, and the rest of the form stays clean", async () => {
  const pagina = await cargarPagina();
  llenar(pagina, { ...VALORES_VALIDOS, github: "http://github.com/valeria" });

  await pagina.enviar();

  const [{ mensaje }] = validarMiFicha({ ...VALORES_VALIDOS, github: "http://github.com/valeria" }, new Date().getFullYear()).errores;
  assertCampoConError(pagina, "github", mensaje);
  for (const campo of ["puesto", "herramientas", "bio", "linkedin", "correo"]) assertCampoSinError(pagina, campo);
  assertModalidadTrabajoSinError(pagina);
  assertFocoEn(pagina, "miFichaGithub");
  assert.equal(pagina.guardarMiFicha.llamadas.length, 0);
});

test("editing a field clears only that field's error", async () => {
  const pagina = await cargarPagina();
  await pagina.enviar();

  pagina.escribir("puesto", "D");
  assertCampoSinError(pagina, "puesto");
  // Ubicación y no sector: el sector es opcional desde la 0042 y un formulario
  // vacío ya no lo marca, así que no serviría de testigo.
  assert.equal(pagina.porId("miFichaUbicacionError").hidden, false, "los demás errores siguen");

  pagina.elegir("Presencial");
  assertModalidadTrabajoSinError(pagina);
  assert.equal(pagina.porId("miFichaBioError").hidden, false);

  // Un envío nuevo vuelve a validar todo: "D" sigue siendo corto.
  await pagina.enviar();
  assert.equal(pagina.porId("miFichaPuestoError").hidden, false);
  assertModalidadTrabajoSinError(pagina);
});

/* ---------- Guardar ---------- */

test("a valid submit sends the exact normalized card, toasts, and offers the public profile link", async () => {
  const pagina = await cargarPagina();
  llenar(pagina, VALORES_VALIDOS);

  await pagina.enviar();

  assert.deepEqual(pagina.guardarMiFicha.llamadas, [["u-1", {
    puesto: "Desarrolladora backend",
    sector: "Bases de datos",
    ubicacion: "Querétaro, México",
    herramientas: ["PostgreSQL", "Python", "GCP"],
    habilidades: ["Modelado de datos", "ETL"],
    idiomas: ["Español", "Inglés"],
    empresa: "Taudux",
    empresa_enlace: "https://taudux.com",
    modalidad_trabajo: "Híbrido",
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
  assert.deepEqual(pagina.etiquetasEnPantalla("herramientas"), ["PostgreSQL", "Python", "GCP"]);
  assert.equal(pagina.porId("miFichaPuesto").value, "Desarrolladora backend");
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
  assert.deepEqual(pagina.etiquetasEnPantalla("herramientas"), [...VALORES_VALIDOS.herramientas]);
  assert.equal(pagina.porId("formMiFicha").getAttribute("aria-busy"), "false");

  // El siguiente intento esconde el aviso anterior antes de validar.
  pagina.escribir("puesto", "");
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
  pagina.escribir("puesto", "Arquitecta de datos");
  pagina.elegir("Remoto");

  await pagina.enviar();

  assert.deepEqual(pagina.guardarMiFicha.llamadas, [["u-1", {
    ...structuredClone(FICHA),
    puesto: "Arquitecta de datos",
    modalidad_trabajo: "Remoto",
  }]]);
});

/* ---------- Bio: el contador que descuenta ---------- */

test("the bio counter starts at 240 and counts down while typing", async () => {
  const pagina = await cargarPagina();
  const contador = () => pagina.porId("miFichaBioContador");

  assert.equal(contador().textContent, "Te quedan 240 caracteres");

  pagina.escribir("bio", "a".repeat(50));
  assert.equal(contador().textContent, "Te quedan 190 caracteres");

  pagina.escribir("bio", "a".repeat(239));
  assert.equal(contador().textContent, "Te queda 1 carácter", "singular cuando queda uno");
});

/*
  El freno cuenta PUNTOS DE CÓDIGO (largoMiFicha), no unidades UTF-16: un
  maxlength cortaría un emoji a la mitad. Pegar 500 caracteres deja
  exactamente 240, nunca 500 ni 239; y 240 emojis, que para .length (UTF-16)
  serían 480, no se recortan porque para la base son 240 caracteres.
*/
test("pasting past the limit truncates to exactly 240 code points, and 240 emojis are not truncated", async () => {
  const pagina = await cargarPagina();
  const bio = () => pagina.porId("miFichaBio");
  const contador = () => pagina.porId("miFichaBioContador");

  pagina.escribir("bio", "b".repeat(500));
  assert.equal(bio().value, "b".repeat(240));
  assert.equal(contador().textContent, "Te quedan 0 caracteres");

  const emojis = "😀".repeat(240);
  pagina.escribir("bio", emojis);
  assert.equal(bio().value, emojis, "240 emojis cuentan como 240 para la base, no se recortan");
  assert.equal(contador().textContent, "Te quedan 0 caracteres");
});

test("the bio counter's live region stays quiet until the last 20 characters", async () => {
  const pagina = await cargarPagina();
  const contador = () => pagina.porId("miFichaBioContador");

  pagina.escribir("bio", "a".repeat(200));
  assert.equal(contador().textContent, "Te quedan 40 caracteres");
  assert.equal(contador().getAttribute("aria-live"), "off", "lejos del límite: no debe anunciar cada tecla");

  pagina.escribir("bio", "a".repeat(221));
  assert.equal(contador().textContent, "Te quedan 19 caracteres");
  assert.equal(contador().getAttribute("aria-live"), "polite", "cerca del límite: se anuncia");

  // Alejarse del límite lo vuelve a callar.
  pagina.escribir("bio", "a".repeat(50));
  assert.equal(contador().getAttribute("aria-live"), "off");
});

/* ---------- Herramientas: el editor de etiquetas ---------- */

// La manija de la etiqueta en el índice dado (hijo 0 de su <li>).
function manijaHerramienta(pagina, indice) {
  return pagina.porId("miFichaHerramientasLista").children[indice].children[0];
}

// El botón de quitar de la etiqueta en el índice dado (hijo 2 de su <li>).
function quitarHerramienta(pagina, indice) {
  return pagina.porId("miFichaHerramientasLista").children[indice].children[2];
}

// La opción resaltada del desplegable, si hay alguna.
function opcionResaltada(pagina) {
  return pagina.porId("miFichaHerramientasOpciones").children
    .find((opcion) => opcion.classList.contains("mi-ficha__etiquetas-opcion--resaltada"));
}

test("typing filters the catalog into the listbox, prefix matches first", async () => {
  const pagina = await cargarPagina({ catalogo: ["PostgreSQL", "Python", "AWS"] });
  const opciones = () => pagina.porId("miFichaHerramientasOpciones");

  pagina.escribir("herramientas", "p");

  assert.equal(opciones().hidden, false);
  assert.deepEqual(opciones().children.map((opcion) => opcion.textContent), ["PostgreSQL", "Python"]);
  assert.equal(pagina.porId("miFichaHerramientas").getAttribute("aria-expanded"), "true");

  pagina.escribir("herramientas", "");
  assert.equal(opciones().hidden, true);
  assert.equal(pagina.porId("miFichaHerramientas").getAttribute("aria-expanded"), "false");
});

test("ArrowDown and ArrowUp move the highlighted suggestion, clamped at the edges", async () => {
  const pagina = await cargarPagina({ catalogo: ["Postgres", "Python", "PHP"] });
  const input = pagina.porId("miFichaHerramientas");
  pagina.escribir("herramientas", "p");

  input.disparar("keydown", { key: "ArrowDown" });
  assert.equal(opcionResaltada(pagina).textContent, "Postgres");
  assert.equal(input.getAttribute("aria-activedescendant"), "miFichaHerramientasOpcion0");

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
  pagina.escribir("herramientas", "Rust");

  pagina.porId("miFichaHerramientas").disparar("keydown", { key: "Enter" });

  assert.deepEqual(pagina.etiquetasEnPantalla("herramientas"), ["Rust"]);
  assert.equal(pagina.porId("miFichaHerramientas").value, "");
  assert.equal(pagina.porId("miFichaHerramientasOpciones").hidden, true);
});

test("Enter with a highlighted suggestion confirms that suggestion, not the typed text", async () => {
  const pagina = await cargarPagina({ catalogo: ["PostgreSQL", "Python"] });
  const input = pagina.porId("miFichaHerramientas");
  pagina.escribir("herramientas", "pos");
  input.disparar("keydown", { key: "ArrowDown" });

  input.disparar("keydown", { key: "Enter" });

  assert.deepEqual(pagina.etiquetasEnPantalla("herramientas"), ["PostgreSQL"]);
});

test("a comma confirms the entry, just like Enter", async () => {
  const pagina = await cargarPagina();
  pagina.escribir("herramientas", "Go");

  pagina.porId("miFichaHerramientas").disparar("keydown", { key: "," });

  assert.deepEqual(pagina.etiquetasEnPantalla("herramientas"), ["Go"]);
});

test("Escape closes the listbox without touching the text or the tools", async () => {
  const pagina = await cargarPagina({ catalogo: ["PostgreSQL", "Python"] });
  const input = pagina.porId("miFichaHerramientas");
  pagina.escribir("herramientas", "pos");

  input.disparar("keydown", { key: "Escape" });

  assert.equal(pagina.porId("miFichaHerramientasOpciones").hidden, true);
  assert.equal(input.value, "pos");
  assert.deepEqual(pagina.etiquetasEnPantalla("herramientas"), []);
});

test("adding a duplicate announces it, highlights the existing tag and does not grow the tools list", async () => {
  const pagina = await cargarPagina();
  pagina.agregarEtiqueta("herramientas", "PostgreSQL");

  pagina.agregarEtiqueta("herramientas", "  POSTGRESQL  ");

  assert.deepEqual(pagina.etiquetasEnPantalla("herramientas"), ["PostgreSQL"]);
  assert.equal(pagina.texto("miFichaHerramientasEstado"), "PostgreSQL ya está en tus herramientas.");
  assert.ok(manijaHerramienta(pagina, 0).parent.classList.contains("mi-ficha__etiqueta--duplicada"));
});

test("the twelfth technology disables the input and the help says so; removing one re-enables it", async () => {
  const pagina = await cargarPagina();
  for (let i = 0; i < 12; i += 1) pagina.agregarEtiqueta("herramientas", `T${i}`);

  assert.equal(pagina.etiquetasEnPantalla("herramientas").length, 12);
  assert.equal(pagina.porId("miFichaHerramientas").disabled, true);
  assert.match(pagina.texto("miFichaHerramientasAyuda"), /12/);

  quitarHerramienta(pagina, 0).disparar("click");

  assert.equal(pagina.etiquetasEnPantalla("herramientas").length, 11);
  assert.equal(pagina.porId("miFichaHerramientas").disabled, false);
});

test("removing a tag moves focus to the handle at the same index, then the previous one, then the input when the list empties", async () => {
  const pagina = await cargarPagina();
  ["A", "B", "C"].forEach((tecnologia) => pagina.agregarEtiqueta("herramientas", tecnologia));

  // Quita "B" (índice 1): el foco va a la manija que ocupa ese índice ahora ("C").
  quitarHerramienta(pagina, 1).disparar("click");
  assert.deepEqual(pagina.etiquetasEnPantalla("herramientas"), ["A", "C"]);
  assert.equal(pagina.activo(), manijaHerramienta(pagina, 1));

  // Quita "C", que ahora es la última (índice 1 de 2): el foco va a la anterior.
  quitarHerramienta(pagina, 1).disparar("click");
  assert.deepEqual(pagina.etiquetasEnPantalla("herramientas"), ["A"]);
  assert.equal(pagina.activo(), manijaHerramienta(pagina, 0));

  // Quita la última que queda: la lista se vacía y el foco va al input.
  quitarHerramienta(pagina, 0).disparar("click");
  assert.deepEqual(pagina.etiquetasEnPantalla("herramientas"), []);
  assertFocoEn(pagina, "miFichaHerramientas");
});

test("Backspace on an empty input removes the last tag and keeps focus on the input", async () => {
  const pagina = await cargarPagina();
  ["A", "B"].forEach((tecnologia) => pagina.agregarEtiqueta("herramientas", tecnologia));
  const input = pagina.porId("miFichaHerramientas");
  input.focus();

  input.disparar("keydown", { key: "Backspace" });

  assert.deepEqual(pagina.etiquetasEnPantalla("herramientas"), ["A"]);
  assertFocoEn(pagina, "miFichaHerramientas");
});

test("keyboard reordering from the handle moves the tag and focus follows it", async () => {
  const pagina = await cargarPagina();
  ["A", "B", "C"].forEach((tecnologia) => pagina.agregarEtiqueta("herramientas", tecnologia));

  manijaHerramienta(pagina, 0).disparar("keydown", { key: "ArrowRight" });

  assert.deepEqual(pagina.etiquetasEnPantalla("herramientas"), ["B", "A", "C"]);
  assert.equal(pagina.activo(), manijaHerramienta(pagina, 1));
  assert.equal(pagina.texto("miFichaHerramientasEstado"), "A, posición 2 de 3.");

  manijaHerramienta(pagina, 1).disparar("keydown", { key: "End" });
  assert.deepEqual(pagina.etiquetasEnPantalla("herramientas"), ["B", "C", "A"]);
  assert.equal(pagina.activo(), manijaHerramienta(pagina, 2));
});

test("a missing technology catalog script degrades silently: no suggestions, but free text still works", async () => {
  const pagina = await cargarPagina(); // sin `catalogo`: el script del catálogo no llegó.

  pagina.escribir("herramientas", "cualquier cosa");
  assert.equal(pagina.porId("miFichaHerramientasOpciones").hidden, true, "sin catálogo no hay nada que sugerir");

  pagina.porId("miFichaHerramientas").disparar("keydown", { key: "Enter" });
  assert.deepEqual(pagina.etiquetasEnPantalla("herramientas"), ["cualquier cosa"]);
  assert.equal(pagina.errores.length, 0, "la ausencia del catálogo no se avisa ni se reintenta");
});

test("preloading a card with a technology outside the catalog keeps it exactly as it is", async () => {
  const pagina = await cargarPagina({
    catalogo: ["Python", "PostgreSQL"],
    ficha: enSecuencia(exito({ ...structuredClone(FICHA), herramientas: ["Un framework rarísimo"] })),
  });

  assert.deepEqual(pagina.etiquetasEnPantalla("herramientas"), ["Un framework rarísimo"]);
});

/* ---------- Las tres listas de etiquetas ---------- */

/*
  La fábrica del editor se instancia tres veces sobre el mismo documento. Todo
  lo que sigue existe porque, hasta que entraron habilidades e idiomas, había
  UNA sola instancia: la parametrización por `campo` se podía romper entera
  sin que ningún test se enterara (mutante verificado: volver a fijar
  "herramientas" adentro de la fábrica sobrevivía).
*/

// La manija (hijo 0) y el botón de quitar (hijo 2) de la etiqueta en el
// índice dado, para cualquiera de las tres listas.
function manijaDeEtiqueta(pagina, campo, indice) {
  return pagina.porId(`${ID_DE[campo]}Lista`).children[indice].children[0];
}

function quitarDeEtiqueta(pagina, campo, indice) {
  return pagina.porId(`${ID_DE[campo]}Lista`).children[indice].children[2];
}

test("the three tag lists are independent: adding, removing and reordering one leaves the others alone", async () => {
  const pagina = await cargarPagina();

  ["Python", "Docker"].forEach((etiqueta) => pagina.agregarEtiqueta("herramientas", etiqueta));
  ["TDD", "Scrum"].forEach((etiqueta) => pagina.agregarEtiqueta("habilidades", etiqueta));
  pagina.agregarEtiqueta("idiomas", "Español");

  assert.deepEqual(pagina.etiquetasEnPantalla("herramientas"), ["Python", "Docker"]);
  assert.deepEqual(pagina.etiquetasEnPantalla("habilidades"), ["TDD", "Scrum"]);
  assert.deepEqual(pagina.etiquetasEnPantalla("idiomas"), ["Español"]);

  // Quitar en habilidades no toca a las otras dos.
  quitarDeEtiqueta(pagina, "habilidades", 0).disparar("click");
  assert.deepEqual(pagina.etiquetasEnPantalla("habilidades"), ["Scrum"]);
  assert.deepEqual(pagina.etiquetasEnPantalla("herramientas"), ["Python", "Docker"]);
  assert.deepEqual(pagina.etiquetasEnPantalla("idiomas"), ["Español"]);

  // Reordenar en herramientas tampoco: el arrastre y el teclado de cada
  // instancia capturan sobre SU <ul>, no sobre el documento.
  manijaDeEtiqueta(pagina, "herramientas", 0).disparar("keydown", { key: "ArrowRight" });
  assert.deepEqual(pagina.etiquetasEnPantalla("herramientas"), ["Docker", "Python"]);
  assert.deepEqual(pagina.etiquetasEnPantalla("habilidades"), ["Scrum"]);
  assert.deepEqual(pagina.etiquetasEnPantalla("idiomas"), ["Español"]);

  // Y cada una anuncia por SU región aria-live.
  assert.equal(pagina.texto("miFichaHerramientasEstado"), "Python, posición 2 de 2.");
  assert.equal(pagina.texto("miFichaHabilidadesEstado"), "");
  assert.equal(pagina.texto("miFichaIdiomasEstado"), "");
});

/*
  La misma etiqueta en dos listas distintas NO es un duplicado: "Docker" puede
  ser herramienta de una persona y no estar en sus habilidades. La dedupe es
  por lista, nunca entre listas.
*/
test("the same text can live in two different lists without being a duplicate", async () => {
  const pagina = await cargarPagina();

  pagina.agregarEtiqueta("herramientas", "Docker");
  pagina.agregarEtiqueta("habilidades", "Docker");

  assert.deepEqual(pagina.etiquetasEnPantalla("herramientas"), ["Docker"]);
  assert.deepEqual(pagina.etiquetasEnPantalla("habilidades"), ["Docker"]);
  assert.equal(pagina.texto("miFichaHabilidadesEstado"), "", "no se anunció ningún duplicado");
});

// Cada editor pide SU catálogo y se queda con el suyo: si compartieran la
// lista, escribir "e" en idiomas sugeriría herramientas.
test("each editor suggests from its own catalog", async () => {
  const pagina = await cargarPagina({
    catalogo: {
      herramientas: ["Elixir", "Express"],
      habilidades: ["Estadística"],
      idiomas: ["Español", "Euskera"],
    },
  });
  const opcionesDe = (campo) => pagina.porId(`${ID_DE[campo]}Opciones`).children.map((opcion) => opcion.textContent);

  pagina.escribir("herramientas", "e");
  pagina.escribir("habilidades", "e");
  pagina.escribir("idiomas", "e");

  assert.deepEqual(opcionesDe("herramientas"), ["Elixir", "Express"]);
  assert.deepEqual(opcionesDe("habilidades"), ["Estadística"]);
  assert.deepEqual(opcionesDe("idiomas"), ["Español", "Euskera"]);
});

/*
  Un catálogo que falla no se lleva a los otros dos: se piden en paralelo y
  cada promesa resuelve su propio { ok }.
*/
test("a catalog that fails to load leaves the other two suggesting", async () => {
  const pagina = await cargarPagina({ catalogo: { herramientas: ["Python"], idiomas: ["Español"] } });

  pagina.escribir("herramientas", "p");
  pagina.escribir("habilidades", "p");
  pagina.escribir("idiomas", "e");

  assert.equal(pagina.porId("miFichaHerramientasOpciones").hidden, false);
  assert.equal(pagina.porId("miFichaHabilidadesOpciones").hidden, true, "sin catálogo no hay nada que sugerir");
  assert.equal(pagina.porId("miFichaIdiomasOpciones").hidden, false);
  assert.equal(pagina.errores.length, 0, "un catálogo que no carga no se avisa");
});

/*
  Habilidades e idiomas son OPCIONALES: la 0041 les pone `between 0 and 12` y
  las declara `not null default '{}'`. Una ficha sin ellas se guarda, y lo que
  viaja es el arreglo vacío, nunca null.
*/
test("a card saves with empty skills and languages: both are optional", async () => {
  const pagina = await cargarPagina();
  llenar(pagina, { ...VALORES_VALIDOS, habilidades: [], idiomas: [] });

  const evento = await pagina.enviar();

  assert.equal(evento.defaultPrevented, true);
  assert.equal(pagina.guardarMiFicha.llamadas.length, 1, "se llamó al servicio: no hubo error de validación");
  const [, ficha] = pagina.guardarMiFicha.llamadas[0];
  assert.deepEqual(ficha.habilidades, []);
  assert.deepEqual(ficha.idiomas, []);
  assert.deepEqual(ficha.herramientas, ["PostgreSQL", "Python", "GCP"]);
  assert.equal(pagina.porId("miFichaHabilidadesError").hidden, true);
  assert.equal(pagina.porId("miFichaIdiomasError").hidden, true);
});

/*
  Al revés que herramientas, que sí es obligatoria: un envío con las tres
  vacías marca SÓLO herramientas. Es el error que se cometería copiando el
  mínimo de una lista a las otras.
*/
test("submitting with the three lists empty marks tools only", async () => {
  const pagina = await cargarPagina();
  llenar(pagina, { ...VALORES_VALIDOS, herramientas: [], habilidades: [], idiomas: [] });

  await pagina.enviar();

  assert.equal(pagina.texto("miFichaHerramientasError"), "Escribe al menos una herramienta.");
  assert.equal(pagina.porId("miFichaHabilidadesError").hidden, true);
  assert.equal(pagina.porId("miFichaIdiomasError").hidden, true);
  assert.equal(pagina.guardarMiFicha.llamadas.length, 0);
});

// El tope de 12 y el largo de 40 caracteres valen igual en las tres, con el
// mensaje de SU campo.
test("the per-field limits speak in the name of the field that broke them", async () => {
  const pagina = await cargarPagina();

  pagina.agregarEtiqueta("habilidades", "a".repeat(41));
  assert.equal(pagina.texto("miFichaHabilidadesError"), "Cada habilidad puede tener hasta 40 caracteres.");

  pagina.agregarEtiqueta("idiomas", "b".repeat(41));
  assert.equal(pagina.texto("miFichaIdiomasError"), "Cada idioma puede tener hasta 40 caracteres.");

  for (let i = 0; i < 12; i += 1) pagina.agregarEtiqueta("idiomas", `Idioma ${i}`);
  assert.equal(pagina.porId("miFichaIdiomas").disabled, true, "con 12 no se puede escribir otro");
  assert.equal(
    pagina.texto("miFichaIdiomasAyuda"),
    "Ya tienes 12 idiomas, el máximo. Quita alguno para escribir otro.",
  );
  // Y el tope de una lista no desactiva las otras.
  assert.equal(pagina.porId("miFichaHabilidades").disabled, false);
  assert.equal(pagina.porId("miFichaHerramientas").disabled, false);
});

/*
  EL error más probable al instanciar la fábrica tres veces: el prefijo de los
  id de opción. Las opciones nunca reciben foco —el resaltado se lleva con
  aria-activedescendant en el input—, así que si dos instancias generaran el
  mismo id, dos listbox abiertos escribirían el mismo y el lector de pantalla
  anunciaría la opción de la OTRA lista.

  Los ids distintos en el HTML no alcanzan para verlo: los de las opciones los
  crea la fábrica en tiempo de ejecución, uno por sugerencia pintada.
*/
test("two open listboxes point at option ids of their own, never at each other's", async () => {
  const pagina = await cargarPagina({
    catalogo: { herramientas: ["Python"], habilidades: ["Pair programming"], idiomas: ["Portugués"] },
  });

  for (const campo of LISTAS_DE_ETIQUETAS) {
    pagina.escribir(campo, "p");
    pagina.porId(ID_DE[campo]).disparar("keydown", { key: "ArrowDown" });
  }

  const activos = LISTAS_DE_ETIQUETAS.map((campo) => pagina.porId(ID_DE[campo]).getAttribute("aria-activedescendant"));
  assert.deepEqual(activos, ["miFichaHerramientasOpcion0", "miFichaHabilidadesOpcion0", "miFichaIdiomasOpcion0"]);

  // Y el id apuntado existe DENTRO del desplegable de su propio campo.
  for (const [indice, campo] of LISTAS_DE_ETIQUETAS.entries()) {
    const opciones = pagina.porId(`${ID_DE[campo]}Opciones`).children;
    assert.deepEqual(opciones.map((opcion) => opcion.attributes.id), [activos[indice]], campo);
  }
});

/* ---------- Empresa y su enlace ---------- */

/*
  El único error CRUZADO del formulario: el enlace se marca por un valor que
  no está en él, sino en el campo de al lado. Se marca en el enlace y no en la
  empresa porque el enlace es el que sobra — quien no quiere poner empresa
  tiene que poder guardar, y el que estorba es el enlace huérfano.
*/
test("a company link without a company name marks the link, not the name", async () => {
  const pagina = await cargarPagina();
  llenar(pagina, { ...VALORES_VALIDOS, empresa: "", empresa_enlace: "https://taudux.com" });

  await pagina.enviar();

  assert.equal(pagina.texto("miFichaEmpresaEnlaceError"), "Escribe el nombre de la empresa para poder enlazarla.");
  assert.equal(pagina.porId("miFichaEmpresaError").hidden, true, "el nombre vacío no es un error: es opcional");
  assert.equal(pagina.guardarMiFicha.llamadas.length, 0);
  assertFocoEn(pagina, "miFichaEmpresaEnlace");
});

// Escribir el nombre desbloquea el envío sin tocar el enlace: el error se
// arregla desde el OTRO campo.
test("writing the company name fixes the link error without touching the link", async () => {
  const pagina = await cargarPagina();
  llenar(pagina, { ...VALORES_VALIDOS, empresa: "", empresa_enlace: "https://taudux.com" });
  await pagina.enviar();

  pagina.escribir("empresa", "Taudux");
  await pagina.enviar();

  assert.equal(pagina.guardarMiFicha.llamadas.length, 1);
  const [, ficha] = pagina.guardarMiFicha.llamadas[0];
  assert.equal(ficha.empresa, "Taudux");
  assert.equal(ficha.empresa_enlace, "https://taudux.com");
});

/*
  Los dos son opcionales y su ausencia viaja como null, nunca como "": el
  CHECK de la 0041 deja pasar el nulo y rechaza la cadena vacía.
*/
test("a card saves with no company at all, and the absence travels as null", async () => {
  const pagina = await cargarPagina();
  llenar(pagina, { ...VALORES_VALIDOS, empresa: "", empresa_enlace: "" });

  await pagina.enviar();

  assert.equal(pagina.guardarMiFicha.llamadas.length, 1);
  const [, ficha] = pagina.guardarMiFicha.llamadas[0];
  assert.equal(ficha.empresa, null);
  assert.equal(ficha.empresa_enlace, null);
});

// El nombre sin enlace es un estado útil: se guarda y el perfil lo muestra
// como texto plano.
test("a company name without a link is a valid card", async () => {
  const pagina = await cargarPagina();
  llenar(pagina, { ...VALORES_VALIDOS, empresa: "  Taudux  ", empresa_enlace: "" });

  await pagina.enviar();

  const [, ficha] = pagina.guardarMiFicha.llamadas[0];
  assert.equal(ficha.empresa, "Taudux", "el nombre se recorta como cualquier otro texto");
  assert.equal(ficha.empresa_enlace, null);
});

// Un enlace que la base rechazaría se avisa acá, antes de enviarlo.
test("a company link the database would reject is caught before sending", async () => {
  for (const malo of ["javascript:alert(1)", "http://taudux.com", "https://intranet"]) {
    const pagina = await cargarPagina();
    llenar(pagina, { ...VALORES_VALIDOS, empresa: "Taudux", empresa_enlace: malo });

    await pagina.enviar();

    assert.equal(pagina.texto("miFichaEmpresaEnlaceError"), "Usa un enlace https, por ejemplo https://tuempresa.com.", malo);
    assert.equal(pagina.guardarMiFicha.llamadas.length, 0, malo);
  }
});
