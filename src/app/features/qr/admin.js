/*
  Moderación de QR: todos los QR del sitio, quién los creó, y los dos frenos
  (bloquear un QR, bloquear una cuenta).

  Qué NO muestra: el correo de nadie. Vive en auth.users y este repositorio
  nunca lo ha entregado al navegador (0031); acá alcanza con el nombre del
  perfil. Si un caso de abuso necesita el correo, se consulta en el SQL Editor
  con el `usuario_id`, que sí se muestra.

  El destino se muestra como TEXTO, no como enlace: esta pantalla existe para
  revisar links sospechosos, y un clic distraído no debe abrir uno.

  Depende de: supabase-client.js, auth.service.js, telemetry/operaciones.js,
  toast.js, confirm-dialog.js, admin-startup.js y qr.nucleo.js.
*/
(() => {
  "use strict";

  const LIMITE_FILAS = 500;
  // `.in()` viaja en la URL: con cientos de uuid se pasa del largo que aceptan
  // los proxies. De a 100 queda holgado.
  const LOTE_IDS = 100;
  const SIN_MIGRACION = new Set(["PGRST205", "PGRST202", "42P01", "42883"]);

  const ETIQUETAS_ESTADO = Object.freeze({
    activo: "Activo",
    vencido: "Vencido",
    bloqueado: "Bloqueado",
    eliminado: "Eliminado",
  });
  const BLOQUEADO_POR = Object.freeze({
    administracion: "por administración",
    cuenta: "por bloqueo de la cuenta",
    revision_automatica: "por la revisión diaria de Google",
  });

  // Compacta a propósito: en una tabla de siete columnas, "28 sep 2026, 05:18
  // p.m." partía cada celda en cuatro renglones. El año sobra (los QR viven
  // días) y las 24 h ahorran el "p.m.".
  const fecha = new Intl.DateTimeFormat("es-MX", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const hora = new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit" });

  const el = (id) => document.getElementById(id);
  const estado = { qrs: [], perfiles: new Map(), accesos: new Map(), filtro: "todos", busqueda: "" };

  function estadoAdmin(qr, ahora) {
    return qr.eliminado_en ? "eliminado" : estadoQR(qr, ahora);
  }

  async function porLotes(ids, consulta) {
    const lotes = [];
    for (let i = 0; i < ids.length; i += LOTE_IDS) lotes.push(ids.slice(i, i + LOTE_IDS));
    const respuestas = await Promise.all(lotes.map(consulta));
    const error = respuestas.find((respuesta) => respuesta.error)?.error;
    if (error) throw error;
    return respuestas.flatMap((respuesta) => respuesta.data);
  }

  async function cargar() {
    const { data, error } = await supabaseClient
      .from("qr_codigos")
      .select("id,codigo,destino,titulo,usuario_id,dominio_confiable,web_risk_revisado_en,creado_en," +
        "vence_en,eliminado_en,eliminado_por,bloqueado_en,bloqueo_motivo,bloqueado_por,qr_escaneos(count)")
      .order("creado_en", { ascending: false })
      .range(0, LIMITE_FILAS - 1);
    if (error) throw error;

    const ids = [...new Set(data.map((qr) => qr.usuario_id))];
    const [perfiles, accesos] = await Promise.all([
      porLotes(ids, (lote) => supabaseClient.from("perfiles").select("id,nombre,apellidos").in("id", lote)),
      porLotes(ids, (lote) => supabaseClient.from("qr_acceso")
        .select("user_id,ilimitado,bloqueado,bloqueo_motivo").in("user_id", lote)),
    ]);

    estado.qrs = data.map(({ qr_escaneos: escaneos, ...qr }) => ({ ...qr, escaneos: escaneos?.[0]?.count ?? 0 }));
    estado.perfiles = new Map(perfiles.map((perfil) => [perfil.id, perfil]));
    estado.accesos = new Map(accesos.map((acceso) => [acceso.user_id, acceso]));

    el("qrAdminActualizado").textContent = `Actualizado a las ${hora.format(new Date())}`;
  }

  // --- Pintado ---------------------------------------------------------------

  function nombreDe(qr) {
    const perfil = estado.perfiles.get(qr.usuario_id);
    if (perfil) return [perfil.nombre, perfil.apellidos].filter(Boolean).join(" ") || "Sin nombre";
    return qr.eliminado_por === "cuenta_eliminada" ? "Cuenta eliminada" : "Sin perfil";
  }

  function coincide(qr) {
    const texto = estado.busqueda;
    if (!texto) return true;
    return [qr.codigo, qr.titulo, qr.destino, nombreDe(qr), qr.usuario_id]
      .some((valor) => String(valor ?? "").toLowerCase().includes(texto));
  }

  function nodo(etiqueta, texto, clase) {
    const elemento = document.createElement(etiqueta);
    if (texto !== undefined && texto !== null) elemento.textContent = texto;
    if (clase) elemento.className = clase;
    return elemento;
  }

  function celda(...hijos) {
    const td = document.createElement("td");
    td.append(...hijos.filter(Boolean));
    return td;
  }

  function secundario(texto) {
    return nodo("span", texto, "qr-admin__secundario");
  }

  function boton(texto, accion, datos) {
    const elemento = nodo("button", texto, "button button--outline");
    elemento.type = "button";
    elemento.dataset.accion = accion;
    Object.assign(elemento.dataset, datos);
    return elemento;
  }

  function celdaEstado(qr, estadoActual, ahora) {
    const detalle = [];
    if (estadoActual === "bloqueado") {
      detalle.push(`${BLOQUEADO_POR[qr.bloqueado_por] ?? ""}: ${qr.bloqueo_motivo}`);
    } else if (estadoActual === "eliminado") {
      detalle.push(qr.eliminado_por === "cuenta_eliminada" ? "al borrarse la cuenta" : "por su dueño");
    } else {
      detalle.push(tiempoRestanteQR(qr.vence_en, ahora).texto);
    }
    detalle.push(`Creado ${fecha.format(new Date(qr.creado_en))}`);
    return celda(nodo("strong", ETIQUETAS_ESTADO[estadoActual]), ...detalle.map(secundario));
  }

  function fila(qr, ahora) {
    const estadoActual = estadoAdmin(qr, ahora);
    const acceso = estado.accesos.get(qr.usuario_id);
    const tienePerfil = estado.perfiles.has(qr.usuario_id);
    const tr = document.createElement("tr");

    const destino = nodo("span", qr.destino, "qr-admin__destino");
    destino.title = qr.destino;

    const cuenta = [];
    if (acceso?.bloqueado) cuenta.push(secundario(`Cuenta bloqueada: ${acceso.bloqueo_motivo}`));
    if (acceso?.ilimitado) cuenta.push(secundario("Acceso ilimitado"));
    // El id completo es lo que se busca en el SQL Editor cuando hace falta el
    // correo; en la tabla basta el inicio, y el botón lo copia entero.
    const id = boton(`ID ${qr.usuario_id.slice(0, 8)}…`, "copiar-id", { usuario: qr.usuario_id });
    id.className = "qr-admin__id";
    id.title = `Copiar ${qr.usuario_id}`;
    cuenta.push(id);

    const revision = qr.dominio_confiable ? "Lista confiable" : "Otro dominio";
    const webRisk = qr.web_risk_revisado_en
      ? `Web Risk: ${fecha.format(new Date(qr.web_risk_revisado_en))}`
      : "Sin revisar en Web Risk";

    const acciones = nodo("div", null, "qr-admin__acciones");
    if (estadoActual !== "eliminado") {
      acciones.append(estadoActual === "bloqueado"
        ? boton("Desbloquear QR", "desbloquear-qr", { id: qr.id })
        : boton("Bloquear QR", "bloquear-qr", { id: qr.id }));
    }
    if (tienePerfil) {
      acciones.append(acceso?.bloqueado
        ? boton("Desbloquear cuenta", "desbloquear-cuenta", { usuario: qr.usuario_id })
        : boton("Bloquear cuenta", "bloquear-cuenta", { usuario: qr.usuario_id }));
    }

    tr.append(
      celda(nodo("strong", urlVisibleQR(qr.codigo)), secundario(qr.titulo || "Sin nombre")),
      celda(destino),
      celda(nodo("span", nombreDe(qr)), ...cuenta),
      celdaEstado(qr, estadoActual, ahora),
      celda(nodo("span", String(qr.escaneos))),
      celda(nodo("span", revision), secundario(webRisk)),
      celda(acciones),
    );
    return tr;
  }

  function pintar() {
    const ahora = Date.now();
    const visibles = estado.qrs
      .filter((qr) => estado.filtro === "todos" || estadoAdmin(qr, ahora) === estado.filtro)
      .filter(coincide);
    el("qrAdminFilas").replaceChildren(...visibles.map((qr) => fila(qr, ahora)));
    el("qrAdminVacio").hidden = visibles.length > 0;

    const cuenta = (valor) => estado.qrs.filter((qr) => estadoAdmin(qr, ahora) === valor).length;
    const tope = estado.qrs.length === LIMITE_FILAS ? ` (los ${LIMITE_FILAS} más recientes)` : "";
    el("qrAdminResumen").textContent =
      `${estado.qrs.length} QR${tope} · ${cuenta("activo")} activos · ${cuenta("bloqueado")} bloqueados`;
  }

  // --- Motivo --------------------------------------------------------------

  /* Pide el motivo de un bloqueo. Resuelve con el texto, o null si se cancela. */
  function pedirMotivo({ titulo, descripcion, confirmar, sugerido = "" }) {
    const dialogo = el("qrMotivoDialogo");
    const formulario = el("qrMotivoFormulario");
    const texto = el("qrMotivoTexto");
    const error = el("qrMotivoError");
    el("qrMotivoTitulo").textContent = titulo;
    el("qrMotivoDescripcion").textContent = descripcion;
    el("qrMotivoConfirmar").textContent = confirmar;
    texto.value = sugerido;
    error.hidden = true;

    return new Promise((resolver) => {
      const terminar = (valor) => {
        formulario.removeEventListener("submit", alEnviar);
        el("qrMotivoCancelar").removeEventListener("click", alCancelar);
        dialogo.removeEventListener("cancel", alCancelar);
        if (dialogo.open) dialogo.close();
        resolver(valor);
      };
      const alEnviar = (evento) => {
        evento.preventDefault();
        const motivo = texto.value.trim();
        if (!motivo) {
          error.hidden = false;
          texto.focus();
          return;
        }
        terminar(motivo);
      };
      const alCancelar = (evento) => {
        evento?.preventDefault();
        terminar(null);
      };
      formulario.addEventListener("submit", alEnviar);
      el("qrMotivoCancelar").addEventListener("click", alCancelar);
      dialogo.addEventListener("cancel", alCancelar);
      dialogo.showModal();
      texto.focus();
    });
  }

  // --- Acciones --------------------------------------------------------------

  async function moderarQR(qr, bloquear) {
    let motivo = null;
    if (bloquear) {
      motivo = await pedirMotivo({
        titulo: "Bloquear QR",
        descripcion: `${urlVisibleQR(qr.codigo)} dejará de redirigir de inmediato. Su dueño verá el motivo.`,
        confirmar: "Bloquear QR",
      });
      if (!motivo) return;
    } else {
      const confirmado = await confirmarConTexto({
        titulo: "Desbloquear QR",
        mensaje: `${urlVisibleQR(qr.codigo)} volverá a llevar a ${qr.destino}.`,
        etiquetaConfirmar: "Desbloquear",
      });
      if (!confirmado) return;
    }
    const { error } = await supabaseClient.rpc("qr_moderar", { p_id: qr.id, p_bloquear: bloquear, p_motivo: motivo });
    if (error) throw error;
    await cargar();
    pintar();
    mostrarToast(bloquear ? "QR bloqueado." : "QR desbloqueado.");
  }

  async function moderarCuenta(usuarioId, bloquear) {
    const nombre = nombreDe({ usuario_id: usuarioId });
    let motivo = null;
    if (bloquear) {
      motivo = await pedirMotivo({
        titulo: `Bloquear la cuenta de ${nombre}`,
        descripcion: "Todos sus QR dejarán de funcionar y no podrá crear más. Verá el motivo.",
        confirmar: "Bloquear cuenta",
      });
      if (!motivo) return;
    } else {
      const confirmado = await confirmarConTexto({
        titulo: `Desbloquear la cuenta de ${nombre}`,
        mensaje: "Podrá volver a crear QR, y los que se apagaron por el bloqueo de la cuenta vuelven a funcionar. Los que se bloquearon uno por uno siguen bloqueados.",
        etiquetaConfirmar: "Desbloquear",
      });
      if (!confirmado) return;
    }
    const { data, error } = await supabaseClient.rpc("qr_moderar_cuenta", {
      p_usuario: usuarioId,
      p_bloquear: bloquear,
      p_motivo: motivo,
    });
    if (error) throw error;
    await cargar();
    pintar();
    mostrarToast(bloquear
      ? `Cuenta bloqueada. QR apagados: ${data}.`
      : `Cuenta desbloqueada. QR restaurados: ${data}.`);
  }

  async function alHacerClick(evento) {
    const objetivo = evento.target.closest("[data-accion]");
    if (!objetivo) return;
    const { accion, id, usuario } = objetivo.dataset;
    const qr = estado.qrs.find((otro) => String(otro.id) === id);
    objetivo.disabled = true;
    try {
      if (accion === "copiar-id") {
        await navigator.clipboard.writeText(usuario);
        mostrarToast("ID de la cuenta copiado.");
      }
      if (accion === "bloquear-qr" && qr) await moderarQR(qr, true);
      if (accion === "desbloquear-qr" && qr) await moderarQR(qr, false);
      if (accion === "bloquear-cuenta") await moderarCuenta(usuario, true);
      if (accion === "desbloquear-cuenta") await moderarCuenta(usuario, false);
    } catch (error) {
      console.error(error);
      mostrarToast("No se pudo aplicar el cambio. Intenta de nuevo.", "error");
    } finally {
      objetivo.disabled = false;
    }
  }

  function conectar() {
    el("qrAdminFiltro").addEventListener("change", (evento) => {
      estado.filtro = evento.target.value;
      pintar();
    });
    el("qrAdminBuscar").addEventListener("input", (evento) => {
      estado.busqueda = evento.target.value.trim().toLowerCase();
      pintar();
    });
    el("qrAdminRecargar").addEventListener("click", async (evento) => {
      evento.currentTarget.disabled = true;
      try {
        await cargar();
        pintar();
      } catch (error) {
        console.error(error);
        mostrarToast("No se pudo actualizar la lista.", "error");
      } finally {
        el("qrAdminRecargar").disabled = false;
      }
    });
    el("qrAdminFilas").addEventListener("click", alHacerClick);
  }

  // --- Arranque ------------------------------------------------------------

  async function iniciar() {
    const arranque = crearArranqueAdmin({
      pagina: "qr_admin",
      tituloError: "No se pudo abrir la moderación de QR",
      rutaRechazo: "/app/features/qr/",
    });
    const inicio = arranque.iniciarTiempo();
    if (!(await arranque.asegurarAdmin(inicio))) return;

    try {
      await cargar();
    } catch (error) {
      arranque.reportarFallo("qr_admin_carga", error, inicio, "load_failed");
      arranque.mostrarError(SIN_MIGRACION.has(error?.code)
        ? "Falta aplicar la migración 0044_qr_codigos en Supabase."
        : "No pudimos cargar los QR. Revisa tu conexión y vuelve a intentarlo.");
      return;
    }
    arranque.revelar();
    conectar();
    pintar();
  }

  // Al final del <body>: el DOM ya está; no se espera DOMContentLoaded.
  iniciar();
})();
