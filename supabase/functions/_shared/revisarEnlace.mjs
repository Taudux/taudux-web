// revisarEnlace: decide si un link puede ir dentro de un QR de Taudux.
//
// Lógica pura salvo consultarWebRisk, que recibe su fetch inyectado. La usan
// crear-qr (al crear) y revisar-qr (la revisión diaria), y los tests de Node.
//
// TRES CAPAS, en este orden:
//
//   1. Reglas que rechazan sin preguntar: lo que ningún link legítimo necesita
//      (http sin cifrar, una IP, usuario@ en el link, un acortador que esconde
//      el destino, un instalador .exe/.apk…).
//   2. La lista confiable: proveedores de formularios conocidos. Pasan sin las
//      reglas extra de la capa 3 —no sin Web Risk: Google Forms también se usa
//      para phishing, precisamente porque su dominio inspira confianza—.
//   3. Para cualquier otro dominio, reglas de procedencia rara (terminaciones
//      muy abusadas, marcas imitadas, subdominios en cascada) y Google Web
//      Risk obligatorio: si no se pudo consultar, no se crea.
//
// Los códigos de rechazo son estables: el frontend (qr.nucleo.js) los traduce a
// mensajes. Renombrar uno acá sin tocar allá deja al usuario sin explicación.

export const LARGO_MAXIMO = 2048;

// El dominio del redireccionador: un QR que apunta a otro QR sólo sirve para
// esconder el destino real.
export const DOMINIOS_PROPIOS = ["go.taudux.com"];

/*
  LA LISTA CONFIABLE. `sufijo` acepta el dominio y sus subdominios; `ruta`
  exige además que el camino empiece así (docs.google.com sirve documentos y
  archivos que cualquiera sube, y sólo /forms/ es el formulario).
  Agregar un proveedor es agregar una línea acá y desplegar crear-qr.
*/
export const LISTA_CONFIABLE = Object.freeze([
  { nombre: "Google Forms", sufijo: "forms.gle" },
  { nombre: "Google Forms", sufijo: "docs.google.com", ruta: "/forms/" },
  { nombre: "Microsoft Forms", sufijo: "forms.office.com" },
  { nombre: "Microsoft Forms", sufijo: "forms.microsoft.com" },
  { nombre: "Microsoft Forms", sufijo: "forms.cloud.microsoft" },
  { nombre: "Typeform", sufijo: "typeform.com" },
  { nombre: "Jotform", sufijo: "jotform.com" },
  { nombre: "SurveyMonkey", sufijo: "surveymonkey.com" },
  { nombre: "Tally", sufijo: "tally.so" },
  { nombre: "YouTube", sufijo: "youtube.com" },
  { nombre: "YouTube", sufijo: "youtu.be" },
  { nombre: "Taudux", sufijo: "taudux.com" },
]);

// Acortadores: esconden el destino real, y el destino es justo lo que se
// revisa. forms.gle y youtu.be no están acá porque sólo llevan a su servicio.
const ACORTADORES = new Set([
  "bit.ly", "bitly.com", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd",
  "v.gd", "buff.ly", "cutt.ly", "rebrand.ly", "shorturl.at", "rb.gy",
  "tiny.cc", "s.id", "t.ly", "bl.ink", "lnkd.in", "shorte.st", "adf.ly",
  "qrco.de", "urlz.fr", "u.to", "clck.ru",
]);

// Instaladores y scripts: un QR no debería descargar un programa.
const EXTENSIONES_PELIGROSAS = /\.(exe|msi|apk|xapk|bat|cmd|com|scr|pif|ps1|vbs|vbe|jse?|wsf|hta|jar|dmg|pkg|iso|img|lnk|reg)$/i;

/*
  Terminaciones con tasas de abuso muy por encima del resto en los reportes
  públicos de phishing (Spamhaus, Interisle). No todo lo que termina así es
  malicioso, pero para un QR gratis la regla es simple: si no está en la lista
  confiable, que no venga de acá.
*/
const TERMINACIONES_RIESGOSAS = new Set([
  "zip", "mov", "top", "icu", "cfd", "sbs", "click", "buzz", "rest", "cam",
  "tk", "ml", "ga", "cf", "gq", "cyou", "monster", "bond", "xin",
]);

