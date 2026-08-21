/*
  Lógica del extractor web.

  Nada de lo que ocurre aquí persiste: el PDF viaja al servidor, se procesa en
  memoria y el resultado vive sólo en esta pestaña. Recargar la página borra
  todo, tal como dice el aviso de privacidad.
*/

/*
  La API y su cliente viven en `api-cliente.js`, compartido con el panel de
  administración: las dos pantallas necesitan lo mismo —prefijar Cloud Run y
  mandar el token de Supabase— y tener dos copias es tener dos verdades.
*/

const pesos = new Intl.NumberFormat("es-MX", {
  style: "currency", currency: "MXN", minimumFractionDigits: 2,
});

const el = (id) => document.getElementById(id);
const dropzone = el("dropzone");
const inputArchivo = el("inputArchivo");
const inputPassword = el("inputPassword");
const btnProcesar = el("btnProcesar");

/*
  La barra del simulador y el cuaderno de planes NO existen en producción
  (la plantilla los omite con MODO=produccion). Todo lo que los toque tiene
  que sobrevivir a su ausencia: una sola línea que falle aquí deja el resto
  del script sin ejecutar y la herramienta entera muerta.
*/
const EN_SIMULADOR = Boolean(el("planActual"));

/** Ejecuta la acción sólo si el elemento existe. */
function siExiste(id, accion) {
  const nodo = el(id);
  if (nodo) accion(nodo);
}

let archivos = [];
// Sin la barra no hay valor inicial en el marcado: arranca en el plan más
// restrictivo y lo corrige la primera consulta a /api/cuota.
let planActual = el("planActual")?.textContent.trim() || "anonimo";
let permiteLote = false;      // lo dice el servidor según el plan
let bancoDetectado = "";
// Valores que no son transacciones (apartados y demás). Se guardan aparte
// porque no dependen de los filtros: son una foto al corte del estado de
// cuenta, no algo que se recalcule con el subconjunto que estés viendo.
let especialesVigentes = null;

/* ---------------------------------------------------------------- carga --- */

function elegirArchivos(lista) {
  const nuevos = Array.from(lista || []).filter((f) =>
    f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!nuevos.length) {
    mostrarError("Ese archivo no es un PDF",
      "Sube el estado de cuenta en PDF tal como lo entrega tu banco.");
    return;
  }
  // Elegir varios con un plan que no los admite se avisa en vez de tomar el
  // primero en silencio: de otro modo el usuario cree que se subieron todos.
  if (nuevos.length > 1 && !permiteLote) {
    mostrarError("Solo un estado de cuenta a la vez",
      `Tu plan (${planActual}) procesa un archivo por vez. Con el plan Silver ` +
      `puedes subir varios y recibirlos juntos en una sola tabla. ` +
      `Se tomó únicamente "${nuevos[0].name}".`);
  }
  if (permiteLote) {
    // Se ACUMULAN: es natural arrastrar los estados de cuenta de uno en uno, y
    // que el segundo borrara al primero hacía creer que el lote no funcionaba.
    const yaEstan = new Set(archivos.map((f) => `${f.name}|${f.size}`));
    archivos = archivos.concat(
      nuevos.filter((f) => !yaEstan.has(`${f.name}|${f.size}`)));
  } else {
    archivos = [nuevos[0]];
  }
  pintarSeleccion();
  btnProcesar.disabled = archivos.length === 0;
  // La contraseña sólo aparece si hace falta: no se le pide a quien no la usa.
  inputPassword.classList.remove("carga__password--visible");
}

function pintarSeleccion() {
  const caja = el("nombreArchivo");
  if (!archivos.length) { caja.innerHTML = ""; return; }
  if (archivos.length === 1) {
    caja.innerHTML = `✓ ${archivos[0].name}`
      + ' <button type="button" class="quitar" data-quitar="0" title="Quitar">✕</button>';
  } else {
    caja.innerHTML = `✓ <strong>${archivos.length}</strong> estados de cuenta`
      + '<ul class="seleccion">'
      + archivos.map((f, i) =>
          `<li>${f.name}<button type="button" class="quitar" data-quitar="${i}" title="Quitar">✕</button></li>`
        ).join("")
      + "</ul>"
      + '<button type="button" class="quitar quitar--todo" data-quitar="todos">Quitar todos</button>';
  }
  caja.querySelectorAll("[data-quitar]").forEach((boton) =>
    boton.addEventListener("click", (e) => {
      e.stopPropagation();               // no reabrir el selector de archivos
      const cual = boton.dataset.quitar;
      archivos = cual === "todos" ? [] : archivos.filter((_, i) => i !== Number(cual));
      pintarSeleccion();
      btnProcesar.disabled = archivos.length === 0;
    }));
}

dropzone.addEventListener("click", () => inputArchivo.click());
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputArchivo.click(); }
});
inputArchivo.addEventListener("change", (e) => elegirArchivos(e.target.files));

["dragenter", "dragover"].forEach((evento) =>
  dropzone.addEventListener(evento, (e) => {
    e.preventDefault();
    dropzone.classList.add("dropzone--activa");
  }));
["dragleave", "drop"].forEach((evento) =>
  dropzone.addEventListener(evento, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dropzone--activa");
  }));
dropzone.addEventListener("drop", (e) => elegirArchivos(e.dataTransfer.files));

/* ------------------------------------------------------------ procesar --- */

function ocultarTodo() {
  el("estadoCargando").classList.remove("estado--visible");
  el("estadoError").classList.remove("estado--visible");
  el("resultado").classList.remove("resultado--visible");
}

function mostrarError(titulo, texto, puedeDonar = false) {
  ocultarTodo();
  el("errorTitulo").textContent = titulo;
  el("errorTexto").textContent = texto;
  // La invitación a donar sólo aparece cuando hay algo que donar: un PDF que
  // no pudimos procesar y que serviría para dar soporte a ese banco.
  el("cajaDonar").hidden = !puedeDonar;
  el("graciasDonar").hidden = true;
  el("estadoError").classList.add("estado--visible");
}

el("btnDonar").addEventListener("click", async () => {
  const respuesta = await apiFetch("/api/donar", { method: "POST" });
  const json = await respuesta.json();
  const gracias = el("graciasDonar");
  gracias.textContent = json.mensaje || "No se pudo guardar el archivo.";
  gracias.hidden = false;
  el("btnDonar").disabled = true;
  el("btnNoDonar").disabled = true;
});

el("btnNoDonar").addEventListener("click", () => {
  el("cajaDonar").hidden = true;
});

btnProcesar.addEventListener("click", async () => {
  if (!archivos.length) return;
  ocultarTodo();
  el("estadoCargando").classList.add("estado--visible");
  btnProcesar.disabled = true;

  const datos = new FormData();
  archivos.forEach((f) => datos.append("pdf", f));
  if (inputPassword.value) datos.append("password", inputPassword.value);

  try {
    const respuesta = await apiFetch("/api/extraer", { method: "POST", body: datos });
    const json = await respuesta.json();

    if (!respuesta.ok) {
      if (json.cuota) actualizarCuota(json.cuota);
      const titulos = {
        escaneado: "Este PDF es una imagen",
        no_reconocido: "Aún no reconocemos este banco",
        producto_no_soportado: "Todavía no procesamos este producto",
        sin_cuota: "Se acabaron tus extracciones gratis",
        lote_no_permitido: "Solo un estado de cuenta a la vez",
      };
      mostrarError(titulos[json.error] || "No pudimos procesarlo", json.mensaje,
                   json.puede_donar === true);
      return;
    }
    pintarResultado(json);
  } catch (error) {
    mostrarError("No pudimos procesarlo", "Ocurrió un problema de conexión. Inténtalo de nuevo.");
  } finally {
    btnProcesar.disabled = false;
  }
});

/* ----------------------------------------------------------- resultado --- */

function tarjeta(etiqueta, valor, clase = "", nota = "", claseTarjeta = "") {
  return `<div class="tarjeta panel ${claseTarjeta}">
      <div class="tarjeta__etiqueta">${etiqueta}</div>
      <div class="tarjeta__valor ${clase}">${valor}</div>
      ${nota ? `<div class="tarjeta__nota">${nota}</div>` : ""}
    </div>`;
}

const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
                      "julio", "agosto", "septiembre", "octubre", "noviembre",
                      "diciembre"];

/* "26/03/2026" -> "26 de marzo del 2026". Si no se puede leer, se deja igual. */
function fechaLarga(texto) {
  const [d, m, a] = String(texto || "").split("/");
  if (!a || !MESES_LARGOS[Number(m) - 1]) return texto || "";
  return `${Number(d)} de ${MESES_LARGOS[Number(m) - 1]} del ${a}`;
}

