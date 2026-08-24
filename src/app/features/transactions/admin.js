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
    El control del techo mensual, que NO es siempre el mismo control.

    Sin techo que fijar es un "∞" de texto plano; con techo, un input. Son dos
    caminos distintos los que llegan al "∞":

      · `ilimitado` — la columna de `extractor_acceso`: administración o alta
        de pruebas. Gana sobre todo lo demás, incluida la bandera.
      · `!personalizado` — desde el 2026-08-21 el techo mensual es OPT-IN. Sin
        la bandera encendida el servidor devuelve `limite: null`, o sea sin
        tope, y el número del plan sobrevive sólo como semilla (`defecto`).

    Antes este segundo caso pintaba un input vacío con el 3 heredado en el
    `placeholder`. Hoy eso mentiría en la dirección más cara: haría creer que
    hay un tope donde no hay ninguno. Un input deshabilitado con un "∞" adentro
    tampoco sirve —es un control mintiendo sobre lo que se puede escribir—; el
    texto plano dice lo mismo sin prometer nada.

    Vive suelta y no dentro de `celdasFila` porque la usan DOS: el pintado
    inicial y `alternarPersonalizado()`, que al mover la bandera tiene que
    reemplazar el nodo entero. Si cada uno armara su markup, marcar y desmarcar
    la casilla terminaría dando una celda distinta de la que pintó el servidor.

    Los dos `title` no son uno solo con distinta redacción: "nadie le puso
    techo" y "tiene un permiso especial" son estados distintos, y sólo el
    primero se arregla marcando la casilla de al lado.
  */
  const CAMPOS = {
    limite: { etiqueta: "Cupo mensual", min: 0, max: 10000,
              queEs: "cupo mensual" },
    lote: { etiqueta: "PDF por envío", min: 1, max: 20,
            queEs: "tope por envío" },
  };

  function controlLimite(campo, datos, personalizado, valor) {
    const def = CAMPOS[campo];

    // `ilimitado` sólo habla del CUPO MENSUAL: es el override de
    // administración, y contesta "¿tiene cupo?" y no "¿cuántos por envío?".
    // Por eso no alcanza a `lote`.
    const sinTope = (datos.ilimitado && campo === "limite") || !personalizado;

    if (sinTope) {
      const motivo = datos.ilimitado && campo === "limite"
        ? "Esta cuenta tiene acceso ilimitado: el cupo mensual no se le aplica."
        : `Sin ${def.queEs}. Marca «Con límite» para ponerle uno.`;
      return `<span class="admin__numero admin__numero--infinito"
                    data-control="${campo}"
                    title="${escapar(motivo)}">∞</span>`;
    }
    return `<input class="field admin__numero" type="number" min="${def.min}"
                   max="${def.max}" step="1" inputmode="numeric"
                   data-control="${campo}" data-campo="${campo}"
                   aria-label="${escapar(def.etiqueta)}"
                   value="${escapar(valor)}"
                   placeholder="${escapar(numero(datos.defecto?.[campo], "∞"))}">`;
  }

  /*
    Las celdas de una fila, a partir de lo que dijo el servidor.

    `guardado` es lo que hay literalmente en `extractor_acceso`; `defecto` son
    los números del plan, que ya no rigen y sólo sirven de semilla. Con la
    bandera encendida los campos muestran lo guardado; con la bandera apagada
    no hay campos: hay dos "∞", porque no hay ningún número que mostrar.
  */
  function celdasFila(datos) {
    const personalizado = Boolean(datos.personalizado);
    const guardado = datos.guardado || {};

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

    return `
      <td class="admin__quien">
        <span class="admin__usuario">${escapar(datos.nombre)}</span>
        <span class="admin__meta">${escapar(datos.correo || "—")}</span>
      </td>
      <td>
        ${controlLimite("limite", datos, personalizado, limite)}
        <span class="admin__consumo">${escapar(consumo)}</span>
      </td>
      <td>
        ${controlLimite("lote", datos, personalizado, lote)}
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
    red. Encenderla los precarga —no los deja vacíos— por dos razones: es lo
    que la persona espera ver al empezar a editar, y una personalización sin
    `lote` la rechaza el servidor con 400 (`lote_requerido`).

    Lo que precarga cambió el 2026-08-21. Antes era "lo que HOY aplica"; hoy lo
    que aplica es SIN TOPE en los dos, y `null` no se tipea en un
    `<input type="number">`. Ver `semilla()` abajo.
  */
  function alternarPersonalizado(fila) {
    const datos = perfilesPorUid.get(fila.dataset.uid) || {};
    const guardado = datos.guardado || {};
    const defecto = datos.defecto || {};
    const encendido = Boolean(
      fila.querySelector('[data-campo="personalizado"]')?.checked);

    /*
      La SEMILLA ya no puede ser "lo que aplica hoy": lo que aplica es sin
      techo, y `null` no se tipea en un `<input type="number">`. Sale de lo
      guardado si esta fila ya tuvo un número propio —volver a marcar la
      casilla devuelve lo que había, no un default sorpresa— y del plan si
      nunca lo tuvo.

      Que el `lote` tenga semilla no es cosmético: el servidor rechaza con 400
      `lote_requerido` una personalización sin él.
    */
    const semilla = (propio, base) =>
      typeof propio === "number" ? propio : base;

    /*
      Los dos límites cambian de CONTROL, no de estado: apagados son un
      `<span>` con "∞" y encendidos un `<input>`. Por eso acá se reemplaza el
      nodo entero, que es lo que antes alcanzaba resolver moviendo un
      `disabled`.

      `data-control` existe justamente para esto: es el ancla que sobrevive al
      cambio de etiqueta. `data-campo` no serviría —sólo lo lleva el input,
      porque `firma()` y `guardarAcceso()` leen `.value` por ahí y un `<span>`
      no tiene—, y localizar la celda por su posición ataría este código al
      orden de las columnas.

      La fila con `ilimitado` conserva su "∞" en el techo mensual: ese permiso
      gana sobre la bandera, así que abrirle un campo ofrecería un número que
      no va a regir. `controlLimite()` ya lo contempla.
    */
    ["limite", "lote"].forEach((campo) => {
      const actual = fila.querySelector(`[data-control="${campo}"]`);
      if (!actual) return;
      actual.outerHTML = controlLimite(
        campo, datos, encendido,
        numero(semilla(guardado[campo], defecto[campo])));
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

    /*
      Sin la bandera encendida NINGUNO de los dos campos existe: son "∞" de
      texto, no inputs. Y con `ilimitado` tampoco existe el mensual. En todos
      esos casos se reenvía el número que ya estaba guardado en vez de un
      `null`, por dos razones:

        · Este endpoint escribe la fila ENTERA, no un update parcial: mandar
          `null` BORRA lo que hubiera, así que apagar la bandera perdería los
          números que alguien fijó a mano.
        · Es lo que hace cierto que desmarcar y volver a marcar la casilla
          devuelva lo que había, en vez de la semilla del plan — ver
          `alternarPersonalizado()`.

      El `lote` se sumó a este trato el 2026-08-21, cuando también se volvió
      opt-in. Hasta entonces su input existía siempre (deshabilitado), así que
      leerlo vacío daba `null` y nadie lo notaba: era el mismo borrado, sólo
      que sin consecuencia visible.
    */
    const guardado = datos.guardado || {};
    const conservar = (entrada, previo) =>
      entrada ? aEntero(entrada.value) : (previo ?? null);

    const limite = conservar(entradaLimite, guardado.limite);
    const lote = conservar(entradaLote, guardado.lote);

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

  // --- Desde dónde se usa --------------------------------------------------

  /*
    La clave con la que el SERVIDOR agrupa las extracciones cuya IP no bajó de
    país (`SIN_UBICACION` en app.py). Se repite acá porque atraviesa JSON, pero
    el nombre lo pone el servidor: si cambia allá y no acá, la fila deja de
    reconocerse y aparecería con su nombre crudo — feo, pero no silencioso.
  */
  const SIN_UBICACION = "sin_ubicacion";

  /*
    Barras horizontales por estado, ordenadas por volumen.

    POR QUÉ NO HAY LIBRERÍA DE GRÁFICOS. Son rectángulos con un ancho en
    porcentaje: traer una dependencia para dibujarlos sería sumar peso, un
    tercero y una superficie de actualización a cambio de nada. El día que
    haga falta un eje de tiempo o interacción, se reconsidera.

    POR QUÉ "SIN UBICACIÓN" VA APARTE Y NO SE ESCONDE. Medido contra la base
    GeoIP real, cerca de la mitad de las IPs no baja de país. Los dos errores
    posibles son opuestos y los dos mienten: descartar esas filas hace ver
    menos uso del que hubo, y mezclarlas con los estados inventa uno que no
    existe. Van visibles, al final, y en gris apagado para que no compitan con
    los estados reales.

    Y la proporción se calcula sobre el MÁXIMO, no sobre el total: con muchos
    estados, los porcentajes sobre el total dan barras de dos píxeles que no
    se comparan entre sí. Sobre el máximo, el mayor llena la fila y el resto
    se lee contra él.
  */
  function pintarRegiones(porRegion, periodo) {
    const caja = el("listaRegiones");
    if (!caja) return;

    siExisteMes(periodo);

    if (porRegion === null) {
      // El endpoint falló. La tabla de arriba ya avisa por su lado; acá se
      // dice que no se sabe, en vez de pintar un cero que se leería como
      // "nadie usó la herramienta".
      caja.innerHTML =
        '<p class="admin__vacio">No se pudo leer desde dónde se usa.</p>';
      return;
    }

    const entradas = Object.entries(porRegion);
    if (!entradas.length) {
      caja.innerHTML =
        '<p class="admin__vacio">Todavía no hay extracciones este mes.</p>';
      return;
    }

    /*
      El total de un estado SE SUMA de sus municipios; el servidor no manda un
      total aparte. Dos números para lo mismo pueden discrepar, y ésa es la
      clase de bug que no falla: sólo miente. Ver `_uso_todos_remoto()`.
    */
    const sumar = (municipios) =>
      Object.values(municipios).reduce((suma, n) => suma + n, 0);

    const totalDe = new Map(entradas.map(([estado, m]) => [estado, sumar(m)]));

    const total = [...totalDe.values()].reduce((suma, n) => suma + n, 0);
    const sinUbicar = totalDe.get(SIN_UBICACION) || 0;

    // Los estados reales, de mayor a menor; "sin ubicación" sale de la lista y
    // se agrega al final, para que no compita por el primer puesto.
    const estados = entradas
      .filter(([clave]) => clave !== SIN_UBICACION)
      .sort((a, b) => totalDe.get(b[0]) - totalDe.get(a[0]));

    // El máximo sale de los TOTALES de estado, no de los municipios sueltos:
    // así la barra del estado y la de su municipio más grande se leen en la
    // misma escala, que es lo que permite compararlas de un vistazo.
    const maximo = Math.max(1, ...totalDe.values());

    const barra = (etiqueta, cantidad, clases = "", nivel = "region") => `
      <li class="admin__${nivel}">
        <span class="admin__region-nombre">${escapar(etiqueta)}</span>
        <span class="admin__barra-pista">
          <span class="admin__barra ${clases}"
                style="width: ${Math.round((cantidad / maximo) * 100)}%"></span>
        </span>
        <span class="admin__region-conteo">${cantidad}</span>
      </li>`;

    /*
      Cada estado con sus municipios debajo, siempre visibles — sin clic.
      Estado y municipio resuelven SIEMPRE juntos (medido), así que ningún
      estado queda sin detalle.

      Un municipio bajo la clave `SIN_UBICACION` sólo aparece si el estado se
      supo y el municipio no: hoy no pasa, pero podría llegar de una base
      GeoIP vieja. Se muestra como "Sin municipio" para no repetir la etiqueta
      de la fila de abajo, que significa otra cosa.
    */
    const filas = estados.map(([estado, municipios]) => {
      const detalle = Object.entries(municipios)
        .sort((a, b) => b[1] - a[1])
        .map(([municipio, n]) => barra(
          municipio === SIN_UBICACION ? "Sin municipio" : municipio,
          n, "admin__barra--municipio", "municipio"))
        .join("");
      return barra(estado, totalDe.get(estado)) + detalle;
    }).join("");

    const cola = sinUbicar
      ? `<ul class="admin__regiones-lista admin__regiones-lista--cola">
           ${barra("Sin ubicación", sinUbicar, "admin__barra--sin-ubicar")}
         </ul>`
      : "";

    const porcentaje = total ? Math.round((sinUbicar / total) * 100) : 0;

    caja.innerHTML = `
      <ul class="admin__regiones-lista">${filas}</ul>
      ${cola}
      <p class="admin__consumo">
        ${total} ${total === 1 ? "extracción" : "extracciones"}${sinUbicar
          ? ` · ${sinUbicar} sin ubicar (${porcentaje}%)`
          : ""}
      </p>`;

    // Los DOS niveles: quien usa lector de pantalla no puede "ver" el ancho de
    // ninguna barra. Sin esto la sección entera es decorativa para esa persona.
    caja.querySelectorAll(".admin__region, .admin__municipio").forEach((fila) => {
      const nombre = fila.querySelector(".admin__region-nombre").textContent;
      const conteo = fila.querySelector(".admin__region-conteo").textContent;
      const pista = fila.querySelector(".admin__barra-pista");
      pista.setAttribute("role", "img");
      pista.setAttribute("aria-label", `${nombre}: ${conteo}`);
    });
  }

  function siExisteMes(periodo) {
    const nodo = el("mesRegiones");
    if (nodo) nodo.textContent = periodo ? `· ${periodo}` : "";
  }

  /*
    Los DOS agregados de región, del mismo viaje, guardados acá.

    El filtro de administración alterna entre ellos, y esa alternancia no puede
    costar una consulta: el servidor los calcula en el mismo recorrido y
    volver a pedirlos traería de nuevo la tabla entera de perfiles para
    redibujar unas barras que ya están en memoria.

    `sinAdmins` en `null` significa "este servidor no calcula el filtrado", que
    es distinto de "filtrado y no quedó nada". Por eso no se inicializa en `{}`.
  */
  const regionesEnCache = { todos: null, sinAdmins: null, periodo: "" };

  /*
    La casilla se REVELA, no se pinta siempre.

    Cloud Run puede estar sirviendo una versión anterior a este front: si su
    respuesta no trae el agregado filtrado, ofrecer el interruptor sería
    prometer un filtro que nadie calcula. Se marcaría, no cambiaría nada, y
    quien mire creería estar viendo el mapa sin las pruebas de administración.
  */
  function ofrecerFiltroAdmins(hayAgregadoFiltrado) {
    const caja = el("filtroAdminsCaja");
    if (caja) caja.hidden = !hayAgregadoFiltrado;
  }

  function repintarRegiones() {
    // `!== null` y no `Boolean(...)`: un mapa filtrado vacío es un dato —"sin
    // administración no hubo nada"— y con `Boolean` la casilla quedaría
    // marcada pintando el mapa COMPLETO, que es mentir en pantalla.
    const filtrar = Boolean(el("filtroAdmins")?.checked)
      && regionesEnCache.sinAdmins !== null;
    pintarRegiones(
      filtrar ? regionesEnCache.sinAdmins : regionesEnCache.todos,
      regionesEnCache.periodo);
  }

  function recordarRegiones(cuerpo) {
    regionesEnCache.todos = cuerpo.por_region || {};

    /*
      `|| null` NO sirve acá, y el motivo es sutil: `{}` es falsy para `||`.

      Un mapa filtrado VACÍO es un dato legítimo — significa "sin
      administración no hubo ninguna extracción este mes"— y con `||` se
      confundía con "este servidor no calcula el filtro". El resultado era que
      la casilla se escondía y el panel mostraba el mapa completo justo el mes
      en que el filtro más importa.

      Lo que hay que preguntar es si el campo VINO, no si tiene contenido.
    */
    const filtrado = cuerpo.por_region_sin_admins;
    regionesEnCache.sinAdmins = filtrado === undefined || filtrado === null
      ? null
      : filtrado;

    regionesEnCache.periodo = cuerpo.periodo || "";
    ofrecerFiltroAdmins(regionesEnCache.sinAdmins !== null);
    repintarRegiones();
  }

  function conectarFiltroAdmins() {
    const caja = el("filtroAdmins");
    if (caja) caja.addEventListener("change", repintarRegiones);
  }

  // --- Quién lo usa y cuánto -----------------------------------------------

  /*
    Las 24 horas son FIJAS, y ésa es toda la idea de la franja.

    Si se pintaran sólo las horas con uso, quien extrae de 9 a 11 y quien
    extrae de 19 a 21 tendrían tiras idénticas: tres celdas encendidas pegadas
    a la izquierda. La POSICIÓN dentro del día es el dato.
  */
  const HORAS_DEL_DIA = 24;

  /*
    La clave con la que el servidor agrupa a quien no tiene SESIÓN iniciada —no
    "cuenta": una fila con cuenta que no se logueó cae acá también, y llamarla
    "sin cuenta" mentiría sobre ella (F47). Mismo trato que `SIN_UBICACION`: el
    nombre lo pone el servidor y acá se repite porque atraviesa JSON.
  */
  const ANONIMOS = "anonimos";

  const totalHoras = (horas) => (Array.isArray(horas) ? horas : [])
    .reduce((suma, n) => suma + (n || 0), 0);

  /*
    La franja de un día.

    La intensidad la resuelve CSS (`--peso` + `color-mix`): acá sólo se calcula
    la proporción contra el máximo DE ESA PERSONA. Contra un máximo global, a
    quien extrae tres veces al mes se le vería la tira apagada entera y no se
    podría leer a qué hora la usa, que es justamente lo que la franja contesta.

    El `aria-label` no es un extra: quien usa lector de pantalla no puede "ver"
    la intensidad de ninguna celda, y sin él la sección entera es decorativa
    para esa persona — el mismo criterio que ya tienen las barras por estado.
  */
  function tiraHoraria(horas) {
    const cuentas = Array.isArray(horas) ? horas : [];
    const maximo = Math.max(1, ...cuentas.map((n) => n || 0));
    const total = totalHoras(cuentas);

    const celdas = Array.from({ length: HORAS_DEL_DIA }, (_, hora) => {
      const cuenta = cuentas[hora] || 0;
      const titulo = `${String(hora).padStart(2, "0")}:00 — ${cuenta} `
        + (cuenta === 1 ? "extracción" : "extracciones");
      return `<span class="admin__hora"
                    style="--peso: ${Math.round((cuenta / maximo) * 100)}"
                    title="${escapar(titulo)}"></span>`;
    }).join("");

    // El pico se busca sobre las cuentas reales, no sobre las 24 celdas: con
    // todo en cero `indexOf` devolvería 0 y anunciaría "mayor actividad a las
    // 00", que es una hora que nadie usó.
    const pico = total ? cuentas.indexOf(Math.max(...cuentas.map((n) => n || 0))) : -1;
    const resumen = pico === -1
      ? "Sin actividad este mes"
      : `Mayor actividad a las ${String(pico).padStart(2, "0")}:00`;

    return `
      <div class="admin__horas" role="img" aria-label="${escapar(resumen)}">
        ${celdas}
      </div>
      <div class="admin__horas-eje">
        <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
      </div>`;
  }

  /*
    De dónde extrajo esta persona.

    Con un solo estado va el nombre pelado; con varios, cada uno con su conteo
    — sin el número, dos estados se leerían como si pesaran igual.
  */
  function lugarDe(regiones) {
    const entradas = Object.entries(regiones || {})
      .sort((a, b) => b[1] - a[1]);
    if (!entradas.length) return "";

    const solo = entradas.length === 1;
    return entradas
      .map(([estado, n]) => {
        const nombre = estado === SIN_UBICACION ? "Sin ubicación" : estado;
        return solo ? nombre : `${nombre} ${n}`;
      })
      .join(" · ");
  }

  /*
    Una tarjeta.

    La identidad NO viene del endpoint de actividad: el agregado llega por uuid
    y el nombre y el correo ya viven en `perfilesPorUid`, leídos al pintar la
    tabla de arriba. Pintar la clave cruda mostraría un identificador que no le
    dice nada a nadie y que es, además, lo único que no debería salir a
    pantalla.

    Un uuid que no esté en el mapa es una cuenta que se dio de baja después de
    extraer. Se muestra como tal en vez de omitirla: borrar la fila haría ver
    menos uso del que hubo, el mismo error que "Sin ubicación" ya evita.
  */
  function tarjetaActividad(clave, datos) {
    const anonimo = clave === ANONIMOS;
    const perfil = anonimo ? null : perfilesPorUid.get(clave);
    const total = totalHoras(datos.horas);

    const nombre = anonimo
      ? "Sin sesión"
      : (perfil?.nombre || "(cuenta eliminada)");
    const meta = anonimo
      ? "identidad anónima, agrupada"
      : (perfil?.correo || "—");
    const esAdmin = Boolean(perfil?.esAdmin);
    // La fila anónima NO calcula ubicación: "Desde dónde se usa" ya la cuenta
    // por estado, y repetirla acá duplicaría esa sección en vez de aportar lo
    // que ésta ofrece — identidad y horario.
    const lugar = anonimo ? "" : lugarDe(datos.regiones);

    return `
      <li class="admin__actividad-fila${esAdmin ? " admin__actividad-fila--admin" : ""}">
        <div class="admin__actividad-cabeza">
          <div class="admin__quien">
            <span class="admin__usuario">${escapar(nombre)}${esAdmin
              ? ' <span class="admin__insignia">Admin</span>' : ""}</span>
            <span class="admin__meta">${escapar(meta)}</span>
          </div>
          <span class="admin__actividad-total">
            ${total} este mes
          </span>
        </div>
        ${lugar
          ? `<p class="admin__actividad-lugar">${escapar(lugar)}</p>`
          : ""}
        ${tiraHoraria(datos.horas)}
      </li>`;
  }

  /*
    La sección entera.

    Se revela sólo con datos: sin el agregado, un "todavía no hay extracciones"
    se leería como que nadie usó la herramienta, cuando lo cierto es que este
    servidor todavía no lo calcula. Son dos cosas distintas y sólo una es
    verdad.
  */
  function pintarActividad(actividad, periodo) {
    const caja = el("listaActividad");
    const bloque = el("seccionActividad");
    if (!caja || !bloque) return;

    if (!actividad) {
      bloque.hidden = true;
      return;
    }

    const nodoMes = el("mesActividad");
    if (nodoMes) nodoMes.textContent = periodo ? `· ${periodo}` : "";

    // Quien no usó la herramienta este mes no aparece — mismo criterio que el
    // mapa, donde tampoco hay filas en cero.
    const entradas = Object.entries(actividad)
      .filter(([, datos]) => totalHoras(datos?.horas) > 0);

    if (!entradas.length) {
      bloque.hidden = false;
      caja.innerHTML =
        '<p class="admin__vacio">Todavía no hay extracciones este mes.</p>';
      return;
    }

    // Las cuentas primero, por volumen; el grupo anónimo al final, como "Sin
    // ubicación" en el mapa: no compite por el primer puesto con quien sí
    // tiene identidad.
    const orden = entradas.sort((a, b) => {
      if (a[0] === ANONIMOS) return 1;
      if (b[0] === ANONIMOS) return -1;
      return totalHoras(b[1].horas) - totalHoras(a[1].horas);
    });

    bloque.hidden = false;
    caja.innerHTML = `<ul class="admin__actividad">
        ${orden.map(([clave, datos]) => tarjetaActividad(clave, datos)).join("")}
      </ul>`;
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
    /*
      La actividad se guarda y se pinta DESPUÉS, no acá.

      Sus tarjetas resuelven el nombre y el correo contra `perfilesPorUid`, que
      todavía no se llenó a esta altura: pintarlas ahora las dejaría a todas
      como "(cuenta eliminada)".
    */
    let actividad = null;
    try {
      const r = await apiFetch("/api/admin/perfiles");
      if (r.ok) {
        const cuerpo = await r.json();
        extra = cuerpo.perfiles || {};
        actividad = cuerpo.actividad || null;
        // Del MISMO viaje: el endpoint devuelve los agregados, así que ni el
        // mapa ni la actividad cuestan una consulta más. Se pintan acá y no en
        // su propia carga por eso.
        recordarRegiones(cuerpo);
      } else {
        console.warn("[admin] /api/admin/perfiles respondió", r.status);
        pintarRegiones(null);
      }
    } catch (error) {
      console.warn("[admin] no se pudo leer correo/consumo:", error);
      pintarRegiones(null);
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
        // El rol lo usa la sección de actividad para su insignia. Sale de
        // `perfiles` —la misma fuente que ya decide el acento de la tabla—, y
        // no de un campo del endpoint: dos fuentes para el rol fue F23.
        esAdmin: p.rol === "admin",
        conocido: Boolean(datos),
      });
    });

    lista.innerHTML = `
      <table class="admin__tabla">
        <thead>
          <tr>
            <th scope="col">Usuario</th>
            <th scope="col">Cupo mensual</th>
            <th scope="col">PDF por envío</th>
            <th scope="col">Con límite</th>
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

    // Recién ahora: `perfilesPorUid` ya tiene el nombre y el correo con los que
    // cada tarjeta resuelve su identidad.
    pintarActividad(actividad, regionesEnCache.periodo);
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
    conectarFiltroAdmins();
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
