/*
  Usuarios (Administración): cuántas cuentas hay, cuántas entran y cuántas se
  van en cada periodo, y quién es cada una.

  Nombres, roles y la gráfica salen de Supabase directo: los administradores
  ya leen `perfiles` (0031) y `eventos_negocio`. El correo NO está ahí —vive
  en auth.users, que el navegador no puede leer— y lo trae el servidor del
  extractor (`GET /api/admin/perfiles`, admin-only), el mismo que lo pone en
  «Gestión del extractor». Llega aparte y después: si ese servidor no
  contesta, la lista se ve igual con «—».

  Altas y bajas salen del registro de eventos (que no se borra al eliminar una
  cuenta); la lógica de periodos y de la línea está en usuarios.nucleo.js.

  Depende de: supabase-client.js, auth.service.js, telemetry/operaciones.js,
  admin-startup.js, transactions/api-cliente.js y usuarios.nucleo.js.
*/
(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const TIPOS_EVENTO = ["alta_confirmada", "baja_cuenta"];
  // PostgREST entrega a lo sumo 1000 filas por consulta: se pide por tandas.
  const TANDA_EVENTOS = 1000;
  const NOMBRES_NIVEL = Object.freeze({
    semana: "semana", mes: "mes", trimestre: "trimestre", anio: "año",
  });

  // Medidas del dibujo, en unidades del viewBox.
  const ANCHO = 640;
  const ALTO = 300;
  const MARGEN = { izquierda: 12, derecha: 40, arriba: 10, abajo: 30 };
  const AIRE_ETIQUETA = 16; // lo que ocupa «+N» / «−N» arriba y abajo de las barras

  // Con hora: el 25 sep 2026 se registraron siete cuentas, y sólo con el día
  // la lista parecía desordenada aunque va de la más reciente a la más vieja.
  const fechaRegistro = new Intl.DateTimeFormat("es-MX", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });

  const el = (id) => document.getElementById(id);
  const estado = {
    eventos: [],
    perfiles: [],
    correos: null, // { uid: { correo, … } } del servidor del extractor; null = aún no llega
    nivel: 0, // índice en NIVELES_USUARIOS: arranca en semana y no se guarda
    pagina: 0,
    periodos: [],
  };

  // --- Datos ---------------------------------------------------------------

  async function leerEventos() {
    const todos = [];
    for (let desde = 0; ; desde += TANDA_EVENTOS) {
      const { data, error } = await supabaseClient
        .from("eventos_negocio")
        .select("tipo,ocurrido_en")
        .in("tipo", TIPOS_EVENTO)
        .order("ocurrido_en", { ascending: true })
        .range(desde, desde + TANDA_EVENTOS - 1);
      if (error) throw error;
      todos.push(...data);
      if (data.length < TANDA_EVENTOS) return todos;
    }
  }

  // --- Gráfica -------------------------------------------------------------

  function svg(nombre, atributos = {}, texto) {
    const nodo = document.createElementNS(SVG_NS, nombre);
    for (const [clave, valor] of Object.entries(atributos)) nodo.setAttribute(clave, String(valor));
    if (texto !== undefined) nodo.textContent = texto;
    return nodo;
  }

  function nivelActual() {
    return NIVELES_USUARIOS[estado.nivel];
  }

  function ocultarTooltip() {
    el("usuariosTooltip").hidden = true;
    el("usuariosLienzo").querySelectorAll("[data-activa]").forEach((columna) => {
      columna.removeAttribute("data-activa");
    });
  }

  function mostrarTooltip(indice, columna) {
    const periodo = estado.periodos[indice];
    if (!periodo) return;
    el("usuariosLienzo").querySelectorAll("[data-activa]").forEach((otra) => {
      otra.removeAttribute("data-activa");
    });
    columna.setAttribute("data-activa", "");

    const detalle = detallePeriodo(periodo, nivelActual());
    const caja = el("usuariosTooltip");
    const fila = (clase, etiqueta, valor) => {
      const p = document.createElement("p");
      p.className = `usuarios__tooltip-fila usuarios__tooltip-fila--${clase}`;
      const texto = document.createElement("span");
      texto.textContent = etiqueta;
      const dato = document.createElement("strong");
      dato.textContent = valor;
      p.append(texto, dato);
      return p;
    };
    const titulo = document.createElement("p");
    titulo.className = "usuarios__tooltip-titulo";
    titulo.textContent = detalle.titulo;
    caja.replaceChildren(
      titulo,
      fila("altas", "Cuentas nuevas", detalle.nuevas),
      fila("bajas", "Eliminadas", detalle.eliminadas),
      fila("balance", "Balance", detalle.balance),
      fila("linea", "Cuentas al cierre", detalle.cierre),
    );
    caja.hidden = false;

    // Junto a la columna, sin salirse de la caja: en la mitad derecha va a la
    // izquierda de la columna (el último periodo no tiene espacio a su lado).
    const marco = el("usuariosGrafica").getBoundingClientRect();
    const celda = columna.getBoundingClientRect();
    const centro = celda.left - marco.left + celda.width / 2;
    const ancho = caja.offsetWidth;
    const aDerecha = centro < marco.width * 0.55;
    const izquierda = aDerecha ? centro + celda.width / 2 + 6 : centro - celda.width / 2 - ancho - 6;
    caja.style.insetInlineStart = `${Math.max(0, Math.min(izquierda, marco.width - ancho))}px`;
    caja.style.insetBlockStart = "0.5rem";
  }

  function pintarGrafica() {
    const nivel = nivelActual();
    const lienzo = el("usuariosLienzo");
    ocultarTooltip();

    el("usuariosGraficaTitulo").textContent = `Registros por ${NOMBRES_NIVEL[nivel]}`;
    el("usuariosAlejar").disabled = estado.nivel === NIVELES_USUARIOS.length - 1;
    el("usuariosAcercar").disabled = estado.nivel === 0;

    const periodos = registrosPorPeriodo(estado.eventos, estado.perfiles.length, nivel, new Date());
    estado.periodos = periodos;

    const maxAltas = Math.max(1, ...periodos.map((p) => p.altas));
    const maxBajas = Math.max(0, ...periodos.map((p) => p.bajas));
    const maxTotal = Math.max(1, ...periodos.map((p) => p.total));

    const x0 = MARGEN.izquierda;
    const ancho = ANCHO - MARGEN.izquierda - MARGEN.derecha;
    const arriba = MARGEN.arriba + AIRE_ETIQUETA;
    const abajo = ALTO - MARGEN.abajo - AIRE_ETIQUETA;
    const alto = abajo - arriba;
    // El eje cero reparte el alto entre lo que sube y lo que baja.
    const y0 = arriba + alto * (maxAltas / (maxAltas + maxBajas));
    const unidad = alto / (maxAltas + maxBajas);
    const paso = ancho / periodos.length;
    const anchoBarra = Math.min(paso * 0.55, 36);
    const centroDe = (i) => x0 + paso * i + paso / 2;
    const yTotal = (total) => abajo - (total / maxTotal) * alto;

    const dibujo = svg("svg", {
      class: "usuarios__svg",
      viewBox: `0 0 ${ANCHO} ${ALTO}`,
      role: "group",
      "aria-label": `Registros por ${NOMBRES_NIVEL[nivel]}`,
    });

    dibujo.append(svg("line", { class: "usuarios__eje", x1: x0, x2: x0 + ancho, y1: y0, y2: y0 }));

    // Eje derecho: las cuentas al cierre (0, mitad y máximo).
    const marcas = [...new Set([0, Math.round(maxTotal / 2), maxTotal])];
    for (const marca of marcas) {
      const y = yTotal(marca);
      dibujo.append(
        svg("line", { class: "usuarios__guia", x1: x0, x2: x0 + ancho, y1: y, y2: y }),
        svg("text", { class: "usuarios__texto usuarios__texto--linea", x: x0 + ancho + 6, y: y + 4 }, String(marca)),
      );
    }

    const cadaCuantas = Math.ceil(periodos.length / 10);
    periodos.forEach((periodo, i) => {
      const centro = centroDe(i);
      if (periodo.altas) {
        const alturaBarra = periodo.altas * unidad;
        dibujo.append(
          svg("rect", {
            class: "usuarios__barra--altas", x: centro - anchoBarra / 2, y: y0 - alturaBarra,
            width: anchoBarra, height: alturaBarra, rx: 2,
          }),
          svg("text", {
            class: "usuarios__texto usuarios__texto--altas", x: centro, y: y0 - alturaBarra - 4,
            "text-anchor": "middle",
          }, `+${periodo.altas}`),
        );
      }
      if (periodo.bajas) {
        const alturaBarra = periodo.bajas * unidad;
        dibujo.append(
          svg("rect", {
            class: "usuarios__barra--bajas", x: centro - anchoBarra / 2, y: y0,
            width: anchoBarra, height: alturaBarra, rx: 2,
          }),
          svg("text", {
            class: "usuarios__texto usuarios__texto--bajas", x: centro, y: y0 + alturaBarra + 12,
            "text-anchor": "middle",
          }, `−${periodo.bajas}`),
        );
      }
      if (i % cadaCuantas === 0) {
        dibujo.append(svg("text", {
          class: "usuarios__texto", x: centro, y: ALTO - 8, "text-anchor": "middle",
        }, periodo.etiqueta));
      }
    });

    const puntos = periodos.map((periodo, i) => `${centroDe(i)},${yTotal(periodo.total)}`);
    dibujo.append(svg("polyline", { class: "usuarios__linea", points: puntos.join(" ") }));
    periodos.forEach((periodo, i) => {
      dibujo.append(svg("circle", { class: "usuarios__punto", cx: centroDe(i), cy: yTotal(periodo.total), r: 3 }));
    });

    // Una columna transparente de alto completo por periodo: objetivo de
    // puntero, de foco y de lector de pantalla.
    periodos.forEach((periodo, i) => {
      const columna = svg("rect", {
        class: "usuarios__columna",
        x: x0 + paso * i, y: MARGEN.arriba, width: paso, height: ALTO - MARGEN.arriba - MARGEN.abajo + 8,
        tabindex: 0,
        role: "img",
        "aria-label": detallePeriodo(periodo, nivel).aria,
      });
      columna.addEventListener("pointerenter", (evento) => {
        if (evento.pointerType === "mouse") mostrarTooltip(i, columna);
      });
      columna.addEventListener("pointerleave", (evento) => {
        if (evento.pointerType === "mouse" && document.activeElement !== columna) ocultarTooltip();
      });
      columna.addEventListener("focus", () => mostrarTooltip(i, columna));
      columna.addEventListener("blur", ocultarTooltip);
      // Tocar en celular: el clic enfoca la columna y la deja abierta.
      columna.addEventListener("click", () => mostrarTooltip(i, columna));
      dibujo.append(columna);
    });

    lienzo.replaceChildren(dibujo);
  }

  function mostrarFalloGrafica() {
    el("usuariosLienzo").innerHTML = '<p class="usuarios__vacio">No pudimos leer los registros.</p>';
    el("usuariosAlejar").disabled = true;
    el("usuariosAcercar").disabled = true;
  }

  // --- Lista ---------------------------------------------------------------

  function nombreDe(perfil) {
    return [perfil.nombre, perfil.apellidos].filter(Boolean).join(" ").trim() || "(sin nombre)";
  }

  function correoDe(uid) {
    return estado.correos?.[uid]?.correo || "—";
  }

  /*
    El correo llega del servidor del extractor, no de Supabase, y se pide DESPUÉS
    de pintar la lista: esperarlo dejaría la página en blanco mientras Cloud Run
    arranca. Al llegar se rellenan las celdas que ya están; si no llega, se
    quedan en «—» y nada más se rompe.
  */
  async function cargarCorreos() {
    try {
      const r = await apiFetch("/api/admin/perfiles");
      if (!r.ok) {
        console.warn("[usuarios] /api/admin/perfiles respondió", r.status);
        return;
      }
      const cuerpo = await r.json();
      estado.correos = cuerpo.perfiles || {};
    } catch (fallo) {
      console.warn("[usuarios] no se pudieron leer los correos:", fallo);
      return;
    }
    for (const fila of el("usuariosLista").querySelectorAll(".usuarios__fila")) {
      const celda = fila.querySelector(".usuarios__correo");
      if (celda) celda.textContent = correoDe(fila.dataset.uid);
    }
  }

  function celdaTexto(clase, ...hijos) {
    const td = document.createElement("td");
    if (clase) td.className = clase;
    td.append(...hijos);
    return td;
  }

  function pintarLista() {
    const lista = el("usuariosLista");
    if (!estado.perfiles.length) {
      el("usuariosPaginacion").hidden = true;
      lista.innerHTML = '<p class="usuarios__vacio">No hay cuentas que mostrar.</p>';
      return;
    }

    const tabla = document.createElement("table");
    tabla.className = "usuarios__tabla";
    tabla.innerHTML = `
      <thead>
        <tr>
          <th scope="col">Usuario</th>
          <th scope="col">Rol</th>
          <th scope="col">Registro</th>
        </tr>
      </thead>`;
    const cuerpo = document.createElement("tbody");
    for (const perfil of estado.perfiles) {
      const fila = document.createElement("tr");
      fila.className = "usuarios__fila";
      fila.dataset.uid = perfil.id;

      const rol = document.createElement("td");
      if (perfil.rol === "admin") {
        // Sin margen propio de la insignia: va sola en su celda.
        const insignia = document.createElement("span");
        insignia.className = "admin-insignia usuarios__insignia";
        insignia.textContent = "Admin";
        rol.append(insignia);
      } else if (perfil.es_colaborador) {
        // En azul: se distingue de «Usuario» sin competir con la insignia Admin.
        const colaborador = document.createElement("span");
        colaborador.className = "usuarios__rol-colaborador";
        colaborador.textContent = "Colaborador";
        rol.append(colaborador);
      } else {
        rol.textContent = "Usuario";
      }

      const nombre = document.createElement("span");
      nombre.className = "usuarios__nombre";
      nombre.textContent = nombreDe(perfil);
      const correo = document.createElement("span");
      correo.className = "usuarios__correo";
      correo.textContent = correoDe(perfil.id);
      fila.append(
        celdaTexto("", nombre, correo),
        rol,
        celdaTexto("usuarios__fecha", perfil.creado_en ? fechaRegistro.format(new Date(perfil.creado_en)) : "—"),
      );
      cuerpo.append(fila);
    }
    tabla.append(cuerpo);
    lista.replaceChildren(tabla);
    aplicarPagina();
  }

  // Las filas se pintan TODAS y sólo se esconden las que no tocan, como en la
  // tabla del extractor.
  function aplicarPagina() {
    const filas = [...el("usuariosLista").querySelectorAll(".usuarios__fila")];
    const pie = el("usuariosPaginacion");
    const rango = rangoDePaginaUsuarios(filas.length, estado.pagina, FILAS_POR_PAGINA_USUARIOS);
    estado.pagina = rango.pagina;
    filas.forEach((fila, i) => {
      fila.hidden = i < rango.desde - 1 || i >= rango.hasta;
    });

    if (rango.totalPaginas <= 1) {
      pie.hidden = true;
      pie.innerHTML = "";
      return;
    }
    pie.hidden = false;
    pie.innerHTML = `
      <p class="usuarios__paginacion-texto" role="status" aria-live="polite">
        Cuentas ${rango.desde}–${rango.hasta} de ${filas.length} · página ${rango.pagina + 1} de ${rango.totalPaginas}
      </p>
      <div class="usuarios__paginacion-botones">
        <button type="button" class="button button--outline" data-pagina="anterior"
                ${rango.pagina === 0 ? "disabled" : ""}>‹ Anterior</button>
        <button type="button" class="button button--outline" data-pagina="siguiente"
                ${rango.pagina === rango.totalPaginas - 1 ? "disabled" : ""}>Siguiente ›</button>
      </div>`;
  }

  // --- Arranque ------------------------------------------------------------

  function conectar() {
    el("usuariosAlejar").addEventListener("click", () => {
      if (estado.nivel < NIVELES_USUARIOS.length - 1) estado.nivel += 1;
      pintarGrafica();
    });
    el("usuariosAcercar").addEventListener("click", () => {
      if (estado.nivel > 0) estado.nivel -= 1;
      pintarGrafica();
    });
    document.addEventListener("keydown", (evento) => {
      if (evento.key === "Escape") ocultarTooltip();
    });

    // El pie se repinta en cada cambio de página: por delegación.
    el("usuariosPaginacion").addEventListener("click", (evento) => {
      const boton = evento.target.closest("[data-pagina]");
      if (!boton || boton.disabled) return;
      estado.pagina += boton.dataset.pagina === "siguiente" ? 1 : -1;
      aplicarPagina();
      // El botón pulsado se reemplazó: el foco vuelve al mismo lado.
      const pie = el("usuariosPaginacion");
      (pie.querySelector(`[data-pagina="${boton.dataset.pagina}"]:not(:disabled)`)
        || pie.querySelector("[data-pagina]:not(:disabled)"))?.focus();
    });
  }

  async function cargar() {
    const { data, error } = await supabaseClient
      .from("perfiles")
      .select("id,nombre,apellidos,rol,creado_en,es_colaborador")
      .order("creado_en", { ascending: false });
    if (error) {
      console.warn("[usuarios] fallo al leer perfiles:", error);
      el("usuariosLista").innerHTML = '<p class="usuarios__vacio">No pudimos leer las cuentas.</p>';
      el("usuariosPaginacion").hidden = true;
      mostrarFalloGrafica();
      return;
    }
    estado.perfiles = data || [];
    el("usuariosTotal").textContent = `· ${estado.perfiles.length}`;
    pintarLista();
    // Sin await: el correo llega cuando llegue y no detiene la gráfica.
    cargarCorreos();

    try {
      estado.eventos = await leerEventos();
    } catch (fallo) {
      console.warn("[usuarios] fallo al leer eventos:", fallo);
      mostrarFalloGrafica();
      return;
    }
    pintarGrafica();
  }

  async function iniciar() {
    const arranque = crearArranqueAdmin({
      pagina: "usuarios_admin",
      tituloError: "No se pudo abrir la página de usuarios",
      rutaRechazo: "/",
    });
    const inicio = arranque.iniciarTiempo();
    if (!(await arranque.asegurarAdmin(inicio))) return;
    arranque.revelar();
    conectar();
    await cargar();
  }

  // Al final del <body>: el DOM ya está; no se espera DOMContentLoaded.
  iniciar();
})();
