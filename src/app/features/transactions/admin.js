/* Panel de administración del extractor: lista las cuentas del sitio y fija
 * cuántos PDF puede procesar cada una.
 *
 * Portado del proyecto original con un cambio de fondo: allá la página vivía
 * detrás de un servidor que ya había comprobado quién entraba, así que el
 * JavaScript no verificaba nada. Servida por Vercel esa suposición se cae —
 * cualquiera puede pedir la URL—, así que acá el contenido se revela sólo
 * después de `asegurarAdmin()`, el mismo arranque que usan las pantallas de
 * administración de cursos.
 *
 * Traía además tres cosas que se quitaron el 2026-08-20, todas por el mismo
 * motivo: mostraban datos que no eran ciertos.
 *
 *   · El alta de accesos ilimitados no otorgaba nada — indexaba por
 *     `user:<correo>` cuando la identidad en producción es `user:<uuid>`
 *     (hallazgo F30).
 *   · El consumo del mes leía el estado en memoria de UNA instancia de Cloud
 *     Run: con `--max-instances 3` cada administrador veía otra cosa, y un
 *     reinicio lo borraba (hallazgo F25).
 *   · Los paneles internos volcaban el JSON crudo de esas mismas fuentes.
 *
 * `apiFetch` volvió el 2026-08-20 para leer (`GET /api/admin/perfiles`) y el
 * 2026-08-21 para escribir (`PUT /api/admin/acceso/<uid>`). Esto último NO
 * repite el error del alta borrada: aquella escribía contra `user:<correo>`,
 * una identidad que en producción no existe; ésta manda el uuid en la ruta,
 * que es la clave real de `extractor_acceso`, y el servidor resuelve la
 * herencia del plan y devuelve lo que quedó rigiendo.
 *
 * La columna Plan se fue el 2026-08-21 y en su lugar quedaron los dos números
 * que sí se pueden cambiar. Con un solo plan asignable —los de pago siguen
 * apagados en el catálogo— aquella columna repetía "free" en todas las filas.
 *
 * Depende de: admin-startup.js, auth.service.js, supabase-client.js,
 * api-cliente.js, toast.js.
 */
