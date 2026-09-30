/*
  Núcleo del generador de QR: lógica pura, sin DOM ni red. La usan qr.js y
  admin.js en el navegador, y tests/qr-nucleo.test.js en Node.

  LAS REGLAS NO VIVEN ACÁ. El límite de 5, los 7 días y quién puede qué los
  aplica la base (0044) y la edge function crear-qr. Lo de este archivo es
  sólo cómo se MUESTRAN: si algo de acá discrepara con la base, gana la base y
  la pantalla quedaría mintiendo — por eso `cupoQR` replica exactamente el
  conteo de qr_motivo_rechazo() y no inventa uno propio.
*/

// El dominio del redireccionador (qr-redireccion/). Lo que va DENTRO del QR.
const QR_BASE = "https://go.taudux.com";
const QR_TITULO_MAXIMO = 80;

/*
  EL DIBUJO: estilo "puntos suaves" (elegido el 2026-09-28 entre tres
  propuestas). Módulos como puntos, los tres ojos y el patrón de alineación
  como cuadros de esquinas redondeadas, y al centro una insignia circular
  blanca con el isotipo a color. Nivel de corrección H (tolera ~30% de daño)
  porque la insignia tapa el centro: en un QR de 33×33 cubre ~9% del área.

  LA REGLA QUE NO SE NEGOCIA: lo que el lector BUSCA para orientarse (los tres
  ojos y el patrón de alineación) se dibuja como anillos sólidos, nunca con
  puntos. Con la alineación en puntos, jsQR no leyó el QR en ninguna de 7
  condiciones; como anillo, jsQR y ZXing lo leyeron 21 de 21 veces (1024, 300 y
  180 px, borroso, girado 12°, JPEG al 30% y sobre fondo oscuro). Medido el
  2026-09-28: cambiar radios, formas o proporciones obliga a volver a medir.
*/
const QR_MARGEN = 4; // la zona blanca mínima que pide el estándar
const QR_TINTA = "#0a1f4f"; // azul marino de la marca: contraste ~16:1 con el blanco
const QR_AZUL = "#1249a4"; // los ojos: contraste ~8:1, de sobra para el lector
const QR_BORDE_INSIGNIA = "#dbe3f0";
const QR_RADIO_PUNTO = 0.42;
const QR_PROPORCION_INSIGNIA = 0.3;
const QR_RADIO_TARJETA = 2.6;
// Redondeo de los ojos (7×7 → hueco 5×5 → centro 3×3) y de la alineación
// (5×5 → 3×3 → 1×1), en módulos. Son los radios que se midieron.
const QR_RADIOS_OJO = Object.freeze([2.2, 1.5, 0.9]);
const QR_RADIOS_ALINEACION = Object.freeze([1.4, 0.8, 0.35]);

// Centros de los patrones de alineación por versión (ISO/IEC 18004), hasta la
// 10. Un link de go.taudux.com con nivel H es versión 4.
const QR_ALINEACION = Object.freeze({
  2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
  7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
});

// El isotipo como vector, con sus dos colores: los mismos polígonos del hero
// del extractor, en 0..100. Sin imagen que cargar ni que embeber.
const QR_ISOTIPO = Object.freeze([
  Object.freeze({ puntos: "46,6 2,50 46,94 46,80 16,50 46,20", color: "#1249a4" }),
  Object.freeze({ puntos: "54,6 98,50 54,94 54,80 84,50 54,20", color: "#29c2e2" }),
  Object.freeze({ puntos: "50,28 28,50 50,72", color: "#1249a4" }),
  Object.freeze({ puntos: "50,28 72,50 50,72", color: "#29c2e2" }),
]);

const MS_POR_MINUTO_QR = 60 * 1000;

function urlCortaQR(codigo) {
  return `${QR_BASE}/${codigo}`;
}