/*
  Todo texto que venga del PDF pasa por aquí antes de ir a innerHTML. Las
  descripciones son contenido ajeno: basta con que un estado de cuenta traiga
  un "&" o un "<" para romper el marcado, y en el peor caso para inyectar.
*/
function escapar(texto) {
  return String(texto ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function itemDetalle(etiqueta, mov, clase) {
  if (!mov || mov.monto === null) return "";
  return `<div class="detalle__item detalle__item--${clase}">
      <div class="detalle__etiqueta">${etiqueta}</div>
      <div class="detalle__monto">${pesos.format(mov.monto)}</div>
      <div class="detalle__concepto">${escapar(mov.fecha || "")} · ${escapar(mov.concepto || "—")}</div>
    </div>`;
}

/*
  Al terminar una extracción, la zona de carga se pliega a una barra de una
  línea: lo importante es el resultado y debe verse sin scroll. La zona vuelve
  sólo si se pide con el botón "Extraer otros estados" — y en un error NO se
  pliega, porque ahí lo que sigue es reintentar.
*/
const seccionCarga = document.querySelector(".carga");

function plegarCarga(datos) {
  const n = (datos.archivos || []).filter((a) => !a.error).length || 1;
  el("plegadaTexto").innerHTML =
    `<strong>✓</strong> Extracción lista · ${datos.n.toLocaleString("es-MX")} `
    + `movimientos de ${n === 1 ? "1 estado de cuenta" : `${n} estados de cuenta`}`;
  el("cargaPlegada").hidden = false;
  seccionCarga.classList.add("carga--plegada");
}

el("btnOtraExtraccion").addEventListener("click", () => {
  seccionCarga.classList.remove("carga--plegada");
  el("cargaPlegada").hidden = true;
  // Selección limpia: la extracción anterior ya está abajo, y reusar la lista
  // vieja haría creer que se van a volver a procesar esos mismos archivos.
  archivos = [];
  pintarSeleccion();
  btnProcesar.disabled = true;
  inputArchivo.value = "";        // permite volver a elegir el mismo archivo
  inputPassword.value = "";
  inputPassword.classList.remove("carga__password--visible");
  dropzone.scrollIntoView({ behavior: "smooth", block: "center" });
  dropzone.focus({ preventScroll: true });
});

function pintarResultado(datos) {
  ocultarTodo();
  plegarCarga(datos);
  bancoDetectado = datos.banco;
  const ind = datos.indicadores;

  // Sello de verificación: es la promesa central del producto.
  const sello = el("sello");
  const v = datos.validacion;
  const varios = (datos.archivos || []).length > 1;
  const alcance = varios ? `${v.cuadran} de ${v.total} estados` : datos.banco;
  /*
    Esta rama va PRIMERO y no es un capricho de orden: el backend manda
    `motivo` junto a `cuadra: false`, así que si la comprobación genérica de
    `false` se evaluara antes, este mensaje no se vería nunca.

    Y hace falta un mensaje propio porque los otros dos mentirían distinto:
    "no cuadra con los totales" sugiere que se leyeron movimientos y no dieron,
    y "sin totales de control" sugiere que el PDF no los traía. Acá lo que pasó
    es otra cosa: el PDF se abrió, traía sus totales, y no reconocimos su
    plantilla para sacar una sola fila.
  */
  if (v.motivo === "sin_movimientos") {
    sello.className = "sello sello--alerta";
    sello.innerHTML = `<span aria-hidden="true">⚠</span> ${alcance} · no pudimos leer los movimientos de este estado de cuenta · puede ser una plantilla que aún no soportamos`;
  } else if (v.cuadra === true) {
    sello.className = "sello sello--ok";
    sello.innerHTML = `<span aria-hidden="true">✓</span> Verificado contra los totales de ${alcance} · cuadra al centavo`;
  } else if (v.cuadra === false) {
    sello.className = "sello sello--alerta";
    sello.innerHTML = `<span aria-hidden="true">⚠</span> ${alcance} · revisa el resultado: no cuadra con los totales del banco`;
  } else {
    sello.className = "sello sello--alerta";
    sello.innerHTML = `<span aria-hidden="true">ⓘ</span> ${alcance} · sin totales de control para verificar`;
  }

  pintarAlerta(datos.alerta);
  pintarResumenLote(datos, varios);

  // Detalle por archivo cuando fue un lote: cuáles entraron, de qué periodo
  // y cuáles no pudieron procesarse.
  const listado = el("listaArchivos");
  const problemas = (datos.omitidos || []).map((n) =>
    `<li class="archivo archivo--error">⚠ ${n} · no se procesó: se acabó tu cuota</li>`);
  if (varios || problemas.length) {
    listado.innerHTML = (datos.archivos || []).map((a) => {
      if (a.error) return `<li class="archivo archivo--error">⚠ ${a.nombre} · ${a.mensaje}</li>`;
      const periodo = a.periodo_inicio ? ` · ${a.periodo_inicio} a ${a.periodo_fin}` : "";
      const cuenta = a.cuenta ? ` · cuenta ${a.cuenta}` : "";
      return `<li class="archivo"><span class="archivo__ok">✓</span> ${a.nombre} · `
           + `${a.banco}${cuenta}${periodo} · ${a.n} movimientos</li>`;
    }).concat(problemas).join("");
    listado.hidden = false;
  } else {
    listado.hidden = true;
  }

  especialesVigentes = datos.especiales || null;
  pintarIndicadores(ind);

  // Filtros: opciones de banco según lo que trajo el archivo.
  filasCrudas = datos.transacciones;
  indicadoresBase = ind;
  const bancos = [...new Set(filasCrudas.map((f) => f.banco).filter(Boolean))].sort();
  el("filtroBanco").innerHTML = '<option value="">Todos</option>' +
    bancos.map((b) => `<option value="${b}">${b}</option>`).join("");
  limpiarFiltros();

  el("infoFilas").textContent = datos.truncado
    ? `Vista limitada a ${filasCrudas.length} movimientos · el archivo los incluye todos (${datos.n})`
    : `${datos.n} movimientos`;

  actualizarCuota(datos.cuota);
  el("resultado").classList.add("resultado--visible");
  el("resultado").scrollIntoView({ behavior: "smooth", block: "start" });
}

/*
  Alerta de contaminación de datos. Se muestra ANTES que cualquier cifra: si el
  lote mezcla personas, todo lo que sigue (totales, gráficas, Excel) está mal
  sumado, y el usuario tiene que enterarse antes de leerlo, no después.
*/
function pintarAlerta(alerta) {
  const caja = el("alertaMezcla");
  if (!alerta) { caja.hidden = true; return; }

  if (alerta.tipo === "titulares_distintos") {
    caja.className = "alerta-mezcla";
    el("alertaTitulo").textContent = "Estos estados de cuenta son de personas distintas";
    el("alertaTexto").textContent =
      "Los juntamos en una sola tabla, así que los totales, las gráficas y el "
      + "archivo que descargues están sumando el dinero de más de una persona. "
      + "Procesa por separado los de cada titular para que las cifras sean correctas.";
    el("alertaLista").innerHTML = alerta.detalle.map((d) =>
      `<li>${d.archivo} · titular <code>${d.titular}</code></li>`).join("");
  } else {
    caja.className = "alerta-mezcla alerta-mezcla--aviso";
    el("alertaTitulo").textContent = "No pudimos verificar que todos sean de la misma persona";
    el("alertaTexto").textContent =
      "En algunos archivos no encontramos el RFC del titular, así que no podemos "
      + "confirmar que el lote pertenezca a una sola persona. Si mezclaste "
      + "estados de cuenta de distintos titulares, las cifras estarán sumadas entre sí.";
    el("alertaLista").innerHTML = (alerta.archivos || []).map((a) =>
      `<li>${a} · sin RFC legible</li>`).join("");
  }
  caja.hidden = false;
}

/* Resumen del lote: cuántos documentos y qué periodo cubren en conjunto. */
function pintarResumenLote(datos, varios) {
  const caja = el("resumenLote");
  const correctos = (datos.archivos || []).filter((a) => !a.error);
  if (!varios || correctos.length < 2) { caja.hidden = true; return; }

  const inicios = correctos.map((a) => a.periodo_inicio).filter(Boolean);
  const fines = correctos.map((a) => a.periodo_fin).filter(Boolean);
  const orden = (f) => { const [d, m, a] = f.split("/"); return `${a}${m}${d}`; };
  const desde = inicios.sort((x, y) => orden(x) < orden(y) ? -1 : 1)[0];
  const hasta = fines.sort((x, y) => orden(x) < orden(y) ? 1 : -1)[0];
  const bancos = [...new Set(correctos.map((a) => a.banco))];
  const cuentas = [...new Set(correctos.map((a) => a.cuenta).filter(Boolean))];

  caja.innerHTML = [
    `<span class="resumen-lote__dato">Documentos: <strong>${correctos.length}</strong></span>`,
    desde ? `<span class="resumen-lote__dato">Periodo cubierto: <strong>${desde} a ${hasta}</strong></span>` : "",
    `<span class="resumen-lote__dato">Bancos: <strong>${bancos.length}</strong> (${bancos.join(", ")})</span>`,
    cuentas.length ? `<span class="resumen-lote__dato">Cuentas: <strong>${cuentas.length}</strong></span>` : "",
  ].join("");
  caja.hidden = false;
}

function pintarIndicadores(ind) {
  // El periodo en palabras completas ("26 de marzo del 2026 al ..."): la
  // tarjeta es el doble de ancha a propósito — legibilidad antes que retícula.
  const periodo = ind.periodo_inicio
    ? `${fechaLarga(ind.periodo_inicio)} al ${fechaLarga(ind.periodo_fin)}` : "—";
  const credito = ind.credito || {};

  /*
    El dinero propio y la deuda NUNCA se suman en una sola cifra. Un cargo a la
    tarjeta no reduce lo que tienes: aumenta lo que debes. Por eso el saldo
    ("tu dinero") sólo aparece si hay cuenta de débito, y la tarjeta se presenta
    con su propio lenguaje: gastado, pagado y deuda del periodo.
  */
  const tarjetas = [
    tarjeta("Periodo", `<span style="font-size:.95rem">${periodo}</span>`, "",
            `${ind.n_movimientos} movimientos`, "tarjeta--ancha"),
    tarjeta("Ingresos", pesos.format(ind.ingreso_total), "tarjeta__valor--ingreso"),
    tarjeta("Gastos", pesos.format(ind.gasto_total), "tarjeta__valor--gasto"),
    tarjeta("Flujo neto", pesos.format(ind.flujo_neto),
            ind.flujo_neto >= 0 ? "tarjeta__valor--ingreso" : "tarjeta__valor--gasto"),
  ];

  if (ind.saldo_final !== null && ind.saldo_final !== undefined) {
    tarjetas.push(
      tarjeta("Tu dinero al inicio", ind.saldo_inicial !== null ? pesos.format(ind.saldo_inicial) : "—"),
      tarjeta("Tu dinero al final", pesos.format(ind.saldo_final), "", "saldo en cuenta"));
  }

  if (credito.tiene) {
    tarjetas.push(
      tarjeta("Gastaste con tarjeta", pesos.format(credito.gastado),
              "tarjeta__valor--gasto", "esto es deuda, no tu dinero"),
      tarjeta("Pagaste a la tarjeta", pesos.format(credito.pagado),
              "tarjeta__valor--ingreso", "deuda que cancelaste"),
      tarjeta(credito.deuda_periodo >= 0 ? "Te endeudaste" : "Redujiste deuda",
              pesos.format(Math.abs(credito.deuda_periodo)),
              credito.deuda_periodo >= 0 ? "tarjeta__valor--gasto" : "tarjeta__valor--ingreso",
              "en el periodo"));
  }

  // Traspasos: ni ingreso ni gasto. Se muestran aparte porque son la mejor
  // señal de ahorro deliberado que puede dar un estado de cuenta.
  const traspasos = ind.traspasos || {};
  if (traspasos.hay) {
    tarjetas.push(tarjeta(
      traspasos.neto >= 0 ? "Moviste a tu ahorro" : "Sacaste de tu ahorro",
      pesos.format(Math.abs(traspasos.neto)),
      traspasos.neto >= 0 ? "tarjeta__valor--ingreso" : "",
      `${traspasos.n} traspasos · no cuenta como gasto`));
  }

  /*
    Apartados: dinero tuyo que separaste dentro de la misma cuenta. No es un
    movimiento —mover dinero a un apartado no genera transacción— así que este
    dato sólo existe aquí, y es el único que explica por qué tu saldo "no
    alcanza" aunque el número se vea grande. Se muestra el conteo y los montos;
    los nombres que le pusiste a cada apartado no se leen ni se guardan.
  */
  const esp = especialesVigentes || {};
  const ap = esp.apartados || {};
  if (ap.disponible) {
    const corte = esp.corte_apartados ? ` · al ${esp.corte_apartados}` : "";
    tarjetas.push(tarjeta("Tienes apartado", pesos.format(ap.total), "",
                          `en ${ap.n} apartado${ap.n === 1 ? "" : "s"}${corte}`));
    if (ap.saldo_disponible !== null && ap.saldo_disponible !== undefined) {
      tarjetas.push(tarjeta("Libre para gastar", pesos.format(ap.saldo_disponible),
                            "", "tu saldo menos lo apartado"));
    }
  }

  /*
    Compras a meses. La cifra que importa NO es la mensualidad —esa ya se ve en
    los movimientos del periodo— sino el saldo pendiente: deuda ya contraída
    que no aparece en ninguna tabla. Quien difirió $40,000 a 12 meses ve un
    cargo de $3,333 y siente que debe poco; esta tarjeta existe para corregir
    justamente esa lectura, por eso va con lenguaje de deuda, no de gasto.
  */
  const msi = esp.msi || {};
  if (msi.disponible && msi.n_compras > 0) {
    const plural = msi.n_compras === 1 ? "compra" : "compras";
    tarjetas.push(tarjeta(
      "Debes a meses", pesos.format(msi.saldo_pendiente), "tarjeta__valor--gasto",
      `${msi.n_compras} ${plural} · te liberas en ${msi.meses_para_liquidar} `
      + `mes${msi.meses_para_liquidar === 1 ? "" : "es"}`));
    tarjetas.push(tarjeta(
      "De eso, este mes", pesos.format(msi.mensualidad), "",
      "la mensualidad que ya viene cargada"));
  }

  if (ind.posicion_neta !== null && ind.posicion_neta !== undefined) {
    tarjetas.push(tarjeta("Posición real", pesos.format(ind.posicion_neta),
      ind.posicion_neta >= 0 ? "tarjeta__valor--ingreso" : "tarjeta__valor--gasto",
      "tu dinero menos lo que debes"));
  }

  el("resumen").innerHTML = tarjetas.join("");
  el("avisoCredito").hidden = !credito.tiene;

  const detalle = [
    itemDetalle("Ingreso mayor", ind.ingreso_mayor, "ingreso"),
    itemDetalle("Ingreso menor", ind.ingreso_menor, "ingreso"),
    itemDetalle("Gasto mayor", ind.egreso_mayor, "gasto"),
    itemDetalle("Gasto menor", ind.egreso_menor, "gasto"),
    ind.gasto_promedio !== null
      ? `<div class="detalle__item">
           <div class="detalle__etiqueta">Gasto promedio / mediana</div>
           <div class="detalle__monto">${pesos.format(ind.gasto_promedio)}</div>
           <div class="detalle__concepto">mediana ${pesos.format(ind.gasto_mediana)}</div>
         </div>` : "",
    ind.concepto_frecuente
      ? `<div class="detalle__item">
           <div class="detalle__etiqueta">Lo que más repites</div>
           <div class="detalle__monto">${ind.concepto_frecuente}</div>
           <div class="detalle__concepto">${ind.concepto_frecuente_veces} veces · ${pesos.format(ind.concepto_frecuente_total)} en total</div>
         </div>` : "",
  ].join("");
  el("detalleGrid").innerHTML = detalle;
  pintarMeses(esp);

  // Sin cuenta: los totales se ven (es lo que engancha), el detalle se difumina.
  aplicarBloqueo();
}

/*
  Detalle de compras a meses, ordenadas por lo que falta por pagar.

  La barra de progreso no es adorno: "pago 5 de 9" en texto se lee como un dato
  administrativo, mientras que ver la barra a medias comunica de un vistazo
  cuánto falta. Y se muestra el pendiente —no el monto original— porque la
  pregunta real no es qué costó, sino cuánto sigue debiéndose.
*/
function pintarMeses(esp) {
  const msi = (esp || {}).msi || {};
  const panel = el("panelMsi");
  if (!msi.disponible || !msi.n_compras) {
    panel.hidden = true;
    return;
  }

  // El panel se muestra ANTES de dibujar: la gráfica se mide contra el ancho
  // real de su contenedor, y un elemento oculto reporta cero.
  panel.hidden = false;

  const corte = esp.corte_msi ? ` · al corte del ${esp.corte_msi}` : "";
  // Si las cifras no satisfacen "mensualidad = monto original / plazo", algo se
  // leyó mal: se dice, en vez de presentar números que parecen correctos.
  el("msiNota").innerHTML = msi.coherente
    ? `Te faltan <strong>${pesos.format(msi.saldo_pendiente)}</strong> repartidos `
      + `en ${msi.n_compras} compra${msi.n_compras === 1 ? "" : "s"}. `
      + `De eso, este mes ya viene cargado ${pesos.format(msi.mensualidad)}${corte}.`
    : `⚠ Las cifras de esta sección no cuadran entre sí; tómalas como referencia `
      + `y revisa tu estado de cuenta.`;

  pintarProyeccion(esp);

  el("msiLista").innerHTML = msi.compras.map((c) => {
    const pagados = c.plazo ? (c.pago_actual / c.plazo) * 100 : 0;
    return `<div class="msi__item">
      <div class="msi__cabecera">
        <span class="msi__desc">${escapar(c.descripcion) || "Compra a meses"}</span>
        <span class="msi__pendiente">${pesos.format(c.saldo_pendiente)}</span>
      </div>
      <div class="msi__barra" role="img"
           aria-label="pago ${c.pago_actual} de ${c.plazo}">
        <span class="msi__barra-relleno" style="width:${pagados.toFixed(1)}%"></span>
      </div>
      <div class="msi__pie">
        <span>Pago ${c.pago_actual} de ${c.plazo}</span>
        <span>${pesos.format(c.mensualidad)} al mes</span>
        <span>${c.pagos_restantes === 0 ? "última mensualidad"
                : `faltan ${c.pagos_restantes}`}</span>
      </div>
    </div>`;
  }).join("");
}

/* ------------------------------------------- calendario de lo comprometido --- */
/*
  Columnas apiladas: cada mes futuro es una columna, cada compra un segmento.

  Es apilada y no de líneas ni dispersión porque la pregunta tiene dos partes a
  la vez —"¿cuánto pago ese mes?" y "¿de dónde sale?"— y una barra apilada
  responde ambas sin un segundo gráfico. El perfil que resulta es escalonado y
  decreciente: cada escalón hacia abajo es el mes en que una compra se termina y
  se libera dinero. Ese escalón es lo accionable.

  La paleta son los seis primeros slots categóricos, validados con el script de
  la guía contra la superficie real del panel (#101214): todas las parejas
  adyacentes pasan las pruebas de daltonismo y de contraste. No se generan
  colores más allá del sexto — a partir de ahí las compras se agrupan en "Otras",
  porque un séptimo hue inventado es indistinguible de otro bajo CVD.
*/
const SERIES_MSI = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300"];
const COLOR_OTRAS = "#8b8f96";        // gris de-énfasis, no es un slot de serie
const MAX_SERIES_MSI = SERIES_MSI.length;
const SUPERFICIE = "#101214";         // el gap de 2 px se pinta de este color

const MARGEN_MSI = { arriba: 24, derecha: 12, abajo: 34, izquierda: 58 };

// Los montos dentro de cada franja se piden con el interruptor; se guarda aquí
// porque hay que repintar con el mismo dato al cambiarlo.
let montosPorFraccion = false;
let proyeccionActual = null;

function colorCompra(i) {
  return i < MAX_SERIES_MSI ? SERIES_MSI[i] : COLOR_OTRAS;
}

/* Barra apilada: sólo el segmento de arriba lleva las esquinas redondeadas,
   porque es el extremo del dato; la base queda cuadrada sobre el eje. */
function barraApilada(x, y, ancho, alto, color, redondearArriba) {
  const r = Math.min(4, ancho / 2, alto);
  if (!redondearArriba || alto <= r) {
    return `<rect x="${x}" y="${y}" width="${ancho}" height="${Math.max(alto, 0)}"
             fill="${color}"/>`;
  }
  return `<path d="M${x} ${y + alto} L${x} ${y + r} Q${x} ${y} ${x + r} ${y}
           L${x + ancho - r} ${y} Q${x + ancho} ${y} ${x + ancho} ${y + r}
           L${x + ancho} ${y + alto} Z" fill="${color}"/>`;
}

function pintarProyeccion(esp) {
  const meses = (esp || {}).proyeccion || [];
  const resumen = (esp || {}).proyeccion_resumen || {};
  const compras = ((esp || {}).msi || {}).compras || [];
  const caja = el("msiGrafica");
  if (!caja) return;
  proyeccionActual = esp;          // para poder repintar al mover el interruptor
  if (meses.length < 2) {          // con un solo mes la columna no dice nada
    caja.hidden = true;
    return;
  }
  caja.hidden = false;

  // El SVG mide contra su propio contenedor, que ahora comparte fila con la
  // leyenda de la izquierda: medir el panel entero dibujaría más ancho del que
  // hay y las últimas columnas quedarían cortadas.
  const lienzo = caja.querySelector(".msi-g__svg");
  const ancho = Math.max(lienzo.clientWidth || caja.clientWidth || 720, 300);
  const alto = 230;
  const util = {
    ancho: ancho - MARGEN_MSI.izquierda - MARGEN_MSI.derecha,
    alto: alto - MARGEN_MSI.arriba - MARGEN_MSI.abajo,
  };
  const max = Math.max(...meses.map((m) => m.total)) || 1;
  const banda = util.ancho / meses.length;
  /*
    La barra no llena su banda: el sobrante es aire, y se topa a 24 px para que
    con pocos meses no se vuelva un bloque.

    Con el interruptor de montos por compra el tope sube a 46 px, porque ahí el
    ancho lo pide el contenido: una cifra dentro de una franja de 24 px se
    saldría o habría que recortarla, y una etiqueta recortada es peor que
    ninguna. Aun así la barra nunca pasa del 72 % de su banda, así que sigue
    habiendo aire entre columnas.
  */
  const anchoBarra = montosPorFraccion
    ? Math.min(46, banda * 0.72)
    : Math.min(24, banda * 0.55);
  const escY = (v) => MARGEN_MSI.arriba + util.alto - (v / max) * util.alto;

  const ticks = ticksDe(0, max, 3);
  const grid = ticks.map((t) => `
    <line x1="${MARGEN_MSI.izquierda}" y1="${escY(t).toFixed(1)}"
          x2="${ancho - MARGEN_MSI.derecha}" y2="${escY(t).toFixed(1)}"
          class="msi-g__grid"/>
    <text x="${MARGEN_MSI.izquierda - 8}" y="${(escY(t) + 4).toFixed(1)}"
          class="msi-g__tick">${compacto.format(t)}</text>`).join("");

  /*
    El total va sobre TODAS las columnas: aquí la pregunta es literalmente
    "cuánto pago cada mes", así que el número es el dato, no un adorno. Se
    omite sólo cuando las columnas quedan tan juntas que los números chocarían
    — ahí manda el eje y el tooltip.
  */
  const ANCHO_MONTO = 34;
  const rotularTodos = banda >= ANCHO_MONTO;
  const iMax = meses.reduce((mejor, m, i) => (m.total > meses[mejor].total ? i : mejor), 0);
  const rotular = new Set([0, iMax]);

  // Con muchos meses las etiquetas del eje se encimarían: se muestran salteadas
  // según el ancho real disponible, nunca superpuestas. Un plazo de 24 meses en
  // un panel angosto es el caso que lo obliga.
  const ANCHO_ETIQUETA = 26;
  const pasoMes = Math.max(1, Math.ceil(ANCHO_ETIQUETA / banda));
  // El año se rotula sólo cuando cambia, para no repetirlo en cada columna.
  let anioPrevio = null;

  let cabenMontos = 0;
  let segmentosTotales = 0;

  const columnas = meses.map((mes, i) => {
    const x = MARGEN_MSI.izquierda + banda * i + (banda - anchoBarra) / 2;
    let acumulado = 0;
    const rotulosFraccion = [];
    // Se dibuja de abajo hacia arriba para que el orden de las compras sea el
    // mismo en todas las columnas y el ojo pueda seguir una franja.
    const segmentos = [...mes.detalle].reverse().map((d, idx, arr) => {
      const y0 = escY(acumulado);
      acumulado += d.monto;
      const y1 = escY(acumulado);
      const esCima = idx === arr.length - 1;
      const altoBruto = y0 - y1;
      /*
        2 px de superficie separan los segmentos; nunca un borde dibujado. Pero
        el gap se omite en los segmentos diminutos: si una mensualidad es
        minúscula frente a las otras, restarle 2 px la haría más pequeña que el
        propio separador y la columna crecería por encima de su valor. Un
        segmento que ya es una línea fina no necesita separarse de nada.
      */
      const gap = !esCima && altoBruto > 4 ? 2 : 0;
      const altoSeg = Math.max(altoBruto - gap, 0.5);

      // Monto dentro de la franja, sólo si CABE de verdad: una etiqueta
      // recortada es peor que ninguna, y el valor sigue estando en el tooltip,
      // en la leyenda y en la lista de abajo.
      segmentosTotales++;
      if (montosPorFraccion && altoSeg >= 13 && anchoBarra >= 30) {
        cabenMontos++;
        rotulosFraccion.push(
          `<text x="${x + anchoBarra / 2}" y="${(y1 + altoSeg / 2 + 3.5).toFixed(1)}"
                 class="msi-g__frac">${compacto.format(d.monto)}</text>`);
      }
      return barraApilada(x, y1, anchoBarra, altoSeg, colorCompra(d.i), esCima);
    }).join("") + rotulosFraccion.join("");

    const etiqueta = rotularTodos || rotular.has(i)
      ? `<text x="${x + anchoBarra / 2}" y="${(escY(mes.total) - 8).toFixed(1)}"
              class="msi-g__valor">${compacto.format(mes.total)}</text>` : "";

    // Se rotula el mes si toca por el salteado, y siempre el primero.
    let rotuloMes = "";
    if (i === 0 || i % pasoMes === 0) {
      const cambioAnio = mes.anio !== anioPrevio;
      anioPrevio = mes.anio;
      rotuloMes = `<text x="${x + anchoBarra / 2}"
            y="${alto - MARGEN_MSI.abajo + 18}" class="msi-g__mes">${mes.etiqueta_corta}${
        cambioAnio ? `<tspan class="msi-g__anio" dy="11" x="${x + anchoBarra / 2}">${mes.anio}</tspan>` : ""
      }</text>`;
    }

    return `<g class="msi-g__col" data-mes="${i}"
               tabindex="0" role="listitem"
               aria-label="${mes.etiqueta}: ${pesos.format(mes.total)}">
        <rect x="${MARGEN_MSI.izquierda + banda * i}" y="${MARGEN_MSI.arriba}"
              width="${banda}" height="${util.alto}" fill="transparent"/>
        ${segmentos}${etiqueta}${rotuloMes}
      </g>`;
  }).join("");

  lienzo.innerHTML = `
    <svg viewBox="0 0 ${ancho} ${alto}" width="100%" height="${alto}"
         role="list" aria-label="Pagos comprometidos por mes">
      ${marcaAgua(ancho, alto, MARGEN_MSI)}
      ${grid}
      <line x1="${MARGEN_MSI.izquierda}" y1="${escY(0).toFixed(1)}"
            x2="${ancho - MARGEN_MSI.derecha}" y2="${escY(0).toFixed(1)}"
            class="msi-g__eje"/>
      ${columnas}
    </svg>`;

  /*
    Leyenda a la izquierda del eje: dice QUÉ es cada color justo al lado de las
    columnas, sin que haya que bajar la vista y volver. Lleva también la
    mensualidad de cada compra, que es la cifra que explica el grosor de su
    franja. La identidad nunca queda sólo en el color.

    Más de seis compras se agrupan en "Otras": un séptimo hue generado sería
    indistinguible de otro para quien tiene daltonismo.
  */
  const visibles = compras.slice(0, MAX_SERIES_MSI);
  const sobran = compras.slice(MAX_SERIES_MSI);
  const sumaOtras = sobran.reduce((t, c) => t + (c.mensualidad || 0), 0);
  el("msiLeyenda").innerHTML = visibles.map((c, i) =>
    `<span class="msi-g__clave">
       <span class="msi-g__swatch" style="background:${colorCompra(i)}"></span>
       <span>${escapar(c.descripcion) || "Compra a meses"}
         <span class="msi-g__clave-monto">${pesos.format(c.mensualidad)} al mes</span>
       </span>
     </span>`).join("")
    + (sobran.length
      ? `<span class="msi-g__clave">
           <span class="msi-g__swatch" style="background:${COLOR_OTRAS}"></span>
           <span>Otras ${sobran.length}
             <span class="msi-g__clave-monto">${pesos.format(sumaOtras)} al mes</span>
           </span>
         </span>` : "");

  const piso = resumen.piso === resumen.maximo ? ""
    : ` y baja hasta ${pesos.format(resumen.piso)} en ${resumen.ultimo_mes}`;
  let nota = `El mes que entra ya tienes comprometidos `
    + `${pesos.format(resumen.proximo)}${piso}. Es gasto fijo: ya está decidido.`;
  // Si se pidieron los montos por compra y las franjas son demasiado chicas
  // para que quepan, se dice: callar dejaría creer que el interruptor no sirve.
  if (montosPorFraccion && cabenMontos === 0) {
    nota += ` (Con ${meses.length} meses las franjas quedan muy angostas para `
          + `los montos; míralos pasando el cursor por una columna.)`;
  } else if (montosPorFraccion && cabenMontos < segmentosTotales) {
    nota += ` (Los montos que no caben en su franja están en el cursor.)`;
  }
  el("msiGraficaNota").textContent = nota;

  conectarTooltipMsi(meses);
}

// El interruptor repinta con el mismo dato; el ancho de barra cambia para que
// la cifra quepa dentro de la franja.
el("msiMontos").addEventListener("change", (e) => {
  montosPorFraccion = e.target.checked;
  if (proyeccionActual) pintarProyeccion(proyeccionActual);
});

/* El tooltip enriquece, no es la única vía: los valores están además en el eje,
   en los rótulos y en la lista de compras de abajo. */
function conectarTooltipMsi(meses) {
  const caja = el("msiGrafica");
  const globo = el("msiTooltip");
  caja.querySelectorAll(".msi-g__col").forEach((col) => {
    const mostrar = () => {
      const mes = meses[Number(col.dataset.mes)];
      globo.innerHTML = `<strong>${mes.etiqueta}</strong>
        <span class="msi-g__tt-total">${pesos.format(mes.total)}</span>`
        + mes.detalle.map((d) =>
          `<span class="msi-g__tt-fila">
             <span class="msi-g__swatch" style="background:${colorCompra(d.i)}"></span>
             ${escapar(d.descripcion)} · ${pesos.format(d.monto)}</span>`).join("");
      globo.hidden = false;
      const r = col.getBoundingClientRect();
      const c = caja.getBoundingClientRect();
      globo.style.left = `${Math.min(r.left - c.left + r.width / 2, c.width - 190)}px`;
      globo.style.top = `${Math.max(r.top - c.top - 12, 0)}px`;
    };
    col.addEventListener("mouseenter", mostrar);
    col.addEventListener("focus", mostrar);
    col.addEventListener("mouseleave", () => { globo.hidden = true; });
    col.addEventListener("blur", () => { globo.hidden = true; });
  });
}

/* --------------------------------------------------------------- gráficas --- */
/*
  Dos paneles apilados que comparten el eje de tiempo, en vez de una sola
  gráfica con dos escalas: el flujo diario y el saldo se miden en órdenes de
  magnitud distintos, y meterlos en un mismo eje aplastaría las líneas de
  ingresos y gastos contra el cero. Apilados se comparan igual de bien —
  la misma fecha cae en la misma X — y cada uno conserva su escala.
*/

// El margen superior deja aire para las etiquetas de valor del punto más alto:
// con 12 px, el número del máximo se cortaba contra el borde del SVG.
const MARGEN = { arriba: 26, derecha: 14, abajo: 30, izquierda: 62 };
let serieActual = [];

/*
  Marca de agua: el logo OFICIAL de Taudux, el mismo archivo del sitio
  (logo-horizontal.png, 2048x724), sin redibujar ni recomponer. Se encaja en
  el área de datos por el lado que primero tope y preserveAspectRatio remata:
  el logo jamás se estira, sólo escala.
*/
const MARCA_URL = "/static/marca-taudux.png";
const MARCA_ASPECTO = 2048 / 724;

function marcaAgua(ancho, alto, margen) {
  const zonaAncho = ancho - margen.izquierda - margen.derecha;
  const zonaAlto = alto - margen.arriba - margen.abajo;
  let w = zonaAncho * 0.72;
  let h = w / MARCA_ASPECTO;
  const topeAlto = zonaAlto * 0.82;
  if (h > topeAlto) { h = topeAlto; w = h * MARCA_ASPECTO; }
  if (w < 60) return "";                    // sin lugar, mejor sin marca
  const x = margen.izquierda + (zonaAncho - w) / 2;
  const y = margen.arriba + (zonaAlto - h) / 2;
  return `<image href="${MARCA_URL}" x="${x.toFixed(1)}" y="${y.toFixed(1)}"
           width="${w.toFixed(1)}" height="${h.toFixed(1)}"
           preserveAspectRatio="xMidYMid meet" opacity="0.13"
           aria-hidden="true" pointer-events="none"/>`;
}

/* Fechas legibles: "13 octubre" en vez de "13/10". Se abrevia el mes cuando
   hay muchas etiquetas, para que no se encimen. */
function etiquetaFecha(punto, abreviar) {
  const d = new Date((punto.fecha || "") + "T00:00:00");
  if (isNaN(d)) return punto.etiqueta || "";
  if (punto.modo === "mes") {
    return d.toLocaleDateString("es-MX", { month: abreviar ? "short" : "long" })
            .replace(".", "");
  }
  const mes = d.toLocaleDateString("es-MX", { month: abreviar ? "short" : "long" })
               .replace(".", "");
  return `${d.getDate()} ${mes}`;
}

/* Años que cubre el tramo visible, para rotularlos en la esquina. */
function aniosDe(serie) {
  const anios = [...new Set(serie.map((d) => (d.fecha || "").slice(0, 4)).filter(Boolean))];
  if (!anios.length) return "";
  return anios.length === 1 ? anios[0] : `${anios[0]} — ${anios[anios.length - 1]}`;
}

const compacto = new Intl.NumberFormat("es-MX", {
  notation: "compact", maximumFractionDigits: 1,
});

function escalaX(i, total, ancho) {
  const util = ancho - MARGEN.izquierda - MARGEN.derecha;
  return MARGEN.izquierda + (total <= 1 ? util / 2 : (util * i) / (total - 1));
}

function escalaY(valor, min, max, alto) {
  const util = alto - MARGEN.arriba - MARGEN.abajo;
  const rango = max - min || 1;
  return MARGEN.arriba + util - ((valor - min) / rango) * util;
}

function ticksDe(min, max, cantidad = 4) {
  const paso = (max - min) / cantidad || 1;
  return Array.from({ length: cantidad + 1 }, (_, i) => min + paso * i);
}

function ruta(valores, min, max, ancho, alto) {
  return valores
    .map((v, i) => `${i ? "L" : "M"}${escalaX(i, valores.length, ancho).toFixed(1)} ${escalaY(v, min, max, alto).toFixed(1)}`)
    .join(" ");
}

function dibujarPanel(contenedor, series, opciones) {
  // La escala estira el eje del tiempo: el SVG se dibuja más ancho que su
  // contenedor y éste lo navega con scroll, en vez de apretar los puntos.
  const escala = opciones.escala || 1;
  const ancho = Math.round((contenedor.clientWidth || 720) * escala);
  const alto = opciones.alto || 190;
  const valores = series.flatMap((s) => s.valores);
  let min = Math.min(0, ...valores);
  let max = Math.max(...valores);
  if (opciones.desdeCero === false) {
    const minReal = Math.min(...valores);
    const maxReal = Math.max(...valores);
    const respiro = (maxReal - minReal) * 0.1 || Math.abs(maxReal) * 0.1 || 1;
    min = minReal - respiro;
    max = maxReal + respiro;
    /*
      El respiro es aire visual, no datos, y NUNCA puede inventar un cruce de
      signo: con saldos de 86 a 76,000 el 10% de aire empujaba el piso del eje
      a −7,500 y la gráfica insinuaba un saldo negativo que jamás existió —
      además de despegar del cero a los valores chicos, que con un máximo de
      76 mil deben leerse prácticamente EN el cero. El aire se recorta en 0;
      si el dato sí es negativo (sobregiro real), el eje lo muestra tal cual.
    */
    if (minReal >= 0) min = Math.max(min, 0);
    if (maxReal <= 0) max = Math.min(max, 0);
  }
  if (max === min) max = min + 1;

  // Tope del eje Y: al bajarlo, los valores pequeños ganan altura y se puede
  // ver su comportamiento aunque convivan con uno enorme. Lo que se sale del
  // área queda recortado por el clip y se reporta, para no ocultarlo.
  const topeY = opciones.topeY || 1;
  let fuera = 0;
  if (topeY < 1) {
    max = min + (max - min) * topeY;
    fuera = valores.filter((v) => v > max).length;
  }

  const total = serieActual.length;
  const ticksY = ticksDe(min, max);
  const pasoX = Math.max(1, Math.ceil(total / 8));   // ~8 fechas, sin encimarse

  const grid = ticksY.map((t) => {
    const y = escalaY(t, min, max, alto).toFixed(1);
    return `<line class="viz-grid" x1="${MARGEN.izquierda}" y1="${y}" x2="${ancho - MARGEN.derecha}" y2="${y}"></line>
            <text class="viz-tick" x="${MARGEN.izquierda - 8}" y="${y}" text-anchor="end" dominant-baseline="middle">${compacto.format(t)}</text>`;
  }).join("");

  // Con pocas etiquetas cabe el mes completo; con muchas, se abrevia.
  const visibles = Math.ceil(total / pasoX);
  const abreviar = visibles > 7;
  const fechas = serieActual.map((d, i) =>
    i % pasoX === 0 || i === total - 1
      ? `<text class="viz-tick" x="${escalaX(i, total, ancho).toFixed(1)}" y="${alto - 10}" text-anchor="middle">${etiquetaFecha(d, abreviar)}</text>`
      : "").join("");

  // El año va en la esquina: las etiquetas del eje ya no lo llevan, y sin él
  // no se sabría de qué periodo se está hablando.
  const anios = aniosDe(serieActual);
  const rotuloAnio = anios
    ? `<text class="viz-anio" x="${ancho - MARGEN.derecha}" y="${MARGEN.arriba - 12}"
             text-anchor="end">${anios}</text>`
    : "";

  const areas = series.filter((s) => s.area).map((s) => {
    const d = ruta(s.valores, min, max, ancho, alto);
    const base = escalaY(min, min, max, alto).toFixed(1);
    return `<path class="viz-area--saldo" d="${d} L${escalaX(total - 1, total, ancho).toFixed(1)} ${base} L${escalaX(0, total, ancho).toFixed(1)} ${base} Z"></path>`;
  }).join("");

  const lineas = series.map((s) =>
    `<path class="viz-linea ${s.clase}" d="${ruta(s.valores, min, max, ancho, alto)}"></path>`).join("");

  const marcadores = series.map((s) =>
    `<circle class="viz-punto ${s.clase.replace("viz-linea", "viz-punto")}" style="fill:${s.color}" r="0" data-serie="${s.clave}"></circle>`).join("");

  /*
    Etiquetas de valor sobre los puntos. Antes era todo-o-nada: si no cabían
    todas, sólo se rotulaban el máximo y el último — con 130 días eso dejaba la
    gráfica casi sin montos. Ahora se MUESTREA: se rotula cada N puntos según
    el ancho real disponible (N=1 cuando caben todas), siempre incluyendo el
    máximo y el último dato. Los ceros muestreados se saltan —no informan— y
    entre muestras el tooltip completa el detalle.
  */
  const etiquetas = opciones.etiquetas === false ? "" : series.map((s) => {
    const anchoUtil = ancho - MARGEN.izquierda - MARGEN.derecha;
    const capacidad = Math.max(1, Math.floor(anchoUtil / 52));
    const paso = Math.max(1, Math.ceil(total / capacidad));
    const maximo = s.valores.indexOf(Math.max(...s.valores));
    return s.valores.map((v, i) => {
      const mostrar = i % paso === 0 || i === maximo || i === total - 1;
      if (!mostrar || (paso > 1 && v === 0)) return "";
      const x = escalaX(i, total, ancho);
      const y = escalaY(v, min, max, alto) - 8;
      const anclaje = i === 0 ? "start" : i === total - 1 ? "end" : "middle";
      return `<text class="viz-etiqueta" x="${x.toFixed(1)}" y="${y.toFixed(1)}"
                    text-anchor="${anclaje}" style="fill:${s.color}">${compacto.format(v)}</text>`;
    }).join("");
  }).join("");

  const dimensiones = escala > 1 ? `width="${ancho}" height="${alto}"` : "";
  // Con el eje recortado, lo que se sale no debe pintarse encima del resto.
  const idClip = `recorte-${Math.abs(alto * 31 + ancho)}`;
  contenedor.innerHTML = `
    <svg viewBox="0 0 ${ancho} ${alto}" ${dimensiones}
         role="img" aria-label="${opciones.descripcion}">
      <defs><clipPath id="${idClip}">
        <rect x="0" y="${MARGEN.arriba - 4}" width="${ancho}"
              height="${alto - MARGEN.arriba - MARGEN.abajo + 8}"></rect>
      </clipPath></defs>
      ${marcaAgua(ancho, alto, MARGEN)}
      ${grid}
      <line class="viz-eje" x1="${MARGEN.izquierda}" y1="${alto - MARGEN.abajo}" x2="${ancho - MARGEN.derecha}" y2="${alto - MARGEN.abajo}"></line>
      <g clip-path="url(#${idClip})">${areas}${lineas}</g>
      ${fechas}${etiquetas}${rotuloAnio}
      <line class="viz-crosshair" y1="${MARGEN.arriba}" y2="${alto - MARGEN.abajo}" style="display:none"></line>
      ${marcadores}
      <rect class="viz-captura" x="${MARGEN.izquierda}" y="${MARGEN.arriba}"
            width="${ancho - MARGEN.izquierda - MARGEN.derecha}" height="${alto - MARGEN.arriba - MARGEN.abajo}"></rect>
    </svg>`;

  contenedor._contexto = { ancho, alto, min, max, series };
  contenedor._fueraDeRango = fuera;
  activarHover(contenedor, opciones.tooltip || "tooltip");
}

function activarHover(contenedor, idTooltip) {
  const svg = contenedor.querySelector("svg");
  const captura = svg.querySelector(".viz-captura");
  const cruz = svg.querySelector(".viz-crosshair");
  const puntos = svg.querySelectorAll(".viz-punto");
  const tooltip = el(idTooltip);

  function mover(evento) {
    const { ancho, alto, min, max, series } = contenedor._contexto;
    const caja = svg.getBoundingClientRect();
    const escalaSvg = ancho / caja.width;
    const x = (evento.clientX - caja.left) * escalaSvg;
    const total = serieActual.length;
    const util = ancho - MARGEN.izquierda - MARGEN.derecha;
    const i = Math.max(0, Math.min(total - 1,
      Math.round(((x - MARGEN.izquierda) / util) * (total - 1))));

    const px = escalaX(i, total, ancho);
    cruz.setAttribute("x1", px);
    cruz.setAttribute("x2", px);
    cruz.style.display = "";
    puntos.forEach((punto, n) => {
      const serie = series[n];
      punto.setAttribute("cx", px);
      punto.setAttribute("cy", escalaY(serie.valores[i], min, max, alto));
      punto.setAttribute("r", 4);
    });

    const dia = serieActual[i];
    const fechaLarga = etiquetaFecha(dia, false)
      + ((dia.fecha || "").slice(0, 4) ? ` ${dia.fecha.slice(0, 4)}` : "");
    tooltip.innerHTML = `<div class="tooltip__fecha">${fechaLarga}</div>` +
      series.map((s) => `
        <div class="tooltip__fila">
          <span class="tooltip__etiqueta">
            <span class="leyenda__marca" style="background:${s.color}"></span>${s.nombre}
          </span>
          <span class="tooltip__valor">${pesos.format(s.valores[i])}</span>
        </div>`).join("");
    tooltip.classList.add("grafica__tooltip--visible");

    const contenedorTooltip = tooltip.parentElement.getBoundingClientRect();
    const izquierda = evento.clientX - contenedorTooltip.left + 16;
    tooltip.style.left = `${Math.min(izquierda,
      contenedorTooltip.width - tooltip.offsetWidth - 16)}px`;
    tooltip.style.top = `${evento.clientY - contenedorTooltip.top + 16}px`;
  }

  function salir() {
    cruz.style.display = "none";
    puntos.forEach((p) => p.setAttribute("r", 0));
    tooltip.classList.remove("grafica__tooltip--visible");
  }

  captura.addEventListener("mousemove", mover);
  captura.addEventListener("mouseleave", salir);
  captura.addEventListener("touchmove", (e) => { e.preventDefault(); mover(e.touches[0]); }, { passive: false });
  captura.addEventListener("touchend", salir);
}

function pintarGraficas(serie) {
  serieActual = serie || [];
  const panel = el("panelGraficas");
  if (serieActual.length < 2) { panel.style.display = "none"; return; }
  panel.style.display = "";

  const estilo = getComputedStyle(document.body);
  const verde = estilo.getPropertyValue("--color-success").trim() || "#25d366";
  const rojo = estilo.getPropertyValue("--color-error").trim() || "#e5484d";
  const cian = estilo.getPropertyValue("--color-accent").trim() || "#00e1ff";

  dibujarPanel(el("lienzoFlujos"), [
    { clave: "ingresos", nombre: "Ingresos", clase: "viz-linea--ingreso", color: verde,
      valores: serieActual.map((d) => d.ingresos) },
    { clave: "gastos", nombre: "Gastos", clase: "viz-linea--gasto", color: rojo,
      valores: serieActual.map((d) => d.gastos) },
  ], { descripcion: "Ingresos y gastos por día del periodo", alto: 190 });

  const saldos = serieActual.map((d) => d.saldo);
  if (saldos.every((v) => v !== null && v !== undefined)) {
    el("lienzoSaldo").parentElement.style.display = "";
    dibujarPanel(el("lienzoSaldo"), [
      { clave: "saldo", nombre: "Saldo", clase: "viz-linea--saldo", color: cian,
        valores: saldos, area: true },
    ], { descripcion: "Saldo al cierre de cada día", alto: 160, desdeCero: false });

    // Un saldo NEGATIVO en débito es atípico (sobregiro o error del banco).
    // Si aparece, se dice con todas sus letras en vez de dibujarlo en
    // silencio: dibujado sin aviso parece un defecto de la gráfica.
    const diasNegativos = saldos.filter((v) => v < 0).length;
    const alerta = el("alertaSaldoNegativo");
    alerta.hidden = diasNegativos === 0;
    if (diasNegativos) {
      alerta.textContent = `⚠ ${diasNegativos} día${diasNegativos === 1 ? "" : "s"} `
        + `con saldo negativo. Es atípico en una cuenta de débito: puede ser un `
        + `sobregiro o un error del banco — localízalo en la tabla y verifica.`;
    }
  } else {
    el("lienzoSaldo").parentElement.style.display = "none";
    el("alertaSaldoNegativo").hidden = true;
  }
}

// Redibuja al cambiar el ancho: el SVG se calcula en píxeles reales.
let temporizador;
window.addEventListener("resize", () => {
  clearTimeout(temporizador);
  temporizador = setTimeout(() => { if (serieActual.length) pintarGraficas(serieActual); }, 180);
});

/* --------------------------------------------------------------- filtros --- */
/*
  Los filtros trabajan sobre las filas que ya tiene el navegador, así que la
  respuesta es instantánea. Lo importante es que NO sólo filtran la tabla:
  los indicadores y las gráficas se recalculan con lo filtrado, de modo que
  "solo BBVA" o "solo diciembre" responden cuánto gastaste ahí, sin volver a
  subir nada. La descarga manda los mismos criterios al servidor para que el
  archivo incluya todas las filas que cumplen, no sólo las visibles.
*/

let filasCrudas = [];      // todo lo que mandó el servidor
let filasVisibles = [];    // lo que queda tras filtrar y ordenar
let indicadoresBase = {};  // los del servidor, para restaurar al limpiar

const FILTROS = ["filtroTexto", "filtroDesde", "filtroHasta", "filtroBanco",
                 "filtroTipo", "filtroMin", "filtroMax", "filtroOrden"];

function leerFiltros() {
  const [orden, direccion] = el("filtroOrden").value.split("|");
  return {
    texto: el("filtroTexto").value.trim().toLowerCase(),
    desde: el("filtroDesde").value,
    hasta: el("filtroHasta").value,
    banco: el("filtroBanco").value,
    tipo: el("filtroTipo").value,
    min: el("filtroMin").value === "" ? null : Number(el("filtroMin").value),
    max: el("filtroMax").value === "" ? null : Number(el("filtroMax").value),
    orden, direccion,
  };
}

function hayFiltros(f) {
  return !!(f.texto || f.desde || f.hasta || f.banco || f.tipo ||
            f.min !== null || f.max !== null);
}

// "31/12/2025" -> Date. Las filas llegan con la fecha ya formateada para leerse.
function aFecha(texto) {
  if (!texto) return null;
  const [d, m, a] = String(texto).split("/");
  return a ? new Date(Number(a), Number(m) - 1, Number(d)) : null;
}

function aplicarFiltros() {
  const f = leerFiltros();
  const desde = f.desde ? new Date(f.desde + "T00:00:00") : null;
  const hasta = f.hasta ? new Date(f.hasta + "T23:59:59") : null;

  filasVisibles = filasCrudas.filter((fila) => {
    // La búsqueda barre descripción Y concepto: "renta" debe encontrar el
    // SPEI aunque la palabra viva en el concepto.
    if (f.texto && !`${fila.descripcion || ""} ${fila.concepto || ""}`
        .toLowerCase().includes(f.texto)) return false;
    if (f.banco && fila.banco !== f.banco) return false;
    if (f.tipo && fila.tipo !== f.tipo) return false;
    const monto = Number(fila.monto);
    if (f.min !== null && !(monto >= f.min)) return false;
    if (f.max !== null && !(monto <= f.max)) return false;
    if (desde || hasta) {
      const fecha = aFecha(fila.fecha_operacion);
      if (!fecha) return false;
      if (desde && fecha < desde) return false;
      if (hasta && fecha > hasta) return false;
    }
    return true;
  });

  const signo = f.direccion === "asc" ? 1 : -1;
  filasVisibles.sort((a, b) => {
    let x = a[f.orden], y = b[f.orden];
    if (f.orden === "fecha_operacion") { x = aFecha(x) || 0; y = aFecha(y) || 0; }
    if (f.orden === "monto") { x = Number(x) || 0; y = Number(y) || 0; }
    if (x === y) return 0;
    return (x > y ? 1 : -1) * signo;
  });

  // Contador en la cabecera: con el panel plegado hay que poder ver de un
  // vistazo que los resultados están filtrados.
  const activos = [f.texto, f.desde, f.hasta, f.banco, f.tipo,
                   f.min !== null ? "min" : "", f.max !== null ? "max" : ""]
    .filter(Boolean).length;
  const contador = el("contadorFiltros");
  contador.hidden = activos === 0;
  contador.textContent = `${activos} ${activos === 1 ? "filtro" : "filtros"}`;
  el("btnLimpiar").hidden = !hayFiltros(f);
  pintarTabla(filasVisibles);
  pintarConceptos(filasVisibles);
  recalcular(filasVisibles, hayFiltros(f));

  const total = filasCrudas.length;
  el("resultadoFiltro").innerHTML = filasVisibles.length === total
    ? `Mostrando los <strong>${total}</strong> movimientos`
    : `Mostrando <strong>${filasVisibles.length}</strong> de ${total} movimientos`;
}

/* Recalcula indicadores y gráficas con lo que quedó tras filtrar. */
/* Mismo criterio que el servidor: dinero que sólo cambia de bolsillo. */
const RE_TRASPASO = /INVERSION CRECIENTE|DINERO CRECIENTE|APERTURA INV|LIQ A CHE|CONCENTRACION FONDOS|CUENTA PROPIA|APARTADO|AHORRO PROGRAMADO/i;
const esTraspaso = (f) => RE_TRASPASO.test(String(f.descripcion || ""));

function recalcular(filas, filtrado) {
  const movimientos = filas.filter((f) => !esTraspaso(f));
  const traspasos = filas.filter(esTraspaso);
  const ingresos = movimientos.filter((f) => f.tipo === "Abono");
  const gastos = movimientos.filter((f) => f.tipo === "Cargo");
  const suma = (lista) => lista.reduce((t, f) => t + (Number(f.monto) || 0), 0);

  const ind = JSON.parse(JSON.stringify(indicadoresBase));
  ind.n_movimientos = filas.length;
  ind.ingreso_total = suma(ingresos);
  ind.gasto_total = suma(gastos);
  ind.flujo_neto = ind.ingreso_total - ind.gasto_total;

  const fechas = filas.map((f) => aFecha(f.fecha_operacion)).filter(Boolean).sort((a, b) => a - b);
  const fmt = (d) => d.toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit", year: "numeric" });
  ind.periodo_inicio = fechas.length ? fmt(fechas[0]) : null;
  ind.periodo_fin = fechas.length ? fmt(fechas[fechas.length - 1]) : null;

  const extremo = (lista, mayor) => {
    const validas = lista.filter((f) => Number(f.monto) > 0);
    if (!validas.length) return { monto: null, fecha: null, concepto: "" };
    const elegida = validas.reduce((mejor, f) =>
      (mayor ? Number(f.monto) > Number(mejor.monto) : Number(f.monto) < Number(mejor.monto)) ? f : mejor);
    return { monto: Number(elegida.monto), fecha: elegida.fecha_operacion, concepto: elegida.descripcion };
  };
  ind.ingreso_mayor = extremo(ingresos, true);
  ind.ingreso_menor = extremo(ingresos, false);
  ind.egreso_mayor = extremo(gastos, true);
  ind.egreso_menor = extremo(gastos, false);

  const montos = gastos.map((f) => Number(f.monto)).sort((a, b) => a - b);
  ind.gasto_promedio = montos.length ? suma(gastos) / montos.length : null;
  ind.gasto_mediana = montos.length
    ? (montos.length % 2 ? montos[(montos.length - 1) / 2]
       : (montos[montos.length / 2 - 1] + montos[montos.length / 2]) / 2)
    : null;

  const haciaAhorro = suma(traspasos.filter((f) => f.tipo === "Cargo"));
  const desdeAhorro = suma(traspasos.filter((f) => f.tipo === "Abono"));
  ind.traspasos = traspasos.length
    ? { hay: true, n: traspasos.length, hacia_ahorro: haciaAhorro,
        desde_ahorro: desdeAhorro, neto: haciaAhorro - desdeAhorro }
    : { hay: false, n: 0, hacia_ahorro: 0, desde_ahorro: 0, neto: 0 };

  const conteo = agruparConceptos(gastos);
  ind.concepto_frecuente = conteo.length ? conteo[0].nombre : "";
  ind.concepto_frecuente_veces = conteo.length ? conteo[0].veces : 0;
  ind.concepto_frecuente_total = conteo.length ? conteo[0].total : 0;

  // Al filtrar, los saldos del banco dejan de corresponder al subconjunto.
  if (filtrado) { ind.saldo_inicial = null; ind.saldo_final = null; ind.posicion_neta = null; }

  pintarIndicadores(ind);
  pintarGraficas(serieDesde(filas));
}

/* Serie temporal recalculada en el navegador, con la misma regla de agrupación
   que el servidor: día si el rango es corto, semana o mes si es largo. */
function serieDesde(filas) {
  const conFecha = filas.map((f) => ({ ...f, _f: aFecha(f.fecha_operacion) })).filter((f) => f._f);
  if (conFecha.length < 2) return [];
  const fechas = conFecha.map((f) => f._f).sort((a, b) => a - b);
  const dias = Math.round((fechas[fechas.length - 1] - fechas[0]) / 86400000) + 1;
  const modo = dias <= 92 ? "dia" : dias <= 400 ? "semana" : "mes";

  const clave = (d) => {
    if (modo === "mes") return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    const base = new Date(d);
    if (modo === "semana") base.setDate(base.getDate() - ((base.getDay() + 6) % 7));
    return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
  };

  const cubos = new Map();
  conFecha.forEach((f) => {
    const k = clave(f._f);
    const c = cubos.get(k) || { ingresos: 0, gastos: 0, saldo: null, modo };
    if (f.tipo === "Abono") c.ingresos += Number(f.monto) || 0;
    else c.gastos += Number(f.monto) || 0;
    if (f.saldo !== "" && f.saldo !== null && f.saldo !== undefined) c.saldo = Number(f.saldo);
    cubos.set(k, c);
  });

  const bancos = new Set(filas.map((f) => `${f.banco}|${f.cuenta}`));
  return [...cubos.entries()].sort().map(([k, c]) => {
    const d = new Date(k + "T00:00:00");
    return {
      fecha: k,
      modo,
      etiqueta: modo === "mes"
        ? d.toLocaleDateString("es-MX", { month: "2-digit", year: "numeric" })
        : d.toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit" }),
      ingresos: c.ingresos, gastos: c.gastos,
      // Igual que en el servidor: un saldo que mezcla cuentas no existe.
      saldo: bancos.size > 1 ? null : c.saldo,
    };
  });
}

/* Agrupa los gastos por concepto para "en qué se te va el dinero". */
function agruparConceptos(gastos) {
  const RUIDO = new Set(["de", "del", "la", "el", "los", "las", "a", "al", "en",
    "por", "para", "con", "y", "su", "sus", "un", "una", "no", "se", "es", "sa", "cv"]);
  const mapa = new Map();
  gastos.forEach((f) => {
    const nombre = String(f.descripcion || "").split(/\s+/)
      .filter((p) => p && !/\d/.test(p) && !RUIDO.has(p.toLowerCase()))
      .slice(0, 3).join(" ").toUpperCase();
    if (!nombre) return;
    const c = mapa.get(nombre) || { nombre, veces: 0, total: 0 };
    c.veces += 1; c.total += Number(f.monto) || 0;
    mapa.set(nombre, c);
  });
  return [...mapa.values()].sort((a, b) => b.total - a.total);
}

function pintarConceptos(filas) {
  const gastos = filas.filter((f) => f.tipo === "Cargo");
  const top = agruparConceptos(gastos).slice(0, 8);
  const panel = el("panelConceptos");
  if (top.length < 2) { panel.hidden = true; return; }
  panel.hidden = false;
  const mayor = top[0].total || 1;
  const totalGasto = gastos.reduce((t, f) => t + (Number(f.monto) || 0), 0) || 1;
  /*
    La cifra grande es el ACUMULADO del concepto, no lo que costó cada vez.
    Sin decirlo, "98,235" junto a "15 veces" se lee como quince cargos de esa
    cantidad; por eso va rotulada como total y acompañada del promedio.
  */
  el("listaConceptos").innerHTML = top.map((c, i) => `
    <li class="concepto">
      <span class="concepto__puesto">${i + 1}</span>
      <span class="concepto__cuerpo">
        <span class="concepto__nombre" title="${c.nombre}">${c.nombre}</span>
        <span class="concepto__barra"><span class="concepto__relleno" style="width:${(c.total / mayor) * 100}%"></span></span>
        <span class="concepto__detalle">
          ${c.veces} ${c.veces === 1 ? "movimiento" : "movimientos"}
          · ${pesos.format(c.total / c.veces)} en promedio
          · ${((c.total / totalGasto) * 100).toFixed(1)}% de tus gastos
        </span>
      </span>
      <span class="concepto__cifras">
        <span class="concepto__total">${pesos.format(c.total)}</span>
        <span class="concepto__veces">sumando los ${c.veces}</span>
      </span>
    </li>`).join("");
}

FILTROS.forEach((id) => {
  const campo = el(id);
  const evento = campo.tagName === "SELECT" || campo.type === "date" ? "change" : "input";
  campo.addEventListener(evento, () => {
    document.querySelectorAll("[data-rapido]").forEach((c) => c.classList.remove("chip--activo"));
    aplicarFiltros();
  });
});

document.querySelectorAll("[data-rapido]").forEach((chip) =>
  chip.addEventListener("click", () => {
    limpiarFiltros(false);
    const modo = chip.dataset.rapido;
    if (modo === "gastos") el("filtroTipo").value = "Cargo";
    if (modo === "ingresos") el("filtroTipo").value = "Abono";
    if (modo === "grandes") { el("filtroMin").value = 1000; el("filtroOrden").value = "monto|desc"; }
    if (modo === "hormiga") { el("filtroMax").value = 200; el("filtroTipo").value = "Cargo"; }
    document.querySelectorAll("[data-rapido]").forEach((c) => c.classList.remove("chip--activo"));
    if (modo !== "todo") chip.classList.add("chip--activo");
    aplicarFiltros();
  }));

function limpiarFiltros(repintar = true) {
  el("filtroTexto").value = "";
  el("filtroDesde").value = "";
  el("filtroHasta").value = "";
  el("filtroBanco").value = "";
  el("filtroTipo").value = "";
  el("filtroMin").value = "";
  el("filtroMax").value = "";
  el("filtroOrden").value = "fecha_operacion|asc";
  document.querySelectorAll("[data-rapido]").forEach((c) => c.classList.remove("chip--activo"));
  if (repintar) aplicarFiltros();
}

el("btnLimpiar").addEventListener("click", () => limpiarFiltros());

/* Panel plegable: los filtros no compiten con los resultados hasta que se
   buscan, pero un click en un filtro rápido lo abre para mostrar qué se aplicó. */
function alternarFiltros(abrir) {
  el("cuerpoFiltros").hidden = !abrir;
  el("toggleFiltros").setAttribute("aria-expanded", String(abrir));
}
el("toggleFiltros").addEventListener("click", () =>
  alternarFiltros(el("cuerpoFiltros").hidden));

/* ------------------------------------------------- visor a pantalla completa --- */
/*
  La vista compacta comparte espacio con el resto de la página; aquí la gráfica
  ocupa todo, así que caben las etiquetas de valor y un control de rango con el
  que acotar el periodo arrastrando, sin escribir fechas.
*/

let rangoVisor = { desde: 0, hasta: 0 };   // índices sobre serieCompleta
let serieCompleta = [];

function abrirVisor() {
  if (!serieActual.length) return;
  serieCompleta = serieActual.slice();
  rangoVisor = { desde: 0, hasta: serieCompleta.length - 1 };
  el("visor").hidden = false;
  document.body.style.overflow = "hidden";
  sincronizarFechasVisor();
  dibujarMiniatura();
  redibujarVisor();
}

function cerrarVisor() {
  el("visor").hidden = true;
  document.body.style.overflow = "";
  // Al volver, la vista compacta se repinta por si cambió de tamaño.
  if (serieActual.length) pintarGraficas(serieActual);
}

function serieDelRango() {
  return serieCompleta.slice(rangoVisor.desde, rangoVisor.hasta + 1);
}

function redibujarVisor() {
  const trozo = serieDelRango();
  if (trozo.length < 2) return;
  serieActual = trozo;                    // las funciones de dibujo lo usan

  const estilo = getComputedStyle(document.body);
  const verde = estilo.getPropertyValue("--color-success").trim();
  const rojo = estilo.getPropertyValue("--color-error").trim();
  const cian = estilo.getPropertyValue("--color-accent").trim();
  const conEtiquetas = el("visorEtiquetas").checked;
  const escala = Number(el("visorEscala").value) / 100;
  const topeY = Number(el("visorEscalaY").value) / 100;
  const saldos = trozo.map((d) => d.saldo);
  const haySaldo = saldos.every((v) => v !== null && v !== undefined);
  const altoTotal = Math.max(220, Math.floor(window.innerHeight * (haySaldo ? 0.30 : 0.48)));

  dibujarPanel(el("visorFlujos"), [
    { clave: "ingresos", nombre: "Ingresos", clase: "viz-linea--ingreso", color: verde,
      valores: trozo.map((d) => d.ingresos) },
    { clave: "gastos", nombre: "Gastos", clase: "viz-linea--gasto", color: rojo,
      valores: trozo.map((d) => d.gastos) },
  ], { descripcion: "Ingresos y gastos del periodo seleccionado", alto: altoTotal,
       etiquetas: conEtiquetas, tooltip: "visorTooltip", escala, topeY });

  el("visorFiguraSaldo").hidden = !haySaldo;
  if (haySaldo) {
    dibujarPanel(el("visorSaldo"), [
      { clave: "saldo", nombre: "Saldo", clase: "viz-linea--saldo", color: cian,
        valores: saldos, area: true },
    ], { descripcion: "Saldo al cierre", alto: altoTotal, desdeCero: false,
         etiquetas: conEtiquetas, tooltip: "visorTooltip", escala, topeY });
    sincronizarScroll();
  }

  // Recortar el eje sin avisarlo haría creer que no hay más datos.
  const fuera = (el("visorFlujos")._fueraDeRango || 0)
              + (haySaldo ? (el("visorSaldo")._fueraDeRango || 0) : 0);
  el("avisoRecorte").hidden = fuera === 0;
  if (fuera) {
    el("avisoRecorte").textContent =
      `⚠ ${fuera} ${fuera === 1 ? "valor se sale" : "valores se salen"} del eje `
      + "· sube la escala vertical para verlos";
  }

  el("visorRangoTexto").textContent =
    `${trozo[0].etiqueta} — ${trozo[trozo.length - 1].etiqueta} · ${trozo.length} puntos`;
  actualizarSeleccionBrush();
}

/* Miniatura del brush: el periodo completo, para saber qué parte se está viendo. */
function dibujarMiniatura() {
  const mini = el("brushMini");
  const ancho = mini.clientWidth || 560;
  const alto = 46;
  const flujo = serieCompleta.map((d) => d.ingresos - d.gastos);
  const max = Math.max(...flujo.map(Math.abs), 1);
  const y = (v) => alto / 2 - (v / max) * (alto / 2 - 4);
  const linea = flujo.map((v, i) => {
    const x = (ancho * i) / Math.max(1, serieCompleta.length - 1);
    return `${i ? "L" : "M"}${x.toFixed(1)} ${y(v).toFixed(1)}`;
  }).join(" ");
  mini.innerHTML = `<svg viewBox="0 0 ${ancho} ${alto}" preserveAspectRatio="none">
      <line x1="0" y1="${alto / 2}" x2="${ancho}" y2="${alto / 2}" class="viz-grid"></line>
      <path d="${linea}" class="viz-linea viz-linea--saldo"></path>
    </svg>`;
}

function actualizarSeleccionBrush() {
  const total = serieCompleta.length - 1 || 1;
  const seleccion = el("brushSeleccion");
  seleccion.style.left = `${(rangoVisor.desde / total) * 100}%`;
  seleccion.style.width = `${((rangoVisor.hasta - rangoVisor.desde) / total) * 100}%`;
}

function sincronizarFechasVisor() {
  const desde = serieCompleta[rangoVisor.desde];
  const hasta = serieCompleta[rangoVisor.hasta];
  if (desde) el("visorDesde").value = desde.fecha;
  if (hasta) el("visorHasta").value = hasta.fecha;
}

/* Arrastre del brush: manijas para acotar, centro para desplazar. */
(function activarBrush() {
  const brush = el("brush");
  let arrastrando = null;
  let inicioX = 0;
  let rangoInicial = null;

  const indiceDe = (clientX) => {
    const caja = brush.getBoundingClientRect();
    const proporcion = Math.min(1, Math.max(0, (clientX - caja.left) / caja.width));
    return Math.round(proporcion * (serieCompleta.length - 1));
  };

  brush.addEventListener("pointerdown", (e) => {
    if (!serieCompleta.length) return;
    arrastrando = e.target.dataset.manija
      || (e.target.id === "brushSeleccion" ? "centro" : "nuevo");
    inicioX = e.clientX;
    rangoInicial = { ...rangoVisor };
    if (arrastrando === "nuevo") {
      const i = indiceDe(e.clientX);
      rangoVisor = { desde: i, hasta: Math.min(serieCompleta.length - 1, i + 1) };
      arrastrando = "der";
      rangoInicial = { ...rangoVisor };
    }
    brush.setPointerCapture(e.pointerId);
  });

  brush.addEventListener("pointermove", (e) => {
    if (!arrastrando) return;
    const ultimo = serieCompleta.length - 1;
    if (arrastrando === "centro") {
      const caja = brush.getBoundingClientRect();
      const salto = Math.round(((e.clientX - inicioX) / caja.width) * ultimo);
      const ancho = rangoInicial.hasta - rangoInicial.desde;
      let desde = Math.min(Math.max(0, rangoInicial.desde + salto), ultimo - ancho);
      rangoVisor = { desde, hasta: desde + ancho };
    } else {
      const i = indiceDe(e.clientX);
      if (arrastrando === "izq") rangoVisor.desde = Math.min(i, rangoVisor.hasta - 1);
      else rangoVisor.hasta = Math.max(i, rangoVisor.desde + 1);
      rangoVisor.desde = Math.max(0, rangoVisor.desde);
      rangoVisor.hasta = Math.min(ultimo, rangoVisor.hasta);
    }
    actualizarSeleccionBrush();
    sincronizarFechasVisor();
    redibujarVisor();
  });

  ["pointerup", "pointercancel"].forEach((evento) =>
    brush.addEventListener(evento, () => { arrastrando = null; }));
})();

/* Controles del visor */
el("btnExpandir").addEventListener("click", abrirVisor);
el("btnCerrarVisor").addEventListener("click", cerrarVisor);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !el("visor").hidden) cerrarVisor();
});
el("visorEtiquetas").addEventListener("change", redibujarVisor);