(() => {
  "use strict";

  const el = (id) => document.getElementById(id);

  const escapar = (valor) => String(valor ?? "").replace(
    /[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c])
  );

  /*
    Lo que el servidor dijo de cada fila, por uuid. Es la fuente de verdad del
    formulario: el DOM guarda lo que se está tipeando —que puede no haberse
    guardado nunca— y este mapa, lo último que el servidor confirmó. Repintar
    desde acá y no desde los campos es lo que hace que la tabla muestre lo que
    de verdad quedó, aunque el servidor haya recortado o heredado otra cosa.
  */
  const perfilesPorUid = new Map();

  /*
    Un candado POR UID, no uno global. Guardar una fila es una operación de una
    fila: bloquear la tabla entera mientras viaja le cobraría a todas las demás
    el trabajo de una, y con cinco cuentas o con cincuenta el costo es el mismo
    para quien está mirando otra fila.
  */
  const guardando = new Set();

  // `null`/`undefined` no son "0": el cero es un límite legítimo (suspender a
  // alguien sin tocarle el plan) y el vacío significa "sin techo".
  const numero = (valor, vacio = "") => (
    valor === null || valor === undefined ? vacio : String(valor));

  /*
    Texto → entero para el payload.

    `NaN` no puede viajar: `JSON.stringify` lo convierte en `null`, y `null` en
    este endpoint significa SIN TECHO. Un campo ilegible se guardaría como
    permiso ilimitado, que es el peor error posible en esta dirección, así que
    se devuelve `NaN` y quien llama frena antes de mandar nada.
  */
  function aEntero(valor) {
    const texto = String(valor ?? "").trim();
    if (texto === "") return null;
    const entero = Number(texto);
    return Number.isInteger(entero) ? entero : NaN;
  }

  // --- Una fila ------------------------------------------------------------

  /*
    Las celdas de una fila, a partir de lo que dijo el servidor.

    `guardado` es lo que hay literalmente en `extractor_acceso`; `efectivo` es
    lo que APLICA hoy, ya resuelta la herencia del plan. Los dos hacen falta:
    con la bandera encendida el campo muestra lo guardado, y con la bandera
    apagada el campo va vacío y lo efectivo baja a `placeholder` — así se lee
    de un vistazo que ese número lo pone el plan y no esta fila.
  */
  function celdasFila(datos) {
    const personalizado = Boolean(datos.personalizado);
    const efectivo = datos.efectivo || {};
    const guardado = datos.guardado || {};

    // Con la bandera apagada el servidor ignora los dos números. Dejarlos
    // escribibles invitaría a tipear un límite que no va a regir: la misma
    // clase de pantalla que se cree y miente que costó las cuatro secciones
    // borradas.
    const bloqueo = personalizado ? "" : "disabled";
    const limite = personalizado ? numero(guardado.limite) : "";
    const lote = personalizado ? numero(guardado.lote) : "";

    /*
      El endpoint no contestó por esta fila. No se sabe qué tiene guardado, y
      este PUT escribe la fila ENTERA: guardar a ciegas borraría justamente lo
      que no se pudo leer. Se muestra, no se edita.
    */
    const inerte = datos.conocido
      ? ""
      : ' disabled title="Sin respuesta de la API no se sabe qué límites' +
        ' tiene esta cuenta."';

    // Sin dato no se inventa un cero: "0 usados" y "no sé cuántos usó" son
    // cosas distintas y sólo una de las dos es cierta.
    const consumo = datos.usadas === null || datos.usadas === undefined
      ? "consumo sin datos"
      : `${datos.usadas} usado${datos.usadas === 1 ? "" : "s"} este mes`;

    /*
      Acceso ilimitado (administración o alta de pruebas): el techo mensual no
      se le aplica, así que no hay número que fijar. Un input deshabilitado con
      un "∞" adentro sería un control mintiendo sobre lo que se puede escribir;
      el texto plano dice lo mismo sin prometer nada. El `title` explica quién
      gana, porque si no el administrador tipearía un número inocuo.
    */
    const celdaLimite = datos.ilimitado
      ? `<span class="admin__numero admin__numero--infinito"
               title="Esta cuenta tiene acceso ilimitado: el techo mensual no se le aplica.">∞</span>`
      : `<input class="field admin__numero" type="number" min="0" max="10000" step="1"
                inputmode="numeric" data-campo="limite" aria-label="PDF al mes"
                value="${escapar(limite)}"
                placeholder="${escapar(numero(efectivo.limite, "∞"))}" ${bloqueo}>`;

    return `
      <td class="admin__quien">
        <span class="admin__usuario">${escapar(datos.nombre)}</span>
        <span class="admin__meta">${escapar(datos.correo || "—")}</span>
      </td>
      <td>
        ${celdaLimite}
        <span class="admin__consumo">${escapar(consumo)}</span>
      </td>
      <td>
        <input class="field admin__numero" type="number" min="1" max="20" step="1"
               inputmode="numeric" data-campo="lote" aria-label="PDF por envío"
               value="${escapar(lote)}"
               placeholder="${escapar(numero(efectivo.lote, "—"))}" ${bloqueo}>
      </td>
      <td>
        <input class="admin__toggle" type="checkbox" data-campo="personalizado"
               aria-label="Límites propios de esta cuenta"
               ${personalizado ? "checked" : ""}${inerte}>
      </td>
      <td>
        <button class="button button--outline admin__guardar" type="button" disabled>
          Guardar
        </button>
      </td>`;
  }

  /*
    Lo que hay AHORA en los controles de una fila, como texto comparable.

    El botón deshabilitado es el único indicador de "sin cambios" que tiene
    esta tabla, así que hace falta saber si algo se movió. Comparar contra una
    firma tomada del markup recién pintado —que sale de la respuesta del
    servidor— evita mantener una copia paralela de cada valor.
  */
  function firma(fila) {
    const marca = fila.querySelector('[data-campo="personalizado"]');
    const limite = fila.querySelector('[data-campo="limite"]');
    const lote = fila.querySelector('[data-campo="lote"]');
    return [
      marca ? String(marca.checked) : "",
      limite ? limite.value.trim() : "",
      lote ? lote.value.trim() : "",
    ].join("|");
  }

  function pintarFila(fila, datos) {
    fila.innerHTML = celdasFila(datos);
    fila.dataset.firma = firma(fila);
  }

  function refrescarGuardar(fila) {
    // Mientras la fila está en vuelo el botón lo gobierna `guardarAcceso`: que
    // un `input` tardío lo reactive dejaría mandar la misma fila dos veces.
    if (guardando.has(fila.dataset.uid)) return;
    const boton = fila.querySelector(".admin__guardar");
    if (boton) boton.disabled = firma(fila) === fila.dataset.firma;
  }

  /*
    La bandera no guarda sola: sólo abre o cierra los dos campos, acá y sin
    red. Encenderla precarga lo que HOY aplica —no deja los campos vacíos— por
    dos razones: es lo que la persona espera ver al empezar a editar, y una
    personalización sin `lote` la rechaza el servidor con 400 (`lote_requerido`).
  */
  function alternarPersonalizado(fila) {
    const datos = perfilesPorUid.get(fila.dataset.uid) || {};
    const efectivo = datos.efectivo || {};
    const encendido = Boolean(
      fila.querySelector('[data-campo="personalizado"]')?.checked);

    [["limite", efectivo.limite], ["lote", efectivo.lote]].forEach(
      ([campo, valorEfectivo]) => {
        // La fila con acceso ilimitado no tiene campo mensual que abrir.
        const entrada = fila.querySelector(`[data-campo="${campo}"]`);
        if (!entrada) return;
        entrada.disabled = !encendido;
        // Apagada: vacío, con el efectivo asomando en el `placeholder`.
        entrada.value = encendido ? numero(valorEfectivo) : "";
      });
  }

  // --- Guardar -------------------------------------------------------------

  /*
    Mezcla la respuesta del PUT con lo que ya se sabía de la fila.

    El endpoint gobierna la personalización y devuelve lo efectivo resuelto;
    el correo, el consumo del mes y el acceso ilimitado no los toca, así que
    se conservan. Nada de esto sale del DOM: si el servidor recortó el motivo o
    heredó otro lote, la tabla tiene que mostrar eso y no lo que se tipeó.
  */
  function fusionarRespuesta(previo, respuesta) {
    const acceso = respuesta.acceso || {};
    const efectivo = respuesta.efectivo || previo.efectivo || {};
    return {
      ...previo,
      personalizado: Boolean(acceso.personalizado),
      guardado: { limite: acceso.limite ?? null, lote: acceso.lote ?? null },
      efectivo: { limite: efectivo.limite ?? null, lote: efectivo.lote ?? null },
      motivo: acceso.motivo || "",
    };
  }

  async function guardarAcceso(fila) {
    const uid = fila.dataset.uid;
    if (guardando.has(uid)) return;

    const datos = perfilesPorUid.get(uid) || {};
    const entradaLimite = fila.querySelector('[data-campo="limite"]');
    const entradaLote = fila.querySelector('[data-campo="lote"]');
    const personalizado = Boolean(
      fila.querySelector('[data-campo="personalizado"]')?.checked);

    // La fila con acceso ilimitado no tiene campo mensual: se reenvía el número
    // que ya tenía guardado para que cambiarle el lote no le borre el techo de
    // paso — este endpoint escribe la fila entera, no un update parcial.
    const limite = entradaLimite
      ? aEntero(entradaLimite.value)
      : ((datos.guardado || {}).limite ?? null);
    const lote = aEntero(entradaLote ? entradaLote.value : "");

    if (Number.isNaN(limite) || Number.isNaN(lote)) {
      mostrarToast("Los límites tienen que ser números enteros.", "error");
      return;
    }
    // El servidor también lo rechaza, pero con un viaje de por medio: no hace
    // falta preguntar para saber que una personalización sin lote no se guarda.
    if (personalizado && lote === null) {
      mostrarToast("Con límites propios hay que decir cuántos PDF por envío.", "error");
      return;
    }

    guardando.add(uid);
    fila.setAttribute("aria-busy", "true");
    const boton = fila.querySelector(".admin__guardar");
    if (boton) {
      boton.disabled = true;
      boton.textContent = "Guardando…";
    }

    try {
      const r = await apiFetch(`/api/admin/acceso/${encodeURIComponent(uid)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personalizado,
          limite,
          lote,
          // El motivo se reenvía tal cual vino: la tabla no lo edita, y como
          // el endpoint escribe la fila entera, omitirlo lo borraría sin que
          // nadie lo haya pedido acá.
          motivo: datos.motivo || "",
        }),
      });
      const respuesta = await r.json().catch(() => ({}));

      if (!r.ok) {
        /*
          El servidor manda su propio `mensaje`, en español y explicando el
          rechazo (`lote_invalido`, `no_autorizado`, `auth_no_disponible`…).
          Reescribirlo acá sería mantener dos copias del mismo texto para que
          se contradigan; sólo se cubre el caso de que no venga ninguno.

          Y NO se repinta: lo tipeado se conserva para corregir y reintentar.
          Repintar acá borraría el trabajo de quien acaba de escribirlo.
        */
        mostrarToast(
          respuesta.mensaje || "No se pudieron guardar los límites.", "error");
        return;
      }

      perfilesPorUid.set(uid, fusionarRespuesta(datos, respuesta));
      pintarFila(fila, perfilesPorUid.get(uid));
      mostrarToast("Límites guardados.", "success");
    } catch (error) {
      console.warn("[admin] no se pudieron guardar los límites:", error);
      mostrarToast("No se pudieron guardar los límites.", "error");
    } finally {
      guardando.delete(uid);
      fila.removeAttribute("aria-busy");
      // Se busca de nuevo: si el guardado salió bien, `pintarFila` reemplazó el
      // botón anterior y aquel nodo ya no está en la página.
      const activo = fila.querySelector(".admin__guardar");
      if (activo) {
        activo.textContent = "Guardar";
        // Tras un éxito la firma coincide y queda deshabilitado; tras un error
        // sigue habiendo cambios pendientes y vuelve a estar disponible.
        activo.disabled = firma(fila) === fila.dataset.firma;
      }
    }
  }

  // --- Usuarios del sitio --------------------------------------------------

  /*
    Los usuarios REALES, leídos de `perfiles`. Están todos, hayan usado la
    herramienta o no, con el rol que de verdad tienen, y siguen ahí después de
    un reinicio: por eso es la única lista que sobrevivió a la limpieza del
    2026-08-20 — la de consumo salía de la memoria del servicio y se vaciaba
    cuando Cloud Run apagaba el contenedor.

    Se lee con la clave `anon` y el token de quien abre el panel: la policy
    `perfiles_select_admin` (migración 0031) decide si puede ver más que su
    propia fila. Sin ser administrador esto devuelve una sola fila, y eso es
    exactamente lo que tiene que pasar.

    El correo NO viene de acá, y no es un olvido: `perfiles` nunca tuvo esa
    columna, vive en `auth.users`, fuera del alcance de esta consulta. Baja
    aparte de `GET /api/admin/perfiles`, que sí puede leerlo porque corre con
    el service role en el servidor.
  */
  async function cargarUsuariosDelSitio() {
    const lista = el("listaPerfiles");

    const { data, error } = await supabaseClient
      .from("perfiles")
      .select("id, nombre, apellidos, rol, creado_en")
      .order("rol", { ascending: true })
      .order("creado_en", { ascending: false });

    if (error) {
      lista.innerHTML = '<p class="admin__vacio">No pudimos leer los perfiles.</p>';
      console.warn("[admin] fallo al leer perfiles:", error);
      return;
    }

    const perfiles = data || [];
    el("totalPerfiles").textContent = `· ${perfiles.length}`;

    if (!perfiles.length) {
      lista.innerHTML = '<p class="admin__vacio">No hay perfiles que mostrar.</p>';
      return;
    }

    // Correo, consumo y límites no salen de `perfiles`: los da este endpoint
    // admin-only, aparte. Si falla, la lista de nombres —ya resuelta arriba por
    // RLS— tiene que pintarse igual: `extra` se queda vacío y cada fila queda
    // visible pero sin editar, porque no se sabe qué tiene guardada.
    let extra = {};
    try {
      const r = await apiFetch("/api/admin/perfiles");
      if (r.ok) extra = (await r.json()).perfiles || {};
      else console.warn("[admin] /api/admin/perfiles respondió", r.status);
    } catch (error) {
      console.warn("[admin] no se pudo leer correo/consumo:", error);
    }

    // Administración primero: es lo que se busca al abrir esta lista.
    const orden = [...perfiles].sort(
      (a, b) => Number(b.rol === "admin") - Number(a.rol === "admin"));

    perfilesPorUid.clear();
    orden.forEach((p) => {
      const datos = extra[p.id];
      perfilesPorUid.set(p.id, {
        ...(datos || {}),
        // El nombre sale de `perfiles`; todo lo demás, del endpoint.
        nombre: [p.nombre, p.apellidos].filter(Boolean).join(" ").trim()
          || "(sin nombre)",
        conocido: Boolean(datos),
      });
    });

    lista.innerHTML = `
      <table class="admin__tabla">
        <thead>
          <tr>
            <th scope="col">Usuario</th>
            <th scope="col">PDF al mes</th>
            <th scope="col">PDF por envío</th>
            <th scope="col">Personalizado</th>
            <!-- Sin rótulo visible: la columna es un botón y su texto ya lo
                 dice. El nombre queda para quien navega por lectura de
                 pantalla, que sin él escucharía una columna anónima. -->
            <th scope="col"><span class="u-visually-hidden">Guardar cambios</span></th>
          </tr>
        </thead>
        <tbody>
          ${orden.map((p) => `
            <tr class="admin__fila${p.rol === "admin" ? " admin__fila--ilimitado" : ""}"
                data-uid="${escapar(p.id)}">
              ${celdasFila(perfilesPorUid.get(p.id))}
            </tr>`).join("")}
        </tbody>
      </table>`;

    // La firma de referencia se toma del markup recién pintado, que salió de lo
    // que dijo el servidor: contra ella se compara lo que se tipee después.
    lista.querySelectorAll(".admin__fila").forEach((fila) => {
      fila.dataset.firma = firma(fila);
    });
  }

  /*
    Un listener por evento en el contenedor, no uno por control.

    La tabla se pinta con `innerHTML` y una fila se repinta sola al guardar:
    colgar los listeners de cada input obligaría a re-atacharlos en cada
    repintado, y el que se olvidara dejaría controles mudos sin un solo error
    en consola. Por delegación, el markup puede regenerarse cuantas veces haga
    falta y los eventos siguen llegando.
  */
  function conectarTabla() {
    const lista = el("listaPerfiles");

    lista.addEventListener("click", (evento) => {
      const boton = evento.target.closest(".admin__guardar");
      const fila = boton && boton.closest("[data-uid]");
      if (fila) guardarAcceso(fila);
    });

    lista.addEventListener("change", (evento) => {
      const fila = evento.target.closest("[data-uid]");
      if (!fila) return;
      if (evento.target.matches('[data-campo="personalizado"]')) {
        alternarPersonalizado(fila);
      }
      refrescarGuardar(fila);
    });

    lista.addEventListener("input", (evento) => {
      const fila = evento.target.closest("[data-uid]");
      if (fila) refrescarGuardar(fila);
    });
  }

  // --- Arranque ------------------------------------------------------------

  async function iniciar() {
    const arranque = crearArranqueAdmin({
      pagina: "extractor_admin",
      tituloError: "No se pudo abrir la administración del extractor",
      // Sin esto vuelve al catálogo de cursos, que es el destino heredado de
      // las pantallas para las que se escribió este arranque. Quien intenta
      // abrir la administración del extractor sin permiso tiene que aterrizar
      // en el extractor, no en una lista de cursos que no pidió.
      rutaRechazo: "/app/features/transactions/",
    });

    // Nada del panel se revela antes de esto: `asegurarAdmin` exige sesión Y
    // rol. Quedarse en la sesión dejaría el panel abierto a cualquiera con
    // cuenta, que es justo lo que no puede pasar acá.
    const inicio = arranque.iniciarTiempo();
    if (!(await arranque.asegurarAdmin(inicio))) return;

    // `asegurarAdmin` COMPRUEBA, `revelar` MUESTRA. Son dos pasos y hay que dar
    // los dos: sin esta línea el rol se verifica correctamente, la consola no
    // dice nada, y la pantalla se queda con el loader girando para siempre —
    // porque nadie destapa el contenido. Las tres pantallas de cursos la
    // llaman; yo la había omitido.
    arranque.revelar();

    // Antes de pintar: los listeners cuelgan del contenedor, que ya existe en
    // el markup, así que registrarlos primero no depende de que haya filas.
    conectarTabla();
    cargarUsuariosDelSitio();
  }

  /*
    Se arranca YA, no en `DOMContentLoaded`.

    Este script va al final del `<body>`: cuando corre, el DOM ya está parseado
    y **ese evento probablemente ya disparó**. Registrar el listener entonces es
    esperar algo que no va a volver a ocurrir — `iniciar()` no se ejecutaba
    nunca, el gate no llegaba a correr, y el loader giraba para siempre sin un
    solo error en consola. Eso pasó el 2026-08-19 y costó encontrarlo justamente
    porque nada fallaba: simplemente no arrancaba.

    Es lo que hace `administrar-cursos.js`, del que salió este markup. El guard
    por `readyState` cubre además el caso de que alguien mueva el `<script>` al
    `<head>`, donde el DOM todavía no existiría.
  */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iniciar);
  } else {
    iniciar();
  }
})();