/*
  Marcas que el phishing imita. Si el nombre aparece en el dominio pero el
  dominio NO es de la marca (login-bbva.com, bbva.seguridad-mx.com), se
  rechaza. `propios` son los nombres de dominio legítimos de cada marca.
*/
const MARCAS = Object.freeze([
  { marca: "BBVA", token: "bbva", propios: ["bbva"] },
  { marca: "Banamex", token: "banamex", propios: ["banamex", "citibanamex"] },
  { marca: "Santander", token: "santander", propios: ["santander"] },
  { marca: "Banorte", token: "banorte", propios: ["banorte"] },
  { marca: "HSBC", token: "hsbc", propios: ["hsbc"] },
  { marca: "Scotiabank", token: "scotiabank", propios: ["scotiabank"] },
  { marca: "Mercado Pago", token: "mercadopago", propios: ["mercadopago", "mercadolibre"] },
  { marca: "PayPal", token: "paypal", propios: ["paypal"] },
  { marca: "Apple", token: "icloud", propios: ["icloud", "apple"] },
  { marca: "Microsoft", token: "microsoft", propios: ["microsoft", "microsoftonline"] },
  { marca: "Microsoft", token: "office365", propios: ["office365", "office"] },
  { marca: "Netflix", token: "netflix", propios: ["netflix"] },
  { marca: "Amazon", token: "amazon", propios: ["amazon", "amazonaws"] },
  { marca: "Facebook", token: "facebook", propios: ["facebook"] },
  { marca: "Instagram", token: "instagram", propios: ["instagram"] },
  { marca: "WhatsApp", token: "whatsapp", propios: ["whatsapp"] },
  { marca: "Google", token: "gmail", propios: ["gmail", "google"] },
  { marca: "Binance", token: "binance", propios: ["binance"] },
  { marca: "Coinbase", token: "coinbase", propios: ["coinbase"] },
]);

// Segundos niveles de país que funcionan como terminación (banorte.com.mx):
// el nombre del dominio es la etiqueta ANTERIOR a ellos.
const SEGUNDOS_NIVELES = new Set(["com", "org", "net", "gob", "gov", "edu", "co", "ac", "mil"]);

const MAXIMO_ETIQUETAS = 5;

function ok(url, confiable, proveedor = null) {
  return { ok: true, url, confiable, proveedor };
}

function rechazo(codigo, detalle = null) {
  return detalle ? { ok: false, codigo, detalle } : { ok: false, codigo };
}

function coincide(host, sufijo) {
  return host === sufijo || host.endsWith(`.${sufijo}`);
}