/* Los dos paneles comparten el eje de tiempo: al desplazar uno, el otro sigue,
   porque si no dejarían de estar alineados y la comparación se rompería. */
function sincronizarScroll() {
  const paneles = [el("visorFlujos"), el("visorSaldo")];
  paneles.forEach((panel) => {
    if (panel._sincronizado) return;
    panel._sincronizado = true;
    panel.addEventListener("scroll", () => {
      paneles.forEach((otro) => {
        if (otro !== panel && otro.scrollLeft !== panel.scrollLeft) {
          otro.scrollLeft = panel.scrollLeft;
        }
      });
    });
  });
}

el("visorEscala").addEventListener("input", () => {
  el("escalaValor").textContent = `${el("visorEscala").value}%`;
  redibujarVisor();
});

el("visorEscalaY").addEventListener("input", () => {
  el("escalaVerticalValor").textContent = `${el("visorEscalaY").value}%`;
  redibujarVisor();
});

function indicePorFecha(valor, porDefecto) {
  const i = serieCompleta.findIndex((d) => d.fecha >= valor);
  return i === -1 ? porDefecto : i;
}

["visorDesde", "visorHasta"].forEach((id) =>
  el(id).addEventListener("change", () => {
    const ultimo = serieCompleta.length - 1;
    let desde = el("visorDesde").value ? indicePorFecha(el("visorDesde").value, 0) : 0;
    let hasta = el("visorHasta").value ? indicePorFecha(el("visorHasta").value, ultimo) : ultimo;
    if (hasta <= desde) hasta = Math.min(ultimo, desde + 1);
    rangoVisor = { desde, hasta };
    redibujarVisor();
  }));

