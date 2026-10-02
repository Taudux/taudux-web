/*
  Núcleo de la página Usuarios: lógica pura, sin DOM ni red. La usa usuarios.js
  en el navegador y tests/admin-usuarios.test.js en Node.

  Qué calcula: cuántas cuentas entran y cuántas se van en cada periodo
  (semana, mes, trimestre o año) y cuántas había al cierre de cada uno.

  Los periodos usan el reloj del equipo (México), no UTC: el 2026-08-31 a las
  18:00 de México ya era septiembre en UTC y el panel del extractor "se vació".
  El periodo en curso aparece siempre, aunque vaya en cero.

  LA LÍNEA SE CALCULA HACIA ATRÁS desde las cuentas de hoy. El registro de
  eventos empezó con cuentas ya creadas y no anota las de prueba, así que
  sumar hacia adelante desde cero terminaría en un número que no es el real.
  Hacia atrás siempre termina en `vivas`:
    total(último) = vivas
    total(p - 1)  = total(p) - altas(p) + bajas(p)
*/

const NIVELES_USUARIOS = Object.freeze(["semana", "mes", "trimestre", "anio"]);
const FILAS_POR_PAGINA_USUARIOS = 6;

const MESES_CORTOS_USUARIOS = Object.freeze(
  ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]);
const MESES_LARGOS_USUARIOS = Object.freeze(
  ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
    "septiembre", "octubre", "noviembre", "diciembre"]);

// Inicio (a medianoche, hora local) del periodo que contiene a `fecha`.
// La semana va de lunes a domingo.
function inicioDePeriodo(fecha, nivel) {
  const d = new Date(fecha);
  if (nivel === "semana") {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  }
  if (nivel === "mes") return new Date(d.getFullYear(), d.getMonth(), 1);
  if (nivel === "trimestre") return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
  if (nivel === "anio") return new Date(d.getFullYear(), 0, 1);
  throw new Error(`Nivel desconocido: ${nivel}`);
}

function siguientePeriodo(inicio, nivel) {
  if (nivel === "semana") return new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + 7);
  if (nivel === "mes") return new Date(inicio.getFullYear(), inicio.getMonth() + 1, 1);
  if (nivel === "trimestre") return new Date(inicio.getFullYear(), inicio.getMonth() + 3, 1);
  return new Date(inicio.getFullYear() + 1, 0, 1);
}

// «27 jul», «sep 2026», «T3 2026», «2026»: la etiqueta corta del eje.
function etiquetaDePeriodo(inicio, nivel) {
  if (nivel === "semana") return `${inicio.getDate()} ${MESES_CORTOS_USUARIOS[inicio.getMonth()]}`;
  if (nivel === "mes") return `${MESES_CORTOS_USUARIOS[inicio.getMonth()]} ${inicio.getFullYear()}`;
  if (nivel === "trimestre") return `T${Math.floor(inicio.getMonth() / 3) + 1} ${inicio.getFullYear()}`;
  return String(inicio.getFullYear());
}

/*
  Devuelve los periodos desde el del primer evento hasta el de `hoy`, sin
  saltarse los vacíos: [{ clave, inicio, etiqueta, altas, bajas, total }].
  Sin eventos, sólo el periodo en curso.
*/
function registrosPorPeriodo(eventos, vivas, nivel, hoy) {
  const ahora = new Date(hoy);
  const actual = inicioDePeriodo(ahora, nivel);
  const relevantes = (eventos || [])
    .filter((e) => e && (e.tipo === "alta_confirmada" || e.tipo === "baja_cuenta"))
    .map((e) => ({ tipo: e.tipo, fecha: new Date(e.ocurrido_en) }))
    .filter((e) => !Number.isNaN(e.fecha.getTime()) && e.fecha <= ahora);

  let primero = actual;
  for (const e of relevantes) {
    const inicio = inicioDePeriodo(e.fecha, nivel);
    if (inicio < primero) primero = inicio;
  }

  const periodos = [];
  for (let inicio = primero; inicio <= actual; inicio = siguientePeriodo(inicio, nivel)) {
    periodos.push({
      clave: inicio.getTime(),
      inicio,
      etiqueta: etiquetaDePeriodo(inicio, nivel),
      altas: 0,
      bajas: 0,
      total: 0,
    });
  }
  const porClave = new Map(periodos.map((p) => [p.clave, p]));
  for (const e of relevantes) {
    const periodo = porClave.get(inicioDePeriodo(e.fecha, nivel).getTime());
    if (!periodo) continue;
    if (e.tipo === "alta_confirmada") periodo.altas += 1;
    else periodo.bajas += 1;
  }

  let total = vivas;
  for (let i = periodos.length - 1; i >= 0; i -= 1) {
    periodos[i].total = total;
    total = total - periodos[i].altas + periodos[i].bajas;
  }
  return periodos;
}

const conSigno = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0");

// El nombre completo del periodo: «semana del 10 ago», «agosto de 2026»,
// «T3 2026», «2026».
function nombreDePeriodo(periodo, nivel) {
  const inicio = periodo.inicio;
  if (nivel === "semana") return `semana del ${inicio.getDate()} ${MESES_CORTOS_USUARIOS[inicio.getMonth()]}`;
  if (nivel === "mes") return `${MESES_LARGOS_USUARIOS[inicio.getMonth()]} de ${inicio.getFullYear()}`;
  return etiquetaDePeriodo(inicio, nivel);
}

/*
  El texto del recuadro de un periodo y el de su `aria-label`, que dice lo
  mismo en una sola frase («Agosto de 2026: 9 nuevas, 8 eliminadas, balance +1,
  5 al cierre»).
*/
function detallePeriodo(periodo, nivel) {
  const nombre = nombreDePeriodo(periodo, nivel);
  const balance = periodo.altas - periodo.bajas;
  const titulo = nombre.charAt(0).toUpperCase() + nombre.slice(1);
  const nuevas = conSigno(periodo.altas);
  const eliminadas = periodo.bajas ? `−${periodo.bajas}` : "0";
  return {
    titulo,
    nuevas,
    eliminadas,
    balance: conSigno(balance),
    cierre: String(periodo.total),
    aria: `${titulo}: ${periodo.altas} nuevas, ${periodo.bajas} eliminadas, ` +
      `balance ${conSigno(balance)}, ${periodo.total} al cierre`,
  };
}

// Qué página se puede mostrar de verdad (la pedida, acotada) y qué filas
// abarca, contadas desde 1 para el pie. Misma regla que el extractor.
function rangoDePaginaUsuarios(total, pagina, porPagina) {
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  const acotada = Math.min(Math.max(0, pagina), totalPaginas - 1);
  const desde = total ? acotada * porPagina + 1 : 0;
  const hasta = Math.min(total, (acotada + 1) * porPagina);
  return { pagina: acotada, totalPaginas, desde, hasta };
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    NIVELES_USUARIOS,
    FILAS_POR_PAGINA_USUARIOS,
    inicioDePeriodo,
    etiquetaDePeriodo,
    registrosPorPeriodo,
    detallePeriodo,
    rangoDePaginaUsuarios,
  });
}
