/* Panel de administración del extractor: reparte accesos ilimitados y muestra
 * quién ha usado la herramienta.
 *
 * Portado del proyecto original con un cambio de fondo: allá la página vivía
 * detrás de un servidor que ya había comprobado quién entraba, así que el
 * JavaScript no verificaba nada. Servida por Vercel esa suposición se cae —
 * cualquiera puede pedir la URL—, así que acá el contenido se revela sólo
 * después de `asegurarAdmin()`, el mismo arranque que usan las pantallas de
 * administración de cursos.
 *
 * Depende de: admin-startup.js, api-cliente.js, auth.service.js, toast.js.
 */
(() => {
  "use strict";

  const el = (id) => document.getElementById(id);

  const escapar = (valor) => String(valor ?? "").replace(
    /[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c])
  );

  // --- Lista de usuarios ---------------------------------------------------

  async function cargarUsuarios() {
    const lista = el("listaUsuarios");

    let datos;
    try {
      const respuesta = await apiFetch("/api/admin/usuarios");
      if (!respuesta.ok) {
        // 403 acá significa que el servidor no reconoce el rol, aunque el
        // arranque sí lo haya hecho: son dos fuentes distintas y pueden
        // discrepar mientras exista F23.
        lista.innerHTML = '<p class="admin__vacio">El servicio no reconoce tu rol de administrador.</p>';
        return;
      }
      datos = await respuesta.json();
    } catch (error) {
      lista.innerHTML = '<p class="admin__vacio">No pudimos comunicarnos con el servicio.</p>';
      console.warn("[admin] fallo al listar usuarios:", error);
      return;
    }

    const { usuarios = [], mes } = datos;
    el("adminMes").textContent = mes ? `· consumo de ${mes}` : "";

    if (!usuarios.length) {
      lista.innerHTML = '<p class="admin__vacio">Todavía nadie ha usado la herramienta.</p>';
      return;
    }

    lista.innerHTML = usuarios.map((u) => `
      <div class="admin__fila${u.ilimitado ? " admin__fila--ilimitado" : ""}">
        <div class="admin__quien">
          <span class="admin__usuario">${escapar(u.usuario)}</span>
          <span class="admin__meta">
            ${u.anonimo ? "sin cuenta" : "con cuenta"}
            · ${u.usadas_mes} este mes (${u.usadas_total} en total)
            ${u.motivo ? `· ${escapar(u.motivo)}` : ""}
          </span>
        </div>
        ${u.es_admin
        ? '<span class="admin__insignia">admin</span>'
        : `<button type="button" class="admin__switch${u.ilimitado ? " admin__switch--on" : ""}"
                     data-usuario="${escapar(u.usuario)}" data-estado="${u.ilimitado}">
               ${u.ilimitado ? "Quitar acceso" : "Dar acceso"}
             </button>`}
      </div>`).join("");

    lista.querySelectorAll("[data-usuario]").forEach((boton) =>
      boton.addEventListener("click", () =>
        cambiarAcceso(boton.dataset.usuario, boton.dataset.estado !== "true", "")));
  }

  // --- Conceder y quitar ---------------------------------------------------

  async function cambiarAcceso(usuario, ilimitado, motivo) {
    const error = el("adminError");

    let respuesta;
    try {
      respuesta = await apiFetch("/api/admin/acceso", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario, ilimitado, motivo }),
      });
    } catch (fallo) {
      error.textContent = "No pudimos comunicarnos con el servicio.";
      error.hidden = false;
      console.warn("[admin] fallo al cambiar acceso:", fallo);
      return;
    }

    const json = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) {
      error.textContent = json.mensaje || "No se pudo aplicar el cambio.";
      error.hidden = false;
      return;
    }

    error.hidden = true;
    if (typeof mostrarToast === "function") {
      mostrarToast(ilimitado ? "Acceso concedido." : "Acceso retirado.", "success");
    }
    cargarUsuarios();
  }

  // --- Paneles internos ----------------------------------------------------

  // Eran enlaces a `/api/telemetria` y `/api/donaciones`, que abrían el JSON en
  // otra pestaña. Ya no sirve: esas rutas exigen el token y una pestaña nueva
  // no lo lleva. Se piden desde acá y se muestran en la misma página.
  async function verPanelInterno(ruta, etiqueta) {
    const destino = el("panelInterno");
    destino.hidden = false;
    destino.textContent = `Cargando ${etiqueta}…`;
    try {
      const respuesta = await apiFetch(ruta);
      const json = await respuesta.json();
      destino.textContent = JSON.stringify(json, null, 2);
    } catch (error) {
      destino.textContent = `No se pudo cargar ${etiqueta}.`;
      console.warn(`[admin] fallo al cargar ${ruta}:`, error);
    }
  }

  // --- Arranque ------------------------------------------------------------

  async function iniciar() {
    const arranque = crearArranqueAdmin({
      pagina: "extractor_admin",
      tituloError: "No se pudo abrir la administración del extractor",
    });

    // Nada del panel se revela antes de esto: `asegurarAdmin` exige sesión Y
    // rol. Quedarse en la sesión dejaría el panel abierto a cualquiera con
    // cuenta, que es justo lo que no puede pasar acá.
    const inicio = arranque.iniciarTiempo();
    if (!(await arranque.asegurarAdmin(inicio))) return;

    el("btnDarAcceso").addEventListener("click", async () => {
      const correo = el("adminCorreo").value.trim();
      if (!correo) { el("adminCorreo").focus(); return; }
      await cambiarAcceso(correo, true, el("adminMotivo").value.trim() || "pruebas");
      el("adminCorreo").value = "";
      el("adminMotivo").value = "";
    });

    el("adminCorreo").addEventListener("keydown", (evento) => {
      if (evento.key === "Enter") el("btnDarAcceso").click();
    });

    el("btnTelemetria").addEventListener(
      "click", () => verPanelInterno("/api/telemetria", "la telemetría"));
    el("btnDonaciones").addEventListener(
      "click", () => verPanelInterno("/api/donaciones", "las donaciones"));

    cargarUsuarios();
  }

  document.addEventListener("DOMContentLoaded", iniciar);
})();