el("visorAtajo").addEventListener("change", () => {
  const ultimo = serieCompleta.length - 1;
  const meses = { "1m": 1, "3m": 3, "6m": 6 }[el("visorAtajo").value];
  if (!meses) {
    rangoVisor = { desde: 0, hasta: ultimo };
  } else {
    const fin = new Date(serieCompleta[ultimo].fecha + "T00:00:00");
    const corte = new Date(fin);
    corte.setMonth(corte.getMonth() - meses);
    const iso = corte.toISOString().slice(0, 10);
    rangoVisor = { desde: indicePorFecha(iso, 0), hasta: ultimo };
    if (rangoVisor.hasta - rangoVisor.desde < 1) rangoVisor.desde = Math.max(0, ultimo - 1);
  }
  sincronizarFechasVisor();
  redibujarVisor();
});

window.addEventListener("resize", () => {
  if (!el("visor").hidden && serieCompleta.length) {
    dibujarMiniatura();
    redibujarVisor();
  }
});

/* ----------------------------------------------------------------- tabla --- */
/*
  Las columnas se arman con lo que trae cada banco: no todos imprimen saldo,
  fecha de cargo o número de cuenta, y una columna entera vacía es sólo ruido.
  El archivo de origen no está aquí a propósito: identifica al documento, no al
  movimiento, así que viaja en el nombre del archivo descargado.
*/
const NOMBRES_COLUMNA = {
  fecha_operacion: "Fecha", fecha_cargo: "Fecha cargo", descripcion: "Descripción",
  concepto: "Concepto", referencia: "Referencia", tipo: "Tipo", monto: "Monto",
  moneda: "Moneda", saldo: "Saldo", banco: "Banco", producto: "Producto",
  cuenta: "Cuenta",
};
const COLUMNAS_MONTO = new Set(["monto", "saldo"]);

