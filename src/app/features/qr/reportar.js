/*
  Reportar un QR: público, sin cuenta. Manda el reporte a qr_reportar() (0046),
  que valida el código y el motivo y pone techos contra el spam; esta página
  sólo evita mandar lo que se ve a simple vista que está mal.

  Depende de: supabase-client.js, auth.service.js y qr.nucleo.js.
*/
(() => {
  "use strict";

  const el = (id) => document.getElementById(id);

  function error(mensaje) {
    const aviso = el("qrReporteError");
    aviso.textContent = mensaje;
    aviso.hidden = !mensaje;
  }

  async function enviar(evento) {
    evento.preventDefault();
    error("");

    // La trampa llena = un bot. Se muestra el "gracias" y no se manda nada:
    // decirle que falló sólo le enseña a esquivarla.
    if (el("qrReporteSitio").value) {
      mostrarGracias();
      return;
    }

    const codigo = codigoDeTextoQR(el("qrReporteCodigo").value);
    const motivo = el("qrReporteMotivo").value;
    if (!codigo) {
      error(mensajeReporteQR("sin_codigo"));
      el("qrReporteCodigo").focus();
      return;
    }
    if (!motivo) {
      error(mensajeReporteQR("sin_motivo"));
      el("qrReporteMotivo").focus();
      return;
    }

    const boton = el("qrReporteEnviar");
    const textoOriginal = boton.textContent;
    boton.disabled = true;
    boton.textContent = boton.dataset.loadingText;
    try {
      const { error: fallo } = await supabaseClient.rpc("qr_reportar", {
        p_codigo: codigo,
        p_motivo: motivo,
        p_detalle: el("qrReporteDetalle").value.trim() || null,
        p_contacto: el("qrReporteContacto").value.trim() || null,
      });
      if (fallo) {
        error(mensajeReporteQR(fallo.message));
        return;
      }
      mostrarGracias();
    } catch (excepcion) {
      console.error(excepcion);
      error(mensajeReporteQR());
    } finally {
      boton.disabled = false;
      boton.textContent = textoOriginal;
    }
  }

  function mostrarGracias() {
    el("qrReporteFormulario").hidden = true;
    el("qrReporteGracias").hidden = false;
    el("qrReporteGracias").focus();
  }

  // ?codigo= lo ponen los enlaces de go.taudux.com.
  const inicial = codigoDeTextoQR(new URLSearchParams(window.location.search).get("codigo"));
  if (inicial) el("qrReporteCodigo").value = `go.taudux.com/${inicial}`;
  el("qrReporteFormulario").addEventListener("submit", enviar);
})();