// "go.taudux.com/k3m9xa": lo que se lee en pantalla, sin el https:// que nadie teclea.
function urlVisibleQR(codigo) {
  return urlCortaQR(codigo).replace(/^https:\/\//, "");
}

/*
  activo | vencido | bloqueado. El bloqueo manda sobre el vencimiento: un QR
  bloqueado por phishing tiene que decir eso, aunque además haya vencido.
*/
function estadoQR(qr, ahora = Date.now()) {
  if (qr?.bloqueado_en) return "bloqueado";
  if (qr?.vence_en && Date.parse(qr.vence_en) <= ahora) return "vencido";
  return "activo";
}

function pluralQR(cantidad, singular, varios) {
  return `${cantidad} ${cantidad === 1 ? singular : varios}`;
}

/*
  { vencido, texto } para la tarjeta. Redondea hacia abajo a propósito: decir
  "vence en 1 h" cuando faltan 59 minutos promete tiempo que no hay.
*/
function tiempoRestanteQR(venceEn, ahora = Date.now()) {
  if (!venceEn) return { vencido: false, texto: "No vence" };
  const restante = Date.parse(venceEn) - ahora;
  if (!(restante > 0)) return { vencido: true, texto: "Venció" };

  const minutos = Math.floor(restante / MS_POR_MINUTO_QR);
  const dias = Math.floor(minutos / 1440);
  const horas = Math.floor((minutos % 1440) / 60);
  const resto = minutos % 60;

  let texto;
  if (dias > 0) texto = `${pluralQR(dias, "día", "días")} ${horas} h`;
  else if (horas > 0) texto = `${horas} h ${resto} min`;
  else if (resto > 0) texto = `${resto} min`;
  else texto = "menos de 1 min";
  return { vencido: false, texto: `Vence en ${texto}` };
}

/*
  qr_planes.duracion llega de PostgREST como texto de intervalo de Postgres
  ("7 days", "1 day 12:00:00", "168:00:00"). Devuelve días (con decimales si
  hace falta) o null si no hay duración o no se entiende.
*/
function duracionEnDiasQR(intervalo) {
  if (typeof intervalo !== "string" || !intervalo.trim()) return null;
  const dias = /(\d+)\s+days?/.exec(intervalo);
  const reloj = /(\d+):(\d{2}):(\d{2})/.exec(intervalo);
  if (!dias && !reloj) return null;
  const horas = (dias ? Number(dias[1]) * 24 : 0) + (reloj ? Number(reloj[1]) + Number(reloj[2]) / 60 : 0);
  return Math.round((horas / 24) * 10) / 10;
}

// El plan que rige: el de la persona si está activo, si no `free`. Igual que
// qr_plan_de() en 0044 (un admin ve también los planes apagados).
function planVigenteQR(planes, acceso) {
  const lista = Array.isArray(planes) ? planes : [];
  const propio = acceso?.plan
    ? lista.find((plan) => plan.clave === acceso.plan && plan.activo !== false)
    : null;
  return propio || lista.find((plan) => plan.clave === "free") || null;
}

/*
  Cuántos QR tiene y si puede crear otro. Cuenta como qr_motivo_rechazo(): los
  que no han vencido, bloqueados incluidos; un vencido libera su lugar.
*/
function cupoQR({ planes, acceso, qrs, ahora = Date.now() }) {
  const plan = planVigenteQR(planes, acceso);
  const vigentes = (Array.isArray(qrs) ? qrs : [])
    .filter((qr) => estadoQR(qr, ahora) !== "vencido").length;
  const base = {
    vigentes,
    limite: plan?.limite ?? null,
    dias: duracionEnDiasQR(plan?.duracion),
    ilimitado: false,
  };

  if (acceso?.bloqueado) return { ...base, puedeCrear: false, motivo: "cuenta_bloqueada" };
  if (acceso?.ilimitado) return { ...base, limite: null, dias: null, ilimitado: true, puedeCrear: true, motivo: null };

  const puedeCrear = base.limite === null || vigentes < base.limite;
  return { ...base, puedeCrear, motivo: puedeCrear ? null : "limite_alcanzado" };
}

function textoCupoQR(cupo) {
  if (cupo.ilimitado) return "Acceso ilimitado: tus QR no vencen.";
  const cuantos = cupo.limite === null
    ? `${pluralQR(cupo.vigentes, "QR activo", "QR activos")}`
    : `${cupo.vigentes} de ${cupo.limite} QR activos`;
  const duracion = cupo.dias ? ` · cada QR dura ${pluralQR(cupo.dias, "día", "días")}` : "";
  return `${cuantos}${duracion}`;
}

/*
  Lo que se revisa antes de mandar, para no hacer esperar a nadie por algo que
  se ve a simple vista. La revisión de verdad (reglas + Web Risk) es la de
  crear-qr: esto no la reemplaza.
*/
function validarFormularioQR({ destino, titulo }) {
  const limpio = String(destino ?? "").trim();
  if (!limpio) return { ok: false, codigo: "enlace_vacio" };
  if (!/^https?:\/\//i.test(limpio)) return { ok: false, codigo: "enlace_invalido" };
  if (/^http:\/\//i.test(limpio)) return { ok: false, codigo: "enlace_no_https" };
  if (String(titulo ?? "").trim().length > QR_TITULO_MAXIMO) return { ok: false, codigo: "titulo_largo" };
  return { ok: true };
}

// Los códigos de crear-qr y de _shared/revisarEnlace.mjs, en palabras.
const MENSAJES_ERROR_QR = Object.freeze({
  enlace_vacio: "Escribe el link al que debe llevar el QR.",
  enlace_largo: "El link es demasiado largo: el máximo es de 2048 caracteres.",
  enlace_invalido: "Ese link no es válido. Cópialo completo desde la barra del navegador, con https://.",
  enlace_no_https: "El link debe empezar con https:// (conexión segura).",
  enlace_con_credenciales: "El link trae un usuario o una contraseña antes del dominio, que es como se disfrazan los links engañosos.",
  enlace_puerto: "El link usa un puerto especial. Usa la dirección normal de la página.",
  enlace_ip: "Usa el nombre de la página (ejemplo.com), no una dirección IP.",
  enlace_punycode: "El dominio usa letras de otro alfabeto que pueden hacerse pasar por las normales.",
  enlace_propio: "Ese link ya es un QR de Taudux. Usa el link original.",
  enlace_acortador: "No aceptamos links acortados (bit.ly y similares) porque esconden a dónde llevan. Pega el link original.",
  enlace_descarga: "No creamos QR que descarguen programas o instaladores.",
  enlace_formulario_edicion: "Ése es el link para EDITAR tu formulario: quien escanee no podrá responderlo. En Google Forms usa el botón Enviar y copia el link para responder (empieza con https://forms.gle/).",
  enlace_dominio_riesgoso: "Ese dominio usa una terminación muy usada en engaños. Si es tu página, escríbenos.",
  enlace_suplantacion: "Ese link parece hacerse pasar por {marca}. Si es un sitio oficial, escríbenos.",
  enlace_subdominios: "El dominio tiene demasiados subdominios, un patrón común en links engañosos.",
  enlace_peligroso: "Google marcó este link como peligroso (phishing o malware). No podemos crear un QR para él.",
  revision_no_disponible: "No pudimos revisar este link con Google en este momento. Intenta de nuevo en unos minutos.",
  limite_alcanzado: "Ya tienes todos tus QR activos. Elimina uno o espera a que alguno venza.",
  demasiados_hoy: "Creaste muchos QR en las últimas 24 horas. Intenta de nuevo mañana.",
  cuenta_bloqueada: "Tu cuenta no puede crear QR. Si crees que es un error, escríbenos.",
  sin_cuenta: "Confirma tu correo para poder crear QR.",
  auth_required: "Tu sesión expiró. Vuelve a iniciar sesión.",
  titulo_largo: `El nombre puede tener hasta ${QR_TITULO_MAXIMO} caracteres.`,
  invalid_request: "No pudimos leer tu pedido. Recarga la página e intenta de nuevo.",
  payload_too_large: "El link es demasiado largo.",
});
const MENSAJE_ERROR_QR_GENERICO = "No pudimos crear el QR. Intenta de nuevo en unos minutos.";

function mensajeErrorQR(codigo, detalle) {
  const plantilla = MENSAJES_ERROR_QR[codigo];
  if (!plantilla) return MENSAJE_ERROR_QR_GENERICO;
  return plantilla.replace("{marca}", detalle ? String(detalle) : "una marca conocida");
}

// --- El dibujo ---------------------------------------------------------------

// Diámetro de la insignia en módulos: impar como el QR, para quedar centrada.
function ladoInsigniaQR(n) {
  let lado = Math.round(n * QR_PROPORCION_INSIGNIA);
  if (lado % 2 !== n % 2) lado += 1;
  return lado;
}

// Centros (fila, columna) de los patrones de alineación: todas las
// combinaciones de la tabla, menos las tres que caen sobre un ojo.
function alineacionesQR(n) {
  const centros = QR_ALINEACION[(n - 17) / 4] ?? [];
  const ultimo = centros[centros.length - 1];
  const pares = [];
  for (const fila of centros) {
    for (const col of centros) {
      const sobreOjo = (fila === 6 && col === 6) || (fila === 6 && col === ultimo) || (fila === ultimo && col === 6);
      if (!sobreOjo) pares.push([fila, col]);
    }
  }
  return pares;
}

/*
  Qué celdas NO llevan punto: las de los ojos y los patrones de alineación
  (se dibujan aparte, como anillos) y las que caen bajo la insignia, con un
  respiro de 0.35 módulos para que ningún punto la toque. Lo que se tapa lo
  recupera la corrección de errores.
*/
function geometriaQR(n) {
  const ojos = [[0, 0], [0, n - 7], [n - 7, 0]];
  const alineaciones = alineacionesQR(n);
  const radio = ladoInsigniaQR(n) / 2;
  const centro = n / 2;
  const enOjo = (fila, col) => ojos.some(([f, c]) => fila >= f && fila < f + 7 && col >= c && col < c + 7);
  const enAlineacion = (fila, col) => alineaciones.some(([f, c]) => Math.abs(fila - f) <= 2 && Math.abs(col - c) <= 2);
  const bajoInsignia = (fila, col) => Math.hypot(col + 0.5 - centro, fila + 0.5 - centro) < radio + 0.35;
  return {
    total: n + QR_MARGEN * 2,
    ojos,
    alineaciones,
    insignia: { cx: centro + QR_MARGEN, cy: centro + QR_MARGEN, radio, radioInterno: radio - 0.55 },
    reservado: (fila, col) => enOjo(fila, col) || enAlineacion(fila, col) || bajoInsignia(fila, col),
  };
}

// Sentido horario (sweep 1), igual que los rectángulos: con sentidos opuestos,
// lo que se encima se RESTA y deja huecos (regla nonzero). Pasó en el
// prototipo del 2026-09-28.
function circuloQR(cx, cy, r) {
  return `M${n4(cx - r)} ${n4(cy)}a${r} ${r} 0 1 1 ${n4(2 * r)} 0a${r} ${r} 0 1 1 ${n4(-2 * r)} 0z`;
}

// Cuadro de esquinas redondeadas, también en sentido horario.
function rectanguloRedondoQR(x, y, lado, r) {
  const recto = n4(lado - 2 * r);
  return `M${n4(x + r)} ${n4(y)}h${recto}a${r} ${r} 0 0 1 ${r} ${r}v${recto}a${r} ${r} 0 0 1 ${-r} ${r}` +
    `h${-recto}a${r} ${r} 0 0 1 ${-r} ${-r}v${-recto}a${r} ${r} 0 0 1 ${r} ${-r}z`;
}

// 7 − 2·2.2 da 2.5999999999999996: se dibuja igual, pero ensucia el SVG.
function n4(valor) {
  return Math.round(valor * 10000) / 10000;
}

// Tres cuadros concéntricos (exterior, hueco, centro): con evenodd, un anillo
// con su centro. Es la forma de los ojos y de la alineación.
function anilloQR(x, y, lado, radios) {
  return rectanguloRedondoQR(x, y, lado, radios[0]) +
    rectanguloRedondoQR(x + 1, y + 1, lado - 2, radios[1]) +
    rectanguloRedondoQR(x + 2, y + 2, lado - 4, radios[2]);
}

/*
  Todo lo que hay que pintar, como datos de trazo SVG en unidades de módulo
  (margen incluido). El SVG los usa tal cual y el PNG los pasa a Path2D: una
  sola geometría para las dos salidas. `ojos` y `alineacion` se rellenan con
  la regla evenodd (son anillos: el hueco es parte del patrón).
*/
function trazosQR(n, esOscuro) {
  const g = geometriaQR(n);
  let modulos = "";
  for (let fila = 0; fila < n; fila++) {
    for (let col = 0; col < n; col++) {
      if (esOscuro(fila, col) && !g.reservado(fila, col)) {
        modulos += circuloQR(col + QR_MARGEN + 0.5, fila + QR_MARGEN + 0.5, QR_RADIO_PUNTO);
      }
    }
  }
  const ojos = g.ojos
    .map(([fila, col]) => anilloQR(col + QR_MARGEN, fila + QR_MARGEN, 7, QR_RADIOS_OJO))
    .join("");
  const alineacion = g.alineaciones
    .map(([fila, col]) => anilloQR(col - 2 + QR_MARGEN, fila - 2 + QR_MARGEN, 5, QR_RADIOS_ALINEACION))
    .join("");
  const lado = g.insignia.radioInterno * 2 * 0.64;
  return {
    total: g.total,
    tarjeta: rectanguloRedondoQR(0, 0, g.total, QR_RADIO_TARJETA),
    modulos,
    ojos,
    alineacion,
    insignia: g.insignia,
    isotipo: { x: g.insignia.cx - lado / 2, y: g.insignia.cy - lado / 2, escala: lado / 100 },
  };
}

function escaparAtributoQR(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/*
  El QR como SVG autocontenido: todo es vector, sin imágenes que cargar ni ids
  que puedan chocar entre tarjetas, así que el archivo descargado abre igual
  en un programa de diseño o en la imprenta.
*/
function svgQR({ n, esOscuro, etiqueta = "Código QR" }) {
  const t = trazosQR(n, esOscuro);
  const { cx, cy, radio, radioInterno } = t.insignia;
  const isotipo = QR_ISOTIPO.map(({ puntos, color }) => `<polygon fill="${color}" points="${puntos}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${t.total} ${t.total}" ` +
    `role="img" aria-label="${escaparAtributoQR(etiqueta)}">` +
    `<path fill="#fff" d="${t.tarjeta}"/>` +
    `<path fill="${QR_TINTA}" d="${t.modulos}"/>` +
    `<path fill="${QR_AZUL}" fill-rule="evenodd" d="${t.ojos}"/>` +
    `<path fill="${QR_TINTA}" fill-rule="evenodd" d="${t.alineacion}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${radio}" fill="#fff"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${radioInterno}" fill="#fff" stroke="${QR_BORDE_INSIGNIA}" stroke-width="0.18"/>` +
    `<g transform="translate(${t.isotipo.x} ${t.isotipo.y}) scale(${t.isotipo.escala})">${isotipo}</g>` +
    "</svg>";
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    QR_BASE,
    QR_TITULO_MAXIMO,
    QR_MARGEN,
    QR_TINTA,
    QR_AZUL,
    QR_BORDE_INSIGNIA,
    QR_RADIO_PUNTO,
    QR_ISOTIPO,
    MENSAJES_ERROR_QR,
    MENSAJE_ERROR_QR_GENERICO,
    urlCortaQR,
    urlVisibleQR,
    estadoQR,
    tiempoRestanteQR,
    duracionEnDiasQR,
    planVigenteQR,
    cupoQR,
    textoCupoQR,
    validarFormularioQR,
    mensajeErrorQR,
    ladoInsigniaQR,
    alineacionesQR,
    geometriaQR,
    trazosQR,
    svgQR,
  });
}