/*
  La tabla se pagina: nadie recorre cientos de movimientos con scroll, y llegar
  al último obligaba a pasar por todos. Diez por página es lo que se lee de un
  vistazo sin que la tabla empuje el resto de la página fuera de vista; quien
  busca uno concreto tiene los filtros arriba, y la descarga siempre trae TODO
  lo filtrado, no sólo la página visible.
*/
const FILAS_POR_PAGINA = 10;
let paginaActual = 1;
let filasTabla = [];

function totalPaginas() {
  return Math.max(1, Math.ceil(filasTabla.length / FILAS_POR_PAGINA));
}

function irAPagina(n) {
  paginaActual = Math.min(Math.max(1, n), totalPaginas());
  pintarPagina();
}

function pintarTabla(filas) {
  filasTabla = filas;
  paginaActual = 1;          // un filtro nuevo siempre arranca en la primera
  pintarPagina();
}

function pintarPagina() {
  const filas = filasTabla;
  const cabecera = el("cabeceraTabla");
  const cuerpo = el("cuerpoTabla");
  const nav = el("paginacion");
  if (!filas.length) {
    cabecera.innerHTML = ""; cuerpo.innerHTML = ""; nav.hidden = true; return;
  }

  const columnas = Object.keys(filas[0]);
  const [ordenActual, direccionActual] = el("filtroOrden").value.split("|");
  // Ordenar por descripción (alfabético) no responde ninguna pregunta real;
  // sólo fecha y monto son ordenamientos con significado.
  const ORDENABLES = new Set(["fecha_operacion", "monto"]);

  cabecera.innerHTML = "<tr>" + columnas.map((c) => {
    const flecha = c === ordenActual ? (direccionActual === "asc" ? " ▲" : " ▼") : "";
    const clases = [COLUMNAS_MONTO.has(c) ? "celda--monto" : ""].join(" ");
    return ORDENABLES.has(c)
      ? `<th class="${clases}" data-orden="${c}">${NOMBRES_COLUMNA[c] || c}<span class="flecha">${flecha || " ⇅"}</span></th>`
      : `<th class="${clases}">${NOMBRES_COLUMNA[c] || c}</th>`;
  }).join("") + "</tr>";

  // Click en el encabezado: ordena, y vuelve a hacer click para invertir.
  cabecera.querySelectorAll("[data-orden]").forEach((th) =>
    th.addEventListener("click", () => {
      const columna = th.dataset.orden;
      const invertida = columna === ordenActual && direccionActual === "asc" ? "desc" : "asc";
      el("filtroOrden").value = `${columna}|${invertida}`;
      aplicarFiltros();
    }));

  const desde = (paginaActual - 1) * FILAS_POR_PAGINA;
  const visibles = filas.slice(desde, desde + FILAS_POR_PAGINA);

  cuerpo.innerHTML = visibles.map((fila) => "<tr>" + columnas.map((c) => {
    const valor = fila[c];
    if (COLUMNAS_MONTO.has(c)) {
      const tono = c === "monto" ? (fila.tipo === "Cargo" ? "celda--cargo" : "celda--abono") : "";
      return `<td class="celda--monto ${tono}">${valor === "" || valor === null ? "" : pesos.format(valor)}</td>`;
    }
    if (c === "descripcion" || c === "concepto") {
      return `<td class="celda--desc">${escapar(valor || "")}</td>`;
    }
    return `<td${c === "fecha_operacion" ? ' style="white-space:nowrap"' : ""}>${escapar(valor ?? "")}</td>`;
  }).join("") + "</tr>").join("");

  // La navegación se oculta cuando todo cabe en una página: un control que no
  // hace nada sólo añade ruido.
  const paginas = totalPaginas();
  nav.hidden = paginas <= 1;
  el("pagInfo").textContent =
    `${desde + 1}–${desde + visibles.length} de ${filas.length.toLocaleString("es-MX")}`
    + ` · página ${paginaActual} de ${paginas}`;
  el("pagPrimera").disabled = paginaActual === 1;
  el("pagAnterior").disabled = paginaActual === 1;
  el("pagSiguiente").disabled = paginaActual === paginas;
  el("pagUltima").disabled = paginaActual === paginas;
}