function esIP(host) {
  // Una IPv6 llega entre corchetes; una IPv4 son cuatro números. `URL` ya
  // normaliza formas raras (0x7f.1, 2130706433) a la forma de puntos.
  return host.startsWith("[") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

// El nombre "registrable" de un host: bbva en www.bbva.mx y en bbva.com.mx.
function nombreDeDominio(etiquetas) {
  const n = etiquetas.length;
  if (n >= 3 && etiquetas[n - 1].length === 2 && SEGUNDOS_NIVELES.has(etiquetas[n - 2])) {
    return etiquetas[n - 3];
  }
  return etiquetas[n - 2] ?? etiquetas[0];
}

export function proveedorConfiable(url) {
  const host = url.hostname;
  const entrada = LISTA_CONFIABLE.find((item) =>
    coincide(host, item.sufijo) && (!item.ruta || url.pathname.startsWith(item.ruta)));
  return entrada ? entrada.nombre : null;
}

/*
  Capas 1 a 3, sin red. Devuelve { ok: true, url, confiable, proveedor } con la
  URL normalizada (la que se guarda), o { ok: false, codigo, detalle? }.
*/
export function evaluarEnlace(texto) {
  const crudo = typeof texto === "string" ? texto.trim() : "";
  if (!crudo) return rechazo("enlace_vacio");
  if (crudo.length > LARGO_MAXIMO) return rechazo("enlace_largo");
  // `URL` borra en silencio tabs y saltos de línea: un link que los trae no es
  // uno que alguien copió de la barra del navegador.
  if (/[\u0000-\u001f\u007f\s]/.test(crudo)) return rechazo("enlace_invalido");

  let url;
  try {
    url = new URL(crudo);
  } catch {
    return rechazo("enlace_invalido");
  }

  if (url.protocol === "http:") return rechazo("enlace_no_https");
  if (url.protocol !== "https:") return rechazo("enlace_invalido");
  // https://google.com@sitio-malo.com lleva a sitio-malo.com.
  if (url.username || url.password) return rechazo("enlace_con_credenciales");
  if (url.port) return rechazo("enlace_puerto");

  const host = url.hostname;
  if (esIP(host)) return rechazo("enlace_ip");
  // "ejemplo.com." es válido para DNS pero nadie lo escribe así; aceptarlo
  // haría que la última etiqueta (la terminación) quedara vacía.
  if (host.endsWith(".")) return rechazo("enlace_invalido");
  const etiquetas = host.split(".");
  if (etiquetas.length < 2 || host === "localhost" ||
      /\.(local|localhost|internal|lan|home|test|invalid|example)$/.test(host)) {
    return rechazo("enlace_invalido");
  }
  // xn-- es un dominio con letras de otro alfabeto que pueden imitar a las
  // latinas (аpple.com con "а" cirílica).
  if (etiquetas.some((etiqueta) => etiqueta.startsWith("xn--"))) return rechazo("enlace_punycode");
  if (DOMINIOS_PROPIOS.some((propio) => coincide(host, propio))) return rechazo("enlace_propio");
  if (ACORTADORES.has(host) || ACORTADORES.has(host.replace(/^www\./, ""))) {
    return rechazo("enlace_acortador");
  }
  if (EXTENSIONES_PELIGROSAS.test(url.pathname)) return rechazo("enlace_descarga");
  // No es un riesgo, es un error frecuente: el link de EDICIÓN de un Google
  // Form pasa la lista confiable, pero quien lo escanea no puede responder.
  if (host === "docs.google.com" && /^\/forms\/(?:u\/\d+\/)?d\/[^/]+\/edit\/?$/.test(url.pathname)) {
    return rechazo("enlace_formulario_edicion");
  }

  const proveedor = proveedorConfiable(url);
  if (proveedor) return ok(url.href, true, proveedor);

  if (TERMINACIONES_RIESGOSAS.has(etiquetas.at(-1))) return rechazo("enlace_dominio_riesgoso");

  const nombre = nombreDeDominio(etiquetas);
  const imitada = MARCAS.find(({ token, propios }) =>
    host.includes(token) && !propios.includes(nombre));
  if (imitada) return rechazo("enlace_suplantacion", imitada.marca);

  if (etiquetas.length > MAXIMO_ETIQUETAS) return rechazo("enlace_subdominios");

  return ok(url.href, false);
}

// --------------------------------------------------------------------------- //
// Google Web Risk
// --------------------------------------------------------------------------- //

export const WEB_RISK_URL = "https://webrisk.googleapis.com/v1/uris:search";
export const TIPOS_DE_AMENAZA = Object.freeze(["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE"]);
export const WEB_RISK_TIMEOUT_MS = 4000;

/*
  Consulta el Lookup API (uris.search). Nunca lanza. Devuelve:
    { estado: "limpio" }                        → {} en la respuesta
    { estado: "peligroso", amenazas: [...] }    → { threat: { threatTypes } }
    { estado: "sin_configurar" }                → no hay API key
    { estado: "error" }                         → red, timeout o HTTP no 2xx

  Uso comercial: Safe Browsing es sólo no comercial; Web Risk es su versión
  comercial (100,000 consultas al mes sin costo, verificado el 2026-09-28).
*/
export async function consultarWebRisk({ url, apiKey, fetchImpl, timeoutMs = WEB_RISK_TIMEOUT_MS }) {
  if (!apiKey) return { estado: "sin_configurar", amenazas: [] };

  const parametros = new URLSearchParams();
  for (const tipo of TIPOS_DE_AMENAZA) parametros.append("threatTypes", tipo);
  parametros.set("uri", url);
  parametros.set("key", apiKey);

  try {
    const respuesta = await fetchImpl(`${WEB_RISK_URL}?${parametros}`, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!respuesta.ok) return { estado: "error", amenazas: [], http: respuesta.status };
    const cuerpo = await respuesta.json();
    const tipos = cuerpo?.threat?.threatTypes;
    const amenazas = Array.isArray(tipos) ? tipos.filter((tipo) => typeof tipo === "string") : [];
    return amenazas.length > 0 ? { estado: "peligroso", amenazas } : { estado: "limpio", amenazas: [] };
  } catch {
    return { estado: "error", amenazas: [] };
  }
}
