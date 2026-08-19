/* Analiza un estado de cuenta enviándolo a la API del extractor.
 *
 * La pantalla la sirve Vercel; el Python corre aparte (ver `extractor/`). Acá
 * sólo viaja el PDF de ida y una tabla de movimientos de vuelta — el extractor
 * y sus reglas por banco nunca se entregan al navegador.
 */
(() => {
  "use strict";

  // Una sola dirección: el extractor corre en Cloud Run, también cuando la vista
  // se sirve desde Live Server. Así se prueba exactamente lo que va a producción
  // en vez de contra un Flask local que puede diferir.
  //
  // Cloud Run escala a cero: la primera petición tras un rato de inactividad
  // tarda unos segundos en levantar el contenedor (medido: ~3.8 s). No es un
  // fallo — ver "Cold Start" en el runbook de la capability.
  const API = "https://extractor-taudux-953578674176.northamerica-south1.run.app";

  const COLUMNAS = [
    { clave: "fecha_operacion", titulo: "Operación" },
    { clave: "fecha_cargo", titulo: "Cargo" },
    { clave: "descripcion", titulo: "Descripción", modificador: "descripcion" },
    { clave: "referencia", titulo: "Referencia" },
    { clave: "tipo", titulo: "Tipo" },
    { clave: "monto", titulo: "Monto", modificador: "monto" },
  ];

  const $ = (id) => document.getElementById(id);

  // --- Utilidades de presentación -----------------------------------------

  const escapar = (valor) => String(valor ?? "").replace(
    /[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c])
  );

  const dinero = (n) => Number.isFinite(n)
    ? n.toLocaleString("es-MX", { style: "currency", currency: "MXN" })
    : "—";

  // Las fechas llegan como texto desde pandas ("2026-01-05 00:00:00"): se
  // recorta la hora, que nunca aporta en un estado de cuenta.
  const fecha = (texto) => {
    const limpio = String(texto ?? "").trim();
    if (!limpio || limpio === "None" || limpio === "NaT") return "—";
    return limpio.slice(0, 10);
  };

  function registrar(mensaje) {
    const log = $("log");
    log.textContent += `${mensaje}\n`;
    log.scrollTop = log.scrollHeight;
  }

  function anunciar(mensaje) {
    $("startupMensaje").textContent = mensaje;
    $("startupVisible").textContent = mensaje;
  }

  // --- Arranque ------------------------------------------------------------

  // Ya no hay nada pesado que montar: se confirma que la API responde y que hay
  // sesión, para no descubrir ninguna de las dos cosas recién cuando alguien
  // ya eligió su archivo.
  async function arrancar() {
    $("startup").hidden = false;
    $("startup").classList.remove("transacciones__startup--error");
    $("startupError").hidden = true;
    $("startupLoader").hidden = false;
    $("startupVisible").hidden = false;
    $("necesitaSesion").hidden = true;
    $("contenido").hidden = true;
    anunciar("Cargando…");

    try {
      const respuesta = await fetch(`${API}/api/salud`, { method: "GET" });
      if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
      registrar(`API disponible en ${API}`);
    } catch (error) {
      registrar(`No se pudo contactar ${API}/api/salud — ${error.message}`);
      fallarArranque(
        "El servicio de análisis no está disponible en este momento. " +
          "Probá de nuevo en unos minutos."
      );
      return;
    }

    $("startup").setAttribute("aria-busy", "false");
    $("startup").hidden = true;

    // La API rechaza sin sesión, así que mostrar el campo de archivo sería
    // ofrecer algo que va a fallar. Mejor explicar por qué.
    const sesion = await obtenerSesionSegura();
    if (!sesion) {
      $("enlaceLogin").href = typeof urlLoginConDestino === "function"
        ? urlLoginConDestino(location.pathname)
        : "/app/features/auth/login.html";
      $("necesitaSesion").hidden = false;
      registrar("Sin sesión activa.");
      return;
    }

    $("contenido").hidden = false;
  }

  // auth.service.js puede no haber cargado (sin conexión, por ejemplo). Que eso
  // rompa la vista entera sería peor que tratarlo como "no hay sesión".
  async function obtenerSesionSegura() {
    if (typeof obtenerSesion !== "function") {
      registrar("auth.service.js no está disponible.");
      return null;
    }
    try {
      return await obtenerSesion();
    } catch (error) {
      registrar(`No se pudo leer la sesión — ${error.message}`);
      return null;
    }
  }

  function fallarArranque(mensaje) {
    const startup = $("startup");
    startup.classList.add("transacciones__startup--error");
    startup.setAttribute("aria-busy", "false");
    $("startupLoader").hidden = true;
    $("startupVisible").hidden = true;
    $("startupErrorMensaje").textContent = mensaje;
    $("startupError").hidden = false;
    startup.focus();
  }

  // --- Lectura del PDF -----------------------------------------------------

  function mostrarError(mensaje, detalle) {
    const caja = $("errorLectura");
    $("errorLecturaMensaje").textContent = mensaje;
    caja.hidden = false;
    caja.focus();
    if (detalle) registrar(String(detalle));
  }

  // El veredicto va a la consola del navegador, no a la pantalla: hoy sirve
  // para diagnosticar, no para que decida quien sube el archivo. El servidor lo
  // registra en paralelo en sus propios logs, sin importes.
  function informarValidacion(validacion) {
    if (!validacion) {
      console.info("[transacciones] el servidor no envió veredicto de validación");
      return;
    }

    // Tres desenlaces, no dos: `null` es "el PDF no traía totales de control",
    // que no es lo mismo que fallar. Confundirlos haría que un documento sin
    // totales pareciera un error de lectura.
    if (validacion.cuadra === null) {
      console.info("[transacciones] sin totales de control en el PDF: no hay contra qué cotejar");
      return;
    }

    if (validacion.cuadra) {
      console.info("[transacciones] los totales cuadran con el resumen del banco");
      return;
    }

    console.warn(`[transacciones] ${validacion.mensaje}`);
    (validacion.chequeos || [])
      .filter((chequeo) => !chequeo.ok)
      .forEach((chequeo) => {
        console.warn(
          `[transacciones]   ${chequeo.nombre}: esperado ${chequeo.esperado}, obtenido ${chequeo.obtenido}`
        );
      });

    if (typeof mostrarToast === "function") {
      mostrarToast("Los totales no cuadran con el resumen del banco.", "warning");
    }
  }

  function ocuparInput(ocupado) {
    $("archivo").disabled = ocupado;
    $("contenido").setAttribute("aria-busy", String(ocupado));
  }

  async function leerPdf(archivo) {
    $("errorLectura").hidden = true;
    $("resultado").hidden = true;
    ocuparInput(true);
    registrar(`Enviando ${archivo.name} (${(archivo.size / 1048576).toFixed(1)} MB)…`);

    const inicio = performance.now();

    try {
      // El token se relee acá, no al cargar la página: entre una cosa y otra
      // pueden pasar minutos y Supabase lo renueva en el medio.
      const sesion = await obtenerSesionSegura();
      if (!sesion) {
        mostrarError(
          "Tu sesión expiró. Iniciá sesión de nuevo para analizar el archivo."
        );
        arrancar();
        return;
      }

      const cuerpo = new FormData();
      cuerpo.append("archivo", archivo);

      const respuesta = await fetch(`${API}/api/extraer`, {
        method: "POST",
        headers: { Authorization: `Bearer ${sesion.access_token}` },
        body: cuerpo,
      });

      if (respuesta.status === 401) {
        mostrarError(
          "Tu sesión expiró. Iniciá sesión de nuevo para analizar el archivo."
        );
        arrancar();
        return;
      }

      // La API contesta con JSON también en los errores previstos (413, 422),
      // así que se lee el cuerpo antes de mirar el código.
      let datos;
      try {
        datos = await respuesta.json();
      } catch {
        throw new Error(`Respuesta no interpretable (HTTP ${respuesta.status})`);
      }

      if (!respuesta.ok || !datos.ok) {
        mostrarError(
          datos.error || "No pudimos procesar ese archivo.",
          `HTTP ${respuesta.status}`
        );
        return;
      }

      const filas = datos.filas || [];
      const ms = performance.now() - inicio;
      registrar(`${filas.length} movimientos en ${Math.round(ms)} ms`);

      if (!filas.length) {
        mostrarError(
          "El archivo se leyó, pero no encontramos movimientos. Revisá que sea " +
          "el estado de cuenta completo y no sólo una página."
        );
        return;
      }

      const suma = (tipo) => filas
        .filter((f) => String(f.tipo).toLowerCase() === tipo)
        .reduce((total, f) => total + (Number(f.monto) || 0), 0);

      $("datoFilas").textContent = filas.length;
      $("datoCargos").textContent = dinero(suma("cargo"));
      $("datoAbonos").textContent = dinero(suma("abono"));

      pintarTabla(filas);
      $("resultado").hidden = false;

      // El control del banco es el juez: si los totales que él mismo imprime
      // cuadran con lo extraído, la lectura fue correcta. La comparación la
      // hace el servidor y no acá, porque tiene reglas por banco que desde el
      // navegador no se ven — en crédito, por ejemplo, el TOTAL CARGOS impreso
      // excluye comisiones y anualidad, y compararlo de frente daría un
      // descuadre falso en cada tarjeta.
      informarValidacion(datos.validacion);

    } catch (error) {
      // Un fetch rechazado acá es red, CORS o servicio caído — nunca un PDF
      // ilegible, que la API contesta como 422 con su mensaje.
      mostrarError(
        "No pudimos comunicarnos con el servicio de análisis. Revisá tu conexión " +
        "y volvé a intentar.",
        error
      );
    } finally {
      ocuparInput(false);
    }
  }

  // --- Tabla ---------------------------------------------------------------

  function pintarTabla(filas) {
    const encabezado = COLUMNAS.map((c) => `<th scope="col">${escapar(c.titulo)}</th>`).join("");

    const cuerpo = filas.map((fila) => {
      const celdas = COLUMNAS.map((columna) => {
        const clase = columna.modificador ? ` class="transacciones__tabla td--${columna.modificador}"` : "";
        const valor = fila[columna.clave];

        if (columna.clave === "monto") return `<td${clase}>${escapar(dinero(Number(valor)))}</td>`;
        if (columna.clave.startsWith("fecha_")) return `<td${clase}>${escapar(fecha(valor))}</td>`;
        if (columna.clave === "tipo") {
          const tipo = String(valor ?? "").toLowerCase();
          const variante = tipo === "cargo" ? "cargo" : "abono";
          return `<td${clase}><span class="transacciones__tipo transacciones__tipo--${variante}">${escapar(valor)}</span></td>`;
        }
        return `<td${clase}>${escapar(valor || "—")}</td>`;
      }).join("");
      return `<tr>${celdas}</tr>`;
    }).join("");

    $("contenedorTabla").innerHTML =
      `<table class="transacciones__tabla"><thead><tr>${encabezado}</tr></thead><tbody>${cuerpo}</tbody></table>`;
  }

  // --- Cableado ------------------------------------------------------------

  $("archivo").addEventListener("change", (evento) => {
    const archivo = evento.target.files[0];
    if (archivo) leerPdf(archivo);
  });

  $("btnReintentar").addEventListener("click", arrancar);

  arrancar();
})();