el("pagPrimera").addEventListener("click", () => irAPagina(1));
el("pagAnterior").addEventListener("click", () => irAPagina(paginaActual - 1));
el("pagSiguiente").addEventListener("click", () => irAPagina(paginaActual + 1));
el("pagUltima").addEventListener("click", () => irAPagina(totalPaginas()));

/* La descarga lleva los filtros al servidor: el archivo trae TODAS las filas
   que cumplen, no sólo las que se alcanzan a ver en pantalla. */
function rutaDescarga(formato) {
  const f = leerFiltros();
  const parametros = new URLSearchParams();
  if (f.texto) parametros.set("texto", f.texto);
  if (f.desde) parametros.set("desde", f.desde);
  if (f.hasta) parametros.set("hasta", f.hasta);
  if (f.banco) parametros.set("banco", f.banco);
  if (f.tipo) parametros.set("tipo", f.tipo);
  if (f.min !== null) parametros.set("min", f.min);
  if (f.max !== null) parametros.set("max", f.max);
  parametros.set("orden", f.orden);
  parametros.set("dir", f.direccion);
  return `/api/descargar/${formato}?${parametros}`;
}

/*
  Por qué la descarga no es una navegación (hallazgo F29).

  Era `location.href = urlDescarga(...)`, la ÚNICA llamada de este archivo que
  no pasaba por `apiFetch`. Eso rompía dos cosas al mismo tiempo, y ninguna se
  notaba en el simulador —donde un mismo Flask sirve la página y la API—:

    1. La ruta relativa apuntaba a taudux.com, y `vercel.json` no proxea
       `/api`. Medido: 404.
    2. Una navegación no puede llevar cabeceras, así que aunque el host fuera
       el correcto no habría `Authorization: Bearer` y el servidor no sabría
       quién pide el archivo.

  De ahí la forma actual: `fetch` con token -> Blob -> `<a download>` sintético.
  Es la única manera de mandar el token, y trae de la mano el requisito del
  nombre del archivo, que con Blob ya no lo pone el navegador.
*/

const NOMBRE_UTF8 = /filename\*=UTF-8''([^;]+)/i;   // RFC 5987
const NOMBRE_SIMPLE = /filename="?([^";]+)"?/i;

function nombreDelServidor(respuesta, formato) {
  // El nombre bueno lo arma el servidor con el banco y el PDF de origen
  // (`_nombre_archivo()`), y viaja en `Content-Disposition`. Sólo se puede leer
  // porque la API la expone con `Access-Control-Expose-Headers`; si eso se
  // cayera, esta función no lanza: entrega un nombre de reserva con su
  // extensión, que es peor que el bueno pero muchísimo mejor que "descarga".
  const cabecera = respuesta.headers.get("Content-Disposition") || "";

  // `filename*` primero, y no por gusto: Flask manda LOS DOS, con el simple
  // antes en la cadena, pero ése es la variante degradada a ASCII — un estado
  // de cuenta de "ñandú" llega ahí como "nandu". El codificado es el fiel.
  const utf8 = cabecera.match(NOMBRE_UTF8);
  const simple = cabecera.match(NOMBRE_SIMPLE);
  const crudo = (utf8 && utf8[1]) || (simple && simple[1]);
  if (!crudo) return `transacciones.${formato}`;
  try {
    return decodeURIComponent(crudo.trim());
  } catch (error) {
    // Un `%` suelto en el nombre revienta el decodificador. Vale más el nombre
    // crudo que ninguno.
    return crudo.trim();
  }
}

function guardarArchivo(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  // Liberar en el mismo turno cancela la descarga en varios navegadores: el
  // click acaba de encolarse y todavía no leyó el blob.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// Lo que el servidor puede negar, con el texto que se muestra si no manda uno
// propio. Antes los tres fallos se veían igual: no pasaba nada.
const AVISOS_DESCARGA = {
  sin_descargas: "Tu plan no incluye descargas.",
  sin_datos: "Ya no tenemos esa extracción. Vuelve a subir tu estado de cuenta.",
};

async function descargar(formato) {
  const boton = el(formato === "csv" ? "btnCsv" : "btnExcel");
  boton.disabled = true;
  try {
    const respuesta = await apiFetch(rutaDescarga(formato));

    if (!respuesta.ok) {
      const json = await respuesta.json().catch(() => ({}));
      // Un 402 trae la cuota al día: si el plan cambió, la pantalla se entera
      // por esta vía y no se queda ofreciendo algo que ya no puede dar.
      if (json.cuota) actualizarCuota(json.cuota);
      mostrarToast(json.mensaje || AVISOS_DESCARGA[json.error]
                   || "No pudimos generar el archivo.", "error");
      return;
    }

    guardarArchivo(await respuesta.blob(), nombreDelServidor(respuesta, formato));
  } catch (error) {
    // El aviso va por toast y NO por `mostrarError`: esa función llama a
    // `ocultarTodo()`, que esconde la tabla recién extraída. Perder el
    // resultado por no haber podido bajarlo sería un castigo desproporcionado.
    console.error("[extractor] no se pudo descargar:", error);
    mostrarToast("No pudimos descargar el archivo. Revisa tu conexión e "
                 + "inténtalo de nuevo.", "error");
  } finally {
    // Se restaura desde el permiso vigente, no a `false`: si el servidor acaba
    // de decir que este plan no descarga, el botón tiene que quedar apagado.
    aplicarBloqueo();
  }
}

el("btnExcel").addEventListener("click", () => descargar("xlsx"));
el("btnCsv").addEventListener("click", () => descargar("csv"));

/* --------------------------------------------------------------- cuota --- */

function actualizarCuota(cuota) {
  planActual = cuota.plan;
  // Las capacidades vienen resueltas del servidor; el front no las deduce.
  permisos = cuota.puede || { paneles: [], descargas: false };
  avisoPlan = cuota.aviso || "";
  permiteLote = !!permisos.lote;
  el("cuotaRestantes").textContent = cuota.restantes === null ? "∞" : cuota.restantes;
  // "Te quedan N extracciones" sólo tiene sentido si hay una N. Desde el
  // 2026-08-21 `anonimo` viene sin techo (`limite: null` en el servidor): la
  // cuota de 2 se midió en producción y no se hacía cumplir —cada petición
  // nacía con identidad nueva porque este archivo nunca llegó a mandar
  // `X-Sesion-Anon`— así que se dejó de prometer un número que no se cobraba.
  // Lo que ahora limita a quien no tiene cuenta es la DESCARGA, y de eso
  // avisan los botones y `avisoBloqueado`, no este contador.
  siExiste("cajaCuota", (n) => { n.hidden = cuota.plan === "anonimo"; });

  // Sólo del simulador: en producción estos tres no existen.
  siExiste("planActual", (n) => { n.textContent = cuota.plan; });
  siExiste("pestaniaPlan", (n) => {
    n.textContent = cuota.ilimitado ? `${cuota.plan} · ∞` : cuota.plan;
  });
  siExiste("permiteLote", (n) => { n.textContent = permiteLote ? "sí" : "no"; });

  // Acá se rearmaba el menú de cuenta. Ya no: lo monta `navbar.js`, que es el
  // dueño de la barra en todo el sitio. Ver la nota al final de este archivo.
  //
  // Además de pisar el menú, esa llamada podía cortar esta función a la mitad:
  // buscaba `#menuCuentaLista` sin guarda, y si /api/cuota respondía antes de
  // que el navbar montara, lanzaba y se saltaba todo lo de abajo —incluido
  // `aplicarBloqueo()`—. Los try/catch de arriba se lo tragaban en silencio.

  // "Te quedan N extracciones" no aplica a quien tiene acceso ilimitado.
  const leyenda = el("leyendaCuota");
  if (leyenda) {
    leyenda.textContent = cuota.ilimitado
      ? `Acceso ilimitado de pruebas${cuota.motivo ? ` · ${cuota.motivo}` : ""}`
      : (cuota.renueva && cuota.restantes === 0
        ? `Sin extracciones · se renueva el ${cuota.renueva}`
        : "");
  }
  // Singular o plural según lo que el plan realmente permite subir.
  el("tituloDropzone").textContent = permiteLote
    ? "Arrastra tus estados de cuenta aquí"
    : "Arrastra tu estado de cuenta aquí";
  dropzone.setAttribute("aria-label", permiteLote
    ? "Arrastra tus PDF o haz clic para elegirlos"
    : "Arrastra tu PDF o haz clic para elegirlo");
  el("notaDropzone").textContent = permiteLote
    ? "o haz clic para elegirlos · puedes subir varios a la vez · PDF · máx. 25 MB c/u"
    : "o haz clic para elegir el archivo · PDF · máximo 25 MB";
  aplicarBloqueo();
}

/*
  Qué ve cada plan LO DECIDE EL SERVIDOR.

  Aquí no hay nombres de planes ni reglas: el servidor manda en `cuota.puede`
  qué paneles se desbloquean y si hay descargas, y esta función obedece. Por
  eso activar un nivel nuevo no toca este archivo — y por eso nadie puede
  darse permisos editando el JavaScript: el servidor vuelve a comprobar cada
  descarga y cada extracción.

  Los movimientos destacados no están en la lista: se ven SIEMPRE, en todos
  los planes, porque son la prueba de que la extracción funcionó.
*/
const TODOS_LOS_PANELES = ["panelTabla", "resumen", "panelGraficas",
                           "panelMsi", "panelConceptos"];
// Lo que dijo el servidor la última vez. Arranca cerrado: si la consulta falla,
// se ve de menos, nunca de más.
let permisos = { paneles: [], descargas: false };
let avisoPlan = "";

function aplicarBloqueo() {
  const visibles = new Set(permisos.paneles || []);
  TODOS_LOS_PANELES.forEach((id) => {
    const panel = el(id);
    if (panel) panel.classList.toggle("velado", !visibles.has(id));
  });
  const puedeDescargar = permisos.descargas !== false;
  // El PERMISO sale de `permisos.descargas` y de nada más (arriba). Lo que
  // sigue es sólo la REDACCIÓN del motivo: "Tu plan no incluye descargas" no
  // le dice nada a quien no eligió ningún plan, y desde el 2026-08-21 el
  // anónimo es justo quien más ve este texto. Para él la frase útil no es un
  // diagnóstico, es la salida.
  const motivoSinDescarga = planActual === "anonimo"
    ? "Crea una cuenta gratis para descargar tu Excel o CSV"
    : "Tu plan no incluye descargas";
  ["btnExcel", "btnCsv"].forEach((id) => {
    el(id).disabled = !puedeDescargar;
    el(id).title = puedeDescargar ? "" : motivoSinDescarga;
  });
  // El visor de pantalla completa mostraría las gráficas SIN velo: se apaga
  // también (el blur ya bloquea el mouse, esto cierra la vía del teclado).
  el("btnExpandir").disabled = !visibles.has("panelGraficas");

  const faltan = TODOS_LOS_PANELES.length - visibles.size;
  el("avisoBloqueado").hidden = faltan === 0;
  if (faltan) {
    el("avisoBloqueadoTexto").textContent = avisoPlan;
    // El botón de crear cuenta sólo tiene sentido para quien no la tiene.
    el("btnCrearCuenta").hidden = planActual !== "anonimo";
  }
}

async function cambiarPlan(plan) {
  const r = await apiFetch("/api/cuenta", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan }),
  });
  const json = await r.json();
  // Un plan desactivado se rechaza en el SERVIDOR (409): el catálogo manda,
  // no el botón. Así se prueba de verdad que Green/Silver/Gold están cerrados.
  if (!r.ok) {
    mostrarError("Ese plan todavía no está disponible",
                 json.mensaje || "Sigue en pruebas.");
    if (json.cuota) actualizarCuota(json.cuota);
    return;
  }
  actualizarCuota(json.cuota);
}

/*
  Entrar / salir con un correo. En producción lo hace Supabase Auth y el
  servidor lee el correo del token, no de lo que mande el navegador.
*/
async function entrarComo(correo) {
  const r = await apiFetch("/api/sesion", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ correo }),
  });
  actualizarCuota((await r.json()).cuota);
}

// Los controles de "entrar como" existen SÓLO en el simulador; en producción
// la sesión la inicia el sitio y el servidor lee el correo del token.
if (EN_SIMULADOR) {
  el("btnEntrar").addEventListener("click", () => entrarComo(el("correoSimulado").value));
  el("correoSimulado").addEventListener("keydown", (e) => {
    if (e.key === "Enter") entrarComo(el("correoSimulado").value);
  });
  el("btnSalir").addEventListener("click", () => {
    el("correoSimulado").value = "";
    entrarComo("");
  });
}

/* ------------------------------------------------------- menú de cuenta --- */
/*
  ACÁ NO HAY MENÚ, Y ES A PROPÓSITO.

  Esta herramienta llegó de `aplicacion-financiera` con su propio menú de
  cuenta. En taudux la barra la monta `app/shared/navbar/navbar.js`, que es su
  único dueño en todo el sitio. El menú heredado sobrevivió a la portación y
  estuvo hasta el 2026-08-20 pisándole el suyo, porque los dos usaban el mismo
  id: `navbar.js` crea la lista como `#menuCuentaLista` y esto la reescribía
  entera con `innerHTML`.

  Se veía como una diferencia cosmética —el correo en vez del nombre, sin las
  flechas de los acordeones, "Mi cuenta" y "Academy" en gris— pero se llevaba
  puesto algo serio: **el "Salir" inyectado acá no cerraba la sesión**. Llamaba
  a `entrarComo("")`, que es un POST al backend del extractor; el que cierra de
  verdad es `salirYVolver()` de `navbar.js`, contra Supabase. Quien lo pulsaba
  en esta página creía haber salido y seguía dentro.

  Lo que este archivo aportaba y no se perdió:

  - **El panel de administración** vive ahora en `ENLACES_NAVEGACION_BASE` de
    `navbar.js` con `soloAdmin: true`, así que aparece en TODAS las páginas
    para quien es admin. Antes sólo existía acá, y un admin parado en Cursos no
    tenía cómo llegar.

  Regla que deja el episodio: `features/` no monta ni estiliza el navbar. Si
  hace falta algo del menú, se agrega en `shared/navbar/`. Lo blinda
  `tests/navbar-jerarquia.test.js`.
*/

document.querySelectorAll("[data-plan]").forEach((boton) =>
  boton.addEventListener("click", () => cambiarPlan(boton.dataset.plan)));

siExiste("btnReiniciar", (boton) => boton.addEventListener("click", async () => {
  const r = await apiFetch("/api/reiniciar", { method: "POST" });
  actualizarCuota((await r.json()).cuota);
}));

// Los dos botones de "crear cuenta" venían del navbar propio de esta
// herramienta; en taudux esa llamada a la acción vive en la barra del sitio.
siExiste("btnAcceder", (b) => b.addEventListener("click", () => cambiarPlan("free")));
siExiste("btnCrearCuenta", (b) => b.addEventListener("click", () => cambiarPlan("free")));

/* ------------------------------------------- ¿falta algún indicador? --- */
/*
  Se pregunta justo después de que el usuario vio sus números: es el momento en
  que sabe qué le faltó. Las opciones predefinidas dan la señal cuantitativa
  (qué se pide más) y el campo libre trae lo que no anticipamos. Nada de esto
  guarda información financiera: sólo qué indicador interesa.
*/

const votos = new Set();

async function cargarIndicadoresPropuestos() {
  const opciones = await (await apiFetch("/api/indicadores-propuestos")).json();
  el("opcionesIndicadores").innerHTML = opciones.map((o) =>
    `<button type="button" class="pedir__opcion" data-voto="${o.clave}"
             aria-pressed="false">${o.texto}</button>`).join("");

  el("opcionesIndicadores").querySelectorAll("[data-voto]").forEach((boton) =>
    boton.addEventListener("click", () => {
      const clave = boton.dataset.voto;
      const activo = votos.has(clave);
      activo ? votos.delete(clave) : votos.add(clave);
      boton.classList.toggle("pedir__opcion--activa", !activo);
      boton.setAttribute("aria-pressed", String(!activo));
    }));
}

el("abrirPedir").addEventListener("click", () => {
  const caja = el("cajaPedir");
  const abrir = caja.hidden;
  caja.hidden = !abrir;
  el("abrirPedir").setAttribute("aria-expanded", String(abrir));
  if (abrir && !el("opcionesIndicadores").children.length) cargarIndicadoresPropuestos();
});

el("btnEnviarPedido").addEventListener("click", async () => {
  const idea = el("ideaIndicador").value.trim();
  if (!votos.size && !idea) return;
  await apiFetch("/api/sugerencias", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ votos: [...votos], idea, banco: bancoDetectado }),
  });
  const gracias = el("graciasPedido");
  gracias.classList.add("pedir__gracias--visible");
  el("ideaIndicador").value = "";
  votos.clear();
  el("opcionesIndicadores").querySelectorAll("[data-voto]").forEach((b) => {
    b.classList.remove("pedir__opcion--activa");
    b.setAttribute("aria-pressed", "false");
  });
  setTimeout(() => {
    gracias.classList.remove("pedir__gracias--visible");
    el("cajaPedir").hidden = true;
    el("abrirPedir").setAttribute("aria-expanded", "false");
  }, 2200);
});

/* ------------------------------------------------- cuaderno de planes --- */
/*
  Panel lateral del simulador: qué incluye cada plan y un espacio para anotar
  qué debería subir o bajar de nivel. Las notas se guardan en el servidor
  (notas-planes.json) para que sobrevivan a recargas y reinicios.
*/

const panelPlanes = el("panelPlanes");

async function cargarPlanes() {
  const datos = await (await apiFetch("/api/planes")).json();
  el("listaPlanes").innerHTML = datos.planes.map((p) => `
    <article class="plan ${p.clave === datos.actual ? "plan--actual" : ""}" data-clave="${p.clave}">
      <div class="plan__fila">
        <span class="plan__nombre">${p.clave}</span>
        <span class="plan__precio">${p.precio} · ${p.limite === null ? "∞" : p.limite} doc/mes</span>
      </div>
      <ul class="plan__lista">${p.caracteristicas.map((c) => `<li>${c}</li>`).join("")}</ul>
      <div class="plan__acciones">
        <button type="button" class="plan__usar" data-usar="${p.clave}">
          ${p.clave === datos.actual ? "En uso" : "Ver como este usuario"}</button>
        <span class="plan__guardado" data-guardado="${p.clave}">guardado</span>
      </div>
      <textarea class="plan__nota" data-nota="${p.clave}"
                placeholder="Notas: ¿qué debería subir o bajar de este plan?">${p.nota}</textarea>
    </article>`).join("");

  el("listaPlanes").querySelectorAll("[data-usar]").forEach((boton) =>
    boton.addEventListener("click", async () => {
      await cambiarPlan(boton.dataset.usar);
      cargarPlanes();
    }));

  el("listaPlanes").querySelectorAll("[data-nota]").forEach((area) => {
    let espera;
    area.addEventListener("input", () => {
      clearTimeout(espera);
      espera = setTimeout(async () => {
        await apiFetch("/api/notas", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan: area.dataset.nota, nota: area.value }),
        });
        const aviso = el("listaPlanes").querySelector(`[data-guardado="${area.dataset.nota}"]`);
        aviso.classList.add("plan__guardado--visible");
        setTimeout(() => aviso.classList.remove("plan__guardado--visible"), 1200);
      }, 600);
    });
  });
}

function alternarPanel(abrir) {
  if (!panelPlanes) return;
  panelPlanes.classList.toggle("planes--abierto", abrir);
  el("abrirPlanes").setAttribute("aria-expanded", String(abrir));
  if (abrir) cargarPlanes();
}

// El cuaderno de planes es del simulador: en producción no se monta nada.
if (panelPlanes) {
  el("abrirPlanes").addEventListener("click", () =>
    alternarPanel(!panelPlanes.classList.contains("planes--abierto")));
  el("cerrarPlanes").addEventListener("click", () => alternarPanel(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") alternarPanel(false);
  });
}

/* --------------------------------------- errores y comentarios flotantes --- */
/*
  Los dos botones acompañan al usuario por toda la página: reportar un error
  no puede depender de encontrar una sección al fondo. Abrir uno cierra al
  otro; enviar agradece y el cuadro se cierra solo. Escape o un click fuera
  también cierran — es un apunte rápido, no un modal que secuestre la página.
*/
let calificacion = 0;

const FLOTANTES = [
  { boton: "btnFlotanteError", caja: "cajaFlotanteError" },
  { boton: "btnFlotanteComentario", caja: "cajaFlotanteComentario" },
];

function cerrarFlotantes() {
  FLOTANTES.forEach(({ boton, caja }) => {
    el(caja).hidden = true;
    el(boton).setAttribute("aria-expanded", "false");
  });
}

/*
  El botón de error se coloca bajo el borde REAL de la navbar. No basta con su
  altura: la barra del simulador la empuja hacia abajo mientras no hay scroll,
  y con una posición fija el botón se le montaba encima. Se recalcula al hacer
  scroll y al cambiar el tamaño, que es cuando ese borde se mueve.
*/
function ajustarTopeFlotante() {
  const navbar = document.querySelector(".navbar");
  if (!navbar) return;
  const borde = Math.max(0, navbar.getBoundingClientRect().bottom);
  document.documentElement.style.setProperty("--tope-flotante", `${borde}px`);
}

ajustarTopeFlotante();
window.addEventListener("scroll", ajustarTopeFlotante, { passive: true });
window.addEventListener("resize", ajustarTopeFlotante);

FLOTANTES.forEach(({ boton, caja }) => {
  el(boton).addEventListener("click", () => {
    const estabaAbierta = !el(caja).hidden;
    cerrarFlotantes();
    if (!estabaAbierta) {
      el(caja).hidden = false;
      el(boton).setAttribute("aria-expanded", "true");
      const campo = el(caja).querySelector("textarea");
      if (campo) campo.focus();
    }
  });
  el(caja).querySelector("[data-cerrar]").addEventListener("click", cerrarFlotantes);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") cerrarFlotantes();
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".flotante")) cerrarFlotantes();
});

el("estrellas").querySelectorAll(".estrella").forEach((estrella) => {
  estrella.addEventListener("click", () => {
    calificacion = Number(estrella.dataset.valor);
    el("estrellas").querySelectorAll(".estrella").forEach((otra) =>
      otra.classList.toggle("estrella--activa", Number(otra.dataset.valor) <= calificacion));
  });
});

async function enviarOpinion(tipo, descripcion) {
  await apiFetch("/api/feedback", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tipo, rating: calificacion, descripcion,
                           banco: bancoDetectado }),
  });
}

/* Agradece dentro del cuadro y lo cierra solo: "enviar y listo". */
function agradecerYCerrar(idCaja, idTexto) {
  const caja = el(idCaja);
  caja.querySelector(".flotante__gracias").hidden = false;
  setTimeout(() => {
    caja.querySelector(".flotante__gracias").hidden = true;
    el(idTexto).value = "";
    cerrarFlotantes();
  }, 1600);
}

el("btnEnviarError").addEventListener("click", async () => {
  const texto = el("textoError").value.trim();
  if (!texto) { el("textoError").focus(); return; }   // sin texto no hay reporte
  await enviarOpinion("error", texto);
  agradecerYCerrar("cajaFlotanteError", "textoError");
});

el("btnEnviarComentario").addEventListener("click", async () => {
  const texto = el("textoComentario").value.trim();
  // Vale mandar sólo estrellas, sólo texto, o ambos — pero algo debe traer.
  if (!texto && !calificacion) { el("textoComentario").focus(); return; }
  await enviarOpinion("comentario", texto);
  agradecerYCerrar("cajaFlotanteComentario", "textoComentario");
});

/* ---------------------------------------------------------------- inicio --- */
/*
  La página pregunta al servidor en qué plan está antes de que el usuario toque
  nada. Sin esto el selector de archivos arrancaba siempre en "uno solo",
  aunque el plan permitiera subir varios.
*/
(async function iniciar() {
  try {
    const { cuota } = await (await apiFetch("/api/cuota")).json();
    actualizarCuota(cuota);
  } catch (error) {
    /* sin conexión con el servidor: la página igual carga */
  }
})();

/* ------------------------------------------------- estrellas de fondo --- */
/*
  El mismo efecto del landing de taudux.com, con su MISMA configuración
  (copiada de home.js del sitio, no reinterpretada). Si el CDN no carga,
  la página funciona igual: es atmósfera, no funcionalidad.
*/
function cargarEstrellas() {
  if (!window.tsParticles) return;
  window.tsParticles.load("particulas-fondo", {
    fpsLimit: 30,
    fullScreen: { enable: false, zIndex: 0 },
    background: { color: { value: "transparent" } },
    particles: {
      number: { value: 120, density: { enable: true, width: 1920, height: 1080 } },
      color: { value: ["#00d7ff", "#1d63ff", "#c8f7ff"] },
      links: { enable: false },
      move: {
        enable: true, speed: { min: 0.12, max: 0.55 },
        direction: "none", random: true, straight: false,
        outModes: { default: "out" },
      },
      shape: { type: "circle" },
      shadow: { enable: true, blur: 3, color: { value: "#00d2ff" }, offset: { x: 0, y: 0 } },
      opacity: {
        value: { min: 0.12, max: 0.72 },
        animation: { enable: true, speed: 0.45, minimumValue: 0.08, sync: false },
      },
      size: {
        value: { min: 0.5, max: 2.1 },
        animation: { enable: true, speed: 0.8, minimumValue: 0.35, sync: false },
      },
    },
    interactivity: {
      events: { onHover: { enable: false }, onClick: { enable: false }, resize: true },
    },
    detectRetina: true,
  });
}

// Los scripts del CDN van con defer: puede que aún no existan al correr esto.
if (window.tsParticles) {
  cargarEstrellas();
} else {
  window.addEventListener("load", cargarEstrellas);
}

/*
  La cuota, al abrir la página.

  En el proyecto original este valor llegaba renderizado por el servidor
  (`{{ cuota.restantes }}` en la plantilla). Acá la página es estática y la sirve
  Vercel, así que hay que pedirlo: sin esto el contador se queda en su marcador
  de posición —"Te quedan — extracciones"— hasta que alguien procese algo, y los
  paneles que dependen del plan tampoco se configuran.

  Falla en silencio a propósito: no poder mostrar cuántas extracciones quedan no
  debe impedir usar la herramienta, y el servidor rechaza igual si no hay cuota.
*/
async function cargarCuotaInicial() {
  try {
    const respuesta = await apiFetch("/api/cuota");
    if (!respuesta.ok) return;
    const json = await respuesta.json();
    if (json.cuota) actualizarCuota(json.cuota);
  } catch (error) {
    console.warn("[extractor] no se pudo leer la cuota inicial:", error);
  }
}

cargarCuotaInicial();
