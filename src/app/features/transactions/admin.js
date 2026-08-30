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

  // --- El filtro de administración -----------------------------------------

  /*
    UN SOLO LUGAR DECIDE SI SE ESTÁ FILTRANDO.

    El estado se leía del DOM adentro de la sección geográfica, que era la única
    que lo consultaba. Ahora lo consultan tres, y tres lecturas sueltas del DOM
    es exactamente como se desincronizan: la lección del bug de 58 contra 7, en
    el que un control correcto alimentaba a un pintor que nadie veía.

    Se lee `aria-checked` y no una variable propia porque el atributo ES el
    estado: un lector de pantalla anuncia eso, y guardar una copia al lado abre
    la puerta a que las dos digan cosas distintas.
  */
  function excluyendoAdmins() {
    return el("filtroAdmins")?.getAttribute("aria-checked") === "true";
  }

  /*
    Los agregados que las secciones filtrables necesitan para REpintarse.

    Sin esto, alternar el interruptor obligaría a volver a pedir
    `/api/admin/perfiles` — la tabla entera de perfiles otra vez, para redibujar
    unos gráficos cuyos datos ya están en memoria. El mapa geográfico guarda los
    suyos aparte, en `regionesEnCache`.

    `porDiaSinAdmins` en `null` significa "este servidor no lo calcula", que es
    distinto de "filtrado y no quedó nada". Por eso no arranca en `{}`.
  */
  const panelEnCache = {
    porDia: null,
    permanencia: null,
    metricaBanco: null,
    porDiaSinAdmins: null,
    periodo: "",
  };

  /*
    El interruptor se REVELA, no se pinta siempre. Mismo criterio que el resto
    de los controles de esta pantalla: ofrecer uno inerte es prometer algo que
    no pasa, y esta pantalla ya perdió cuatro secciones por prometer de más.
  */
  function ofrecerFiltroAdmins(hayAlgoQueFiltrar) {
    const caja = el("filtroAdminsCaja");
    if (caja) caja.hidden = !hayAlgoQueFiltrar;
  }

  /*
    Las TRES secciones que el interruptor gobierna, repintadas juntas.

    La tabla de cuentas NO está acá y es deliberado: los gráficos miden uso, la
    tabla administra cuentas. Filtrarla escondería la fila de quien esté mirando
    y con ella el botón de editar sus propios límites.

    Eran TRES hasta el 2026-08-28: también estaba "Quién lo usa y cuánto", que
    se retiró entera por mostrar un perfil de uso por persona.
  */
  function repintarTodo() {
    pintarRegiones();
    pintarSerie();
    // Entró el 2026-08-29, cuando la `0035` le dio a `extractor_visita` la
    // columna `es_admin`. Hasta entonces esta sección no podía filtrarse y lo
    // declaraba en pantalla.
    pintarPermanencia();
  }

  /*
    Los agregados de las dos secciones que no son el mapa, del mismo viaje.

    `por_dia_sin_admins` puede no venir —Cloud Run puede estar sirviendo una
    versión anterior a este front— y ahí `null` significa "este servidor no lo
    calcula". La serie lo distingue de "filtrado y no quedó nada" y avisa en
    pantalla en vez de callarse.
  */
  function recordarPanel(cuerpo) {
    /*
      `cuerpo.actividad` se ignora a propósito. El servidor lo sigue mandando
      —sacarlo de ahí cuesta un deploy y es lo que falta—, pero nada del front
      lo lee desde que "Quién lo usa y cuánto" se retiró: guardarlo dejaría en
      memoria del navegador un perfil por persona que ninguna pantalla usa.
    */
    panelEnCache.porDia = cuerpo.por_dia || null;

    // El agregado trae su gemelo filtrado ANIDADO (`permanencia.sin_admins`),
    // así que no necesita una entrada aparte en esta caché como sí la necesitan
    // las otras dos secciones: guardarlo entero conserva los dos juntos y evita
    // que puedan quedar desapareados.
    panelEnCache.permanencia = cuerpo.permanencia || null;

    // Ésta NO tiene gemelo filtrado, y es la excepción a propósito: mide si el
    // software funciona, no cuánto se usa, así que el interruptor no la
    // gobierna. Se guarda entera porque no hay un segundo agregado que aparear.
    panelEnCache.metricaBanco = cuerpo.metrica_banco || null;

    const filtrado = cuerpo.por_dia_sin_admins;
    panelEnCache.porDiaSinAdmins = filtrado === undefined || filtrado === null
      ? null
      : filtrado;

    panelEnCache.periodo = cuerpo.periodo || "";
  }

  function conectarFiltroAdmins() {
    const boton = el("filtroAdmins");
    if (!boton) return;
    boton.addEventListener("click", () => {
      boton.setAttribute("aria-checked", String(!excluyendoAdmins()));
      repintarTodo();
    });
  }

  // --- Distribución geográfica ---------------------------------------------

  /*
    La clave con la que el SERVIDOR agrupa las extracciones cuya IP no bajó de
    país (`SIN_UBICACION` en app.py). Se repite acá porque atraviesa JSON, pero
    el nombre lo pone el servidor: si cambia allá y no acá, la fila deja de
    reconocerse y aparecería con su nombre crudo — feo, pero no silencioso.
  */
  const SIN_UBICACION = "sin_ubicacion";

  /*
    Cuántos estados se ven antes de "ver los N restantes". "Sin ubicación" no
    entra en la cuenta: va aparte y siempre visible.
  */
  const CORTE_ESTADOS = 5;

  /*
    UNA SOLA VISTA, Y POR QUÉ IMPORTA.

    Hasta el 2026-08-27 esta sección tenía DOS contenedores para el mismo dato:
    las barras por estado y las columnas apiladas por municipio, que se
    excluían a mano con `hidden`. Esa duplicación mentía en pantalla.

    Medido en Chrome: con "Excluir a los administradores" MARCADA el panel
    decía 58 extracciones cuando las reales sin administración eran 7. El
    filtro funcionaba perfecto —alternaba 58 ↔ 7, sin un error en consola—
    sobre el contenedor que la otra vista dejaba oculto. Un bug que no falla:
    sólo miente, y por eso ninguna suite lo atrapó.

    Ahora hay UN pintor y UN contenedor. No pueden desincronizarse.

    POR QUÉ NO HAY LIBRERÍA DE GRÁFICOS. Son rectángulos con un ancho en
    porcentaje: traer una dependencia para dibujarlos sería sumar peso, un
    tercero y una superficie de actualización a cambio de nada. Y el CSP
    desplegado el 2026-08-23 sólo admite scripts de `cdn.jsdelivr.net` y
    `googletagmanager.com`, así que exigiría además tocar `vercel.json`.

    POR QUÉ "SIN UBICACIÓN" VA APARTE. Medido contra la base GeoIP real, cerca
    de la mitad de las IPs no baja de país. Los errores posibles son TRES y los
    tres mienten: descartar esas filas hace ver menos uso del que hubo;
    mezclarlas con los estados inventa uno que no existe; y dejarlas competir
    por el corte de 5 empuja fuera a un estado real.

    Y el ancho se calcula sobre el MÁXIMO, no sobre el total: con muchos
    estados, los porcentajes sobre el total dan barras de dos píxeles que no se
    comparan entre sí. Sobre el máximo, el mayor llena la fila y el resto se
    lee contra él.
  */

  /*
    El estado de la vista vive acá y NO en el DOM, porque el markup se regenera
    entero con `innerHTML` en cada repintado: leerlo del DOM lo perdería en
    cuanto el filtro de administración vuelva a pintar.
  */
  const vistaRegiones = {
    /*
      Qué se está midiendo: `total`, `cuenta` (con sesión) o `anon` (sin ella).

      Son las MISMAS claves que trae cada fila, así que `fila[medida]` da el
      valor activo sin ninguna tabla de traducción en el medio — y sin una
      segunda variable que pueda discrepar de la primera.

      Antes esto se llamaba `orden` y sólo reordenaba la lista. Contra los datos
      reales —2 estados— reordenar no movía una sola fila: tocar "Con sesión" no
      cambiaba nada, y un control inerte es lo que esta pantalla tiene escrito
      tres veces que no se hace. Ahora la pestaña elige la medida y el orden
      sale de ella, así que un solo control hace las dos cosas.
    */
    medida: "total",
    busqueda: "",
    abiertos: new Set(),
    verTodo: false,
  };

  /*
    Sin acentos y en minúsculas, para que "queretaro" encuentre "Querétaro".
    `NFD` separa la letra de su tilde y el rango ̀-ͯ borra la tilde.
  */
  const plano = (texto) =>
    String(texto).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  function siExisteMes(periodo) {
    const nodo = el("mesRegiones");
    if (nodo) nodo.textContent = periodo ? `· ${periodo}` : "";
  }

  /*
    Los agregados de región, del mismo viaje, guardados acá.

    El filtro de administración alterna entre ellos, y esa alternancia no puede
    costar una consulta: el servidor los calcula en el mismo recorrido y volver
    a pedirlos traería de nuevo la tabla entera de perfiles para redibujar unas
    barras que ya están en memoria.

    `sinAdmins` en `null` significa "este servidor no calcula el filtrado", que
    es distinto de "filtrado y no quedó nada". Por eso no se inicializa en `{}`.
  */
  const regionesEnCache = {
    todos: null,
    sinAdmins: null,
    porMunicipio: null,
    periodo: "",
  };

  /*
    Y los otros dos controles por el mismo criterio: no se ofrecen mientras no
    haya nada que controlar. Con los 2 estados de hoy, ordenar no cambiaría el
    orden de nada y buscar no escondería ninguna fila. Un control inerte es
    exactamente lo que la casilla de administración venía siendo.
  */
  function ofrecerControles(cuantosEstados, haySeries) {
    const medidas = el("ordenRegiones");
    const buscador = el("buscarRegion");

    // Las pestañas ya no ordenan: eligen la medida. Con UN solo estado siguen
    // haciendo algo —cambian la barra y el número—, así que lo único que las
    // vuelve inertes es que no haya dos series que elegir.
    if (medidas) medidas.hidden = !haySeries;
    if (buscador) buscador.hidden = cuantosEstados <= CORTE_ESTADOS;
  }

  /*
    LAS FILAS, con sus dos series, a partir de los agregados en memoria.

    De dónde sale cada número, que es la parte que no se puede improvisar:

      · Las series (`anon` / `cuenta`) salen de `por_municipio`, el único
        agregado que las trae partidas.

      · El filtro de administración NO tiene agregado por series —el servidor
        manda `por_region_sin_admins` con totales pelados—, así que se DERIVA:
        la diferencia entre el mapa completo y el filtrado son exactamente las
        filas de administración, y TODAS tienen `user_id` (app.py:2846 y 2870),
        así que todas caen del lado "con sesión". Restarlas de `anon`
        inventaría anónimos negativos.

      · El total del estado —y el de cada serie— se SUMA de sus municipios. Un
        contador aparte sería un segundo número para lo mismo, y dos números
        para lo mismo pueden discrepar.

    `Math.max(0, …)` cubre un Cloud Run viejo sirviendo agregados que no cuadran
    entre sí: antes mostrar cero que un negativo.
  */
  function filasDeRegiones() {
    const haySeries = regionesEnCache.porMunicipio !== null;
    const todos = regionesEnCache.todos || {};
    const fuente = haySeries ? regionesEnCache.porMunicipio : todos;

    // `!== null` y no `Boolean(...)`: un mapa filtrado vacío es un dato —"sin
    // administración no hubo nada"— y con `Boolean` el interruptor quedaría
    // encendido pintando el mapa COMPLETO, que es mentir en pantalla.
    const filtrar = excluyendoAdmins() && regionesEnCache.sinAdmins !== null;
    const sinAdmins = filtrar ? regionesEnCache.sinAdmins : null;

    const deAdmins = (estado, municipio) => (sinAdmins === null ? 0 : Math.max(
      0,
      (todos[estado]?.[municipio] ?? 0) - (sinAdmins[estado]?.[municipio] ?? 0)));

    const celdaDe = (estado, municipio, cruda) => {
      const quitar = deAdmins(estado, municipio);
      if (!haySeries) {
        return { anon: 0, cuenta: 0, total: Math.max(0, (cruda || 0) - quitar) };
      }
      const anon = cruda.anon || 0;
      const cuenta = Math.max(0, (cruda.cuenta || 0) - quitar);
      return { anon, cuenta, total: anon + cuenta };
    };

    const filas = [];
    for (const [estado, municipios] of Object.entries(fuente)) {
      // Nada en cero: un municipio sin uso no ocupa lugar.
      const detalle = Object.entries(municipios)
        .map(([municipio, cruda]) => ({
          municipio, ...celdaDe(estado, municipio, cruda),
        }))
        .filter((m) => m.total > 0)
        .sort((a, b) => b.total - a.total);

      const suma = Object.values(detalle).reduce((acc, m) => ({
        anon: acc.anon + m.anon,
        cuenta: acc.cuenta + m.cuenta,
        total: acc.total + m.total,
      }), { anon: 0, cuenta: 0, total: 0 });

      if (suma.total > 0) filas.push({ estado, ...suma, municipios: detalle });
    }

    return { filas, haySeries };
  }

  /*
    El umbral por debajo del cual un gráfico miente más de lo que informa.

    Medido el 2026-08-25: 7 extracciones sin contar administración, y la tabla
    se escribe desde el 21. Dibujar una tendencia sobre eso sugiere una forma
    que no existe — y esta pantalla ya perdió cuatro secciones por mostrar
    datos que se creían ciertos.

    No se ocultan los gráficos por debajo del umbral: se muestran CON la
    advertencia. Esconder el dato sería el error opuesto.
  */
  const MUESTRA_MINIMA = 30;

  function avisoDeMuestra(total, desde) {
    if (total >= MUESTRA_MINIMA) return "";
    return `<p class="admin__consumo">
      Todavía hay pocas extracciones para leer una tendencia
      (${total} ${total === 1 ? "registrada" : "registradas"}${desde
        ? ` desde el ${escapar(desde)}` : ""}).
    </p>`;
  }

  /*
    La leyenda es obligatoria, no decorativa: sin ella los dos colores de una
    barra apilada son adivinanza. Y el texto acompaña al color, para quien no
    los distinga.

    "Con sesión" y no "Con cuenta": alguien registrado que NO inició sesión cae
    del lado anónimo —su fila no tiene `user_id` y el servidor no puede saber
    quién es (F47, app.py:2694)—, así que la etiqueta vieja mentía sobre esas
    filas.
  */
  const leyendaDe = (medida = "total") => {
    // La serie que NO se está mostrando se marca apagada. Una leyenda que
    // afirma las dos mientras la pantalla enseña una sola miente en dos de los
    // tres modos.
    const apagada = (serie) => (medida !== "total" && medida !== serie
      ? " admin__leyenda-item--apagado" : "");
    return `
    <ul class="admin__leyenda">
      <li class="${apagada("cuenta").trim()}"><span class="admin__leyenda-color admin__leyenda-color--cuenta"></span>Con sesión</li>
      <li class="${apagada("anon").trim()}"><span class="admin__leyenda-color admin__leyenda-color--anon"></span>Sin sesión (IP)</li>
    </ul>`;
  };

  function pintarRegiones() {
    const caja = el("listaRegiones");
    if (!caja) return;

    siExisteMes(regionesEnCache.periodo);

    const insignia = el("totalRegiones");
    const vaciar = (mensaje) => {
      caja.innerHTML = `<p class="admin__vacio">${mensaje}</p>`;
      ofrecerControles(0);
      if (insignia) insignia.hidden = true;
    };

    if (regionesEnCache.todos === null) {
      vaciar("No se pudo leer desde dónde se usa.");
      return;
    }

    const { filas, haySeries } = filasDeRegiones();
    if (!filas.length) {
      vaciar("Todavía no hay extracciones este mes.");
      return;
    }

    /*
      La medida activa gobierna TODO lo de abajo: qué filas se ven, cómo se
      ordenan, de qué tamaño es la barra, qué número va a la derecha y qué dice
      la insignia. Un solo valor, para que ninguna parte de la pantalla pueda
      quedar hablando de otra cosa.
    */
    const medida = vistaRegiones.medida;
    const soloUna = medida !== "total";

    /*
      Nada en cero EN LA MEDIDA ACTIVA. Medido en producción: Corregidora tiene
      `0·1` —ninguna extracción con sesión—, así que bajo "Con sesión" se va en
      vez de quedarse con una barra vacía sugiriendo un uso que no hubo.
    */
    const conDato = filas.filter((f) => f[medida] > 0);

    /*
      Una serie SIN USO no es "no hay datos": las otras dos siguen teniendo.

      Por eso esta rama no llama a `vaciar()`, que esconde los controles: si las
      pestañas desaparecieran acá, no habría cómo volver a Total y quien la
      tocara quedaría encerrado en una sección en blanco.
    */
    if (!conDato.length) {
      ofrecerControles(0, haySeries);
      caja.classList.toggle("admin__regiones--una-serie", true);
      if (insignia) {
        insignia.hidden = false;
        insignia.textContent = "0 extracciones";
      }
      caja.innerHTML = (haySeries ? leyendaDe(medida) : "")
        + `<p class="admin__vacio">Ninguna extracción ${medida === "cuenta"
            ? "con sesión iniciada" : "sin sesión"} este mes.</p>`;
      return;
    }

    // "Sin ubicación" no compite: queda fuera del orden y fuera del corte.
    const sinUbicar = conDato.find((f) => f.estado === SIN_UBICACION) || null;
    const estados = conDato.filter((f) => f.estado !== SIN_UBICACION);

    ofrecerControles(estados.length, haySeries);

    const buscando = vistaRegiones.busqueda.trim();
    const buscados = buscando
      ? estados.filter((f) => plano(f.estado).includes(plano(buscando)))
      : estados;

    const ordenados = [...buscados].sort((a, b) => b[medida] - a[medida]);

    // Buscando no se recorta: quien escribió un nombre quiere verlo, esté en
    // el puesto 3 o en el 18.
    const recorta = !vistaRegiones.verTodo && !buscando
      && ordenados.length > CORTE_ESTADOS;
    const visibles = recorta ? ordenados.slice(0, CORTE_ESTADOS) : ordenados;
    const restantes = ordenados.length - visibles.length;

    /*
      El máximo sale de lo que se está MOSTRANDO, "Sin ubicación" incluida: si
      quedara fuera del cálculo, su barra podría pasarse del 100% del ancho.
    */
    const maximo = Math.max(
      1, ...visibles.map((f) => f[medida]), sinUbicar ? sinUbicar[medida] : 0);

    const pista = (fila, clases = "") => {
      const ancho = (fila[medida] / maximo) * 100;
      const parte = (n) => (fila.total ? (n / fila.total) * 100 : 0);

      // Con una sola serie a la vista, la barra toma su color entero. "Sin
      // ubicación" NO: su gris apagado es lo que impide que se lea como el
      // estado que más usa la herramienta, y eso vale en los tres modos.
      const tono = soloUna && !clases.includes("sin-ubicar")
        ? ` admin__barra--${medida}` : "";

      return `
        <span class="admin__barra-pista">
          <span class="admin__barra ${clases}${tono}" style="width: ${ancho.toFixed(2)}%">
            ${haySeries && !soloUna ? `
            <span class="admin__barra-parte admin__barra-parte--cuenta"
                  style="width: ${parte(fila.cuenta).toFixed(2)}%"></span>
            <span class="admin__barra-parte admin__barra-parte--anon"
                  style="width: ${parte(fila.anon).toFixed(2)}%"></span>` : ""}
          </span>
        </span>`;
    };

    /*
      El par exacto, en su propia columna y CADA NÚMERO EN EL COLOR DE SU SERIE.

      Vivía en un segundo renglón bajo el nombre, y ahí duplicaba el alto de
      cada fila para repetir en números lo que la barra ya dice en proporción.

      Coloreado gana algo que el subtítulo no daba: el par enseña por sí solo
      cuál color es cuál, así que la leyenda deja de ser el requisito para
      entender la barra y pasa a ser respaldo. Un gráfico que obliga a mirar
      arriba y volver es un gráfico que se lee mal.
    */
    /*
      La columna del par existe SÓLO cuando se miran las dos series. Con una
      sola a la vista sería el mismo número dos veces: a la izquierda como par
      y a la derecha como total de la fila.
    */
    const columnaPar = (fila) => (haySeries && !soloUna
      ? `<span class="admin__region-par">`
        + `<span class="admin__par-cuenta">${fila.cuenta}</span>`
        + `<span class="admin__par-punto">·</span>`
        + `<span class="admin__par-anon">${fila.anon}</span>`
        + `</span>`
      : "");

    // El rótulo hablado nombra la MEDIDA activa. Sin esto, quien use lector de
    // pantalla oiría "5" mientras la pantalla dice "1".
    const leible = (nombre, fila) => {
      if (!haySeries) return `${nombre}: ${fila.total}`;
      if (medida === "cuenta") return `${nombre}: ${fila.cuenta} con sesión`;
      if (medida === "anon") return `${nombre}: ${fila.anon} sin sesión`;
      return `${nombre}: ${fila.total} — ${fila.cuenta} con sesión, ${fila.anon} sin sesión`;
    };

    const filaMunicipio = (m) => {
      const nombre = m.municipio === SIN_UBICACION ? "Sin municipio" : m.municipio;
      return `
        <li class="admin__municipio" role="img"
            aria-label="${escapar(leible(nombre, m))}">
          <span class="admin__region-nombre">${escapar(nombre)}</span>
          ${pista(m, "admin__barra--municipio")}
          ${columnaPar(m)}
          <span class="admin__region-conteo">${m[medida]}</span>
        </li>`;
    };

    const filaEstado = (fila) => {
      const abierta = vistaRegiones.abiertos.has(fila.estado);
      const id = `municipiosDe-${plano(fila.estado).replace(/[^a-z0-9]+/g, "-")}`;
      return `
        <li class="admin__region-bloque">
          <button type="button" class="admin__region"
                  data-estado="${escapar(fila.estado)}"
                  aria-expanded="${abierta}" aria-controls="${id}"
                  aria-label="${escapar(leible(fila.estado, fila))}">
            <span class="admin__chevron" aria-hidden="true"></span>
            <span class="admin__region-nombre">${escapar(fila.estado)}</span>
            ${pista(fila)}
            ${columnaPar(fila)}
            <span class="admin__region-conteo">${fila[medida]}</span>
          </button>
          <ul class="admin__municipios" id="${id}"${abierta ? "" : " hidden"}>
            ${fila.municipios
              .filter((m) => m[medida] > 0)
              .sort((a, b) => b[medida] - a[medida])
              .map(filaMunicipio).join("")}
          </ul>
        </li>`;
    };

    /*
      "Sin ubicación" no lleva chevron: no tiene municipios que mostrar — es
      justamente el grupo de las filas cuya IP no bajó de país. Un bloque de
      detalle vacío debajo sería peor que nada.
    */
    const cola = sinUbicar
      ? `<ul class="admin__regiones-lista admin__regiones-lista--cola">
           <li class="admin__region admin__region--plana" role="img"
               aria-label="${escapar(leible("Sin ubicación", sinUbicar))}">
             <span class="admin__region-nombre">Sin ubicación</span>
             ${pista(sinUbicar, "admin__barra--sin-ubicar")}
             ${columnaPar(sinUbicar)}
             <span class="admin__region-conteo">${sinUbicar[medida]}</span>
           </li>
         </ul>`
      : "";

    const expansor = restantes > 0
      ? `<button type="button" class="admin__mas" id="verMasRegiones">
           Ver los ${restantes} ${restantes === 1
             ? "estado restante" : "estados restantes"}
         </button>`
      : (vistaRegiones.verTodo && ordenados.length > CORTE_ESTADOS
        ? `<button type="button" class="admin__mas" id="verMasRegiones">Ver menos</button>`
        : "");

    const sinCoincidencias = buscando && !ordenados.length
      ? `<p class="admin__vacio">Ningún estado coincide con “${escapar(buscando)}”.</p>`
      : "";

    const total = conDato.reduce((s, f) => s + f[medida], 0);
    const sinUbicarTotal = sinUbicar ? sinUbicar[medida] : 0;
    const porcentaje = total ? Math.round((sinUbicarTotal / total) * 100) : 0;

    if (insignia) {
      insignia.hidden = false;
      insignia.textContent =
        `${total} ${total === 1 ? "extracción" : "extracciones"}`;
    }

    // La grilla pierde la columna del par cuando no hay par que poner: dejarla
    // vacía correría la barra y el número a la derecha sin razón visible.
    caja.classList.toggle("admin__regiones--una-serie", soloUna || !haySeries);

    /*
      El pie NO repite el total: eso ya lo dice la insignia del encabezado.

      El defecto tenía dos mitades y se corrigieron en dos pasadas. La primera:
      el mismo número aparecía arriba y abajo. La segunda: arriba lo acompañaba
      OTRA palabra —"ejecuciones"—, traída del mockup y única en toda la
      pantalla, donde el resto dice extracciones.

      Dos palabras para la misma cosa son peores que repetir el número, porque
      invitan a creer que miden cosas distintas.

      Acá queda sólo lo que la insignia NO cuenta.
    */
    caja.innerHTML =
      (haySeries ? leyendaDe(medida) : "")
      + `<ul class="admin__regiones-lista">${visibles.map(filaEstado).join("")}</ul>`
      + sinCoincidencias
      + cola
      + expansor
      + (sinUbicarTotal
        ? `<p class="admin__consumo">
             ${sinUbicarTotal} sin ubicar (${porcentaje}%)
           </p>`
        : "")
      + avisoDeMuestra(total, regionesEnCache.periodo);
  }

  function repintarRegiones() {
    // El filtro sólo elige QUÉ agregado se lee; el pintor es siempre el mismo,
    // y es el que está en pantalla. Ésa es toda la corrección del bug 58 ↔ 7.
    pintarRegiones();
  }

  function fallarRegiones() {
    regionesEnCache.todos = null;
    regionesEnCache.sinAdmins = null;
    regionesEnCache.porMunicipio = null;
    ofrecerFiltroAdmins(false);
    repintarRegiones();
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

    // Mismo criterio para el agregado de dos series: sin él la sección degrada
    // a barras de un solo color en vez de quedarse vacía.
    const series = cuerpo.por_municipio;
    regionesEnCache.porMunicipio = series === undefined || series === null
      ? null
      : series;

    regionesEnCache.periodo = cuerpo.periodo || "";

    /*
      El interruptor se ofrece si AL MENOS UNO de los TRES gráficos que gobierna
      puede honrarlo, y el que no pueda lo dice en su propio cuerpo. Es lo que
      permite un control global sin que ninguna sección mienta por omisión.

      La permanencia entró acá el 2026-08-29 junto con la `0035`. Dejarla fuera
      escondería el interruptor en el caso —raro pero real durante un deploy a
      medias— en que fuera la única capaz de filtrar.
    */
    ofrecerFiltroAdmins(
      regionesEnCache.sinAdmins !== null
      || panelEnCache.porDiaSinAdmins !== null
      || Boolean(panelEnCache.permanencia?.sin_admins));
    repintarRegiones();
  }

  /*
    Los eventos van DELEGADOS sobre los contenedores, no atados a cada fila: el
    markup se regenera entero con `innerHTML` en cada repintado, y los
    listeners atados a los nodos viejos se irían con ellos.
  */
  function conectarRegiones() {
    const caja = el("listaRegiones");
    if (caja) {
      caja.addEventListener("click", (evento) => {
        const abridor = evento.target.closest(".admin__region[data-estado]");
        if (abridor) {
          const estado = abridor.dataset.estado;
          if (vistaRegiones.abiertos.has(estado)) {
            vistaRegiones.abiertos.delete(estado);
          } else {
            vistaRegiones.abiertos.add(estado);
          }
          repintarRegiones();
          return;
        }
        if (evento.target.closest("#verMasRegiones")) {
          vistaRegiones.verTodo = !vistaRegiones.verTodo;
          repintarRegiones();
        }
      });
    }

    const orden = el("ordenRegiones");
    if (orden) {
      orden.addEventListener("click", (evento) => {
        const chip = evento.target.closest("[data-medida]");
        if (!chip) return;
        vistaRegiones.medida = chip.dataset.medida;
        orden.querySelectorAll("[data-medida]").forEach((otro) => {
          const activo = otro === chip;
          otro.classList.toggle("admin__chip--activo", activo);
          otro.setAttribute("aria-pressed", String(activo));
        });
        repintarRegiones();
      });
    }

    const buscador = el("buscarRegion");
    if (buscador) {
      buscador.addEventListener("input", () => {
        vistaRegiones.busqueda = buscador.value;
        repintarRegiones();
      });
    }
  }

  // --- Cuándo se usa -------------------------------------------------------

  /*
    La serie temporal. **No es un histograma**, y la diferencia decide qué se
    dibuja:

      · La franja de 24 horas de las tarjetas contesta "¿a qué HORA se usa?".
        Su eje es FIJO: siempre las mismas 24 celdas, acumulando todo el mes.
      · Ésta contesta "¿el uso SUBE o BAJA?". Su eje CRECE con el tiempo.

    Se dibuja con SVG inline y dos `<polyline>`, sin librería: el CSP desplegado
    el 2026-08-23 sólo admite scripts de `cdn.jsdelivr.net` y
    `googletagmanager.com`, así que traer una exigiría tocar `vercel.json` y
    volver a desplegar. Y no hace falta.
  */
  function pintarSerie() {
    const caja = el("graficoSerie");
    const bloque = el("seccionSerie");
    if (!caja || !bloque) return;

    /*
      LA ÚNICA SECCIÓN QUE PUEDE NO CUMPLIR EL FILTRO — Y LO DICE.

      `por_dia` parte el uso en "con sesión" y "sin sesión", NO por rol: acá un
      administrador cuenta como alguien con sesión. Y NO se puede derivar:
      `actividad` guarda la HORA del mes de cada cuenta, no la FECHA, así que
      restarle los administradores daría el total correcto del mes pero habría
      que inventar cómo repartirlo entre los días. Inventar esa distribución es
      exactamente lo que esta sección promete no hacer.

      Hasta que el servidor mande `por_dia_sin_admins`, la sección lo AVISA. Un
      interruptor que promete y un gráfico que no cumple, en silencio, es el bug
      que este panel ya pagó una vez.
    */
    const filtrando = excluyendoAdmins();
    const puedeFiltrar = panelEnCache.porDiaSinAdmins !== null;
    const porDia = filtrando && puedeFiltrar
      ? panelEnCache.porDiaSinAdmins
      : panelEnCache.porDia;

    if (!porDia) {
      bloque.hidden = true;
      return;
    }

    const nota = filtrando && !puedeFiltrar
      ? `<p class="admin__nota-sin-filtrar">
           Esta sección todavía cuenta las pruebas de administración: el
           servidor no manda el desglose por día sin administradores.
         </p>`
      : "";

    const periodo = panelEnCache.periodo;
    const nodoMes = el("mesSerie");
    if (nodoMes) nodoMes.textContent = periodo ? `· ${periodo}` : "";

    /*
      Los días sin uso OCUPAN SU LUGAR.

      El servidor manda sólo los días que tuvieron extracciones; acá se rellena
      el rango completo. Saltárselos convertiría una semana muerta en una línea
      que sigue subiendo — la mentira que un gráfico de tendencia puede contar
      sin que nadie la note.
    */
    const fechas = Object.keys(porDia).sort();
    if (!fechas.length) {
      bloque.hidden = false;
      caja.innerHTML =
        '<p class="admin__vacio">Todavía no hay extracciones este mes.</p>';
      return;
    }

    const dias = [];
    const cursor = new Date(`${fechas[0]}T00:00:00Z`);
    const fin = new Date(`${fechas[fechas.length - 1]}T00:00:00Z`);
    while (cursor <= fin) {
      const clave = cursor.toISOString().slice(0, 10);
      const d = porDia[clave] || {};
      dias.push({ clave, anon: d.anon || 0, cuenta: d.cuenta || 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    const maximo = Math.max(1, ...dias.map((d) => Math.max(d.anon, d.cuenta)));
    const ANCHO = 100;
    const ALTO = 40;
    const x = (i) => (dias.length === 1 ? ANCHO / 2
      : (i / (dias.length - 1)) * ANCHO);
    const y = (n) => ALTO - (n / maximo) * ALTO;

    const puntos = (campo) =>
      dias.map((d, i) => `${x(i).toFixed(2)},${y(d[campo]).toFixed(2)}`).join(" ");

    const total = dias.reduce((s, d) => s + d.anon + d.cuenta, 0);

    // `preserveAspectRatio="none"` deja que el SVG se estire a lo ancho del
    // panel sin dejar franjas vacías a los lados; el alto lo fija el CSS.
    caja.innerHTML = leyendaDe() + `
      <svg class="admin__serie" viewBox="0 0 ${ANCHO} ${ALTO}"
           preserveAspectRatio="none" role="img"
           aria-label="Extracciones por día: ${total} en ${dias.length} días">
        <polyline class="admin__serie-linea admin__serie-linea--cuenta"
                  points="${puntos("cuenta")}" />
        <polyline class="admin__serie-linea admin__serie-linea--anon"
                  points="${puntos("anon")}" />
      </svg>
      <div class="admin__serie-eje">
        <span>${escapar(dias[0].clave.slice(5))}</span>
        <span>${escapar(dias[dias.length - 1].clave.slice(5))}</span>
      </div>`
      + avisoDeMuestra(total, dias[0].clave)
      + nota;

    bloque.hidden = false;
  }

  // --- Permanencia y tiempo de uso -----------------------------------------

  /*
    Cuánto dura cada visita, repartido en seis tramos.

    LOS TRAMOS SON UNA CONSTANTE DE ACÁ, no las claves del payload. Recorrer lo
    que el servidor mandó dejaría fuera cualquier tramo sin visitas, y en un
    histograma la POSICIÓN es el dato: saltarse un hueco convierte una
    distribución con dos picos en una campana. Es el mismo criterio que ya
    obliga a la franja horaria a tener siempre 24 celdas y a la serie temporal
    a rellenar los días muertos.

    El orden importa y por eso es un array y no un objeto: en JavaScript el
    orden de las claves de un objeto es una promesa frágil, y acá el eje se
    lee de izquierda a derecha.

    OBEDECE AL INTERRUPTOR DESDE EL 2026-08-29. No podía hasta entonces —la
    visita no guardaba nada sobre quién la hizo— y la `0035` le dio `es_admin`,
    un booleano que señala al dueño del sitio y no a quien lo usa.

    Lo que la sección sigue declarando en pantalla es el LÍMITE: excluir sólo
    alcanza a los administradores CON sesión. Uno que navegue sin iniciarla
    llega como anónimo, igual que en las otras tres secciones.
  */
  const TRAMOS_PERMANENCIA = [
    "0-30s", "30s-1m", "1m-3m", "3m-5m", "5m-10m", ">10m",
  ];

  /* 258 no le dice nada a nadie; "4m 18s" sí. Los segundos van con dos dígitos
     para que la columna no baile entre "4m 8s" y "4m 18s". */
  const comoTiempo = (segundos) => {
    const minutos = Math.floor(segundos / 60);
    const resto = segundos % 60;
    return minutos
      ? `${minutos}m ${String(resto).padStart(2, "0")}s`
      : `${resto}s`;
  };

  function pintarPermanencia() {
    const caja = el("graficoPermanencia");
    const bloque = el("seccionPermanencia");
    const insignia = el("promedioPermanencia");
    if (!caja || !bloque) return;

    /*
      TRES ESTADOS, y el del medio es el que hace falta declarar.

        · `!datos`        el servidor no manda el campo — no mide. Oculta.
        · `vista.total`   en cero: mide y todavía no entró nadie. VISIBLE, y lo
                          dice. Sin este caso, "no desplegado" y "desplegado sin
                          visitas" se ven idénticos, y no habría forma de saber
                          si la sección está vacía porque algo falló.
        · con datos       el histograma.

      Con el interruptor encendido el cero tiene un CUARTO significado —"todas
      las visitas fueron de administración"— y se dice con otras palabras: es
      un dato del filtro, no del mes, y confundirlos manda a revisar el deploy
      por nada.
    */
    const datos = panelEnCache.permanencia;
    if (!datos) {
      bloque.hidden = true;
      return;
    }

    /*
      `sin_admins` ausente significa "este servidor no lo calcula" —Cloud Run
      puede estar sirviendo una versión anterior a este front—, que es DISTINTO
      de "filtrado y no quedó nada". Mismo criterio que `por_dia_sin_admins`.

      Sin esta distinción el interruptor se encendería y los números no
      cambiarían: se leería el uso "sin administradores" mirando el total de
      todos. Un control inerte que aparenta funcionar es peor que uno ausente,
      así que cuando no se puede filtrar se dice.
    */
    const puedeFiltrar = Boolean(datos.sin_admins);
    const filtrando = excluyendoAdmins() && puedeFiltrar;
    const vista = filtrando ? datos.sin_admins : datos;
    const avisoInerte = excluyendoAdmins() && !puedeFiltrar
      ? '<p class="admin__vacio admin__vacio--aviso">Este servidor todavía no '
        + 'calcula la vista sin administradores: lo de abajo los incluye.</p>'
      : "";

    const nodoMes = el("mesPermanencia");
    if (nodoMes) {
      nodoMes.textContent = panelEnCache.periodo
        ? `· ${panelEnCache.periodo}` : "";
    }
    if (vista.total === 0) {
      bloque.hidden = false;
      if (insignia) insignia.hidden = true;
      /* Dos vacíos distintos, y confundirlos manda a revisar el deploy por
         nada: "nadie entró" es un dato del mes; "sólo entraron admins" es un
         dato del filtro. */
      caja.innerHTML = avisoInerte + (filtrando
        ? '<p class="admin__vacio">Todas las visitas de este mes fueron de '
          + 'administración. Apaga el interruptor para verlas.</p>'
        : '<p class="admin__vacio">Todavía no se registró ninguna visita este '
          + 'mes. La medición está activa: falta que alguien entre.</p>');
      return;
    }

    if (insignia) {
      insignia.hidden = false;
      insignia.textContent = `Promedio: ${comoTiempo(vista.promedio_s || 0)}`;
    }

    const de = (tramo) => vista.tramos?.[tramo] || { anon: 0, cuenta: 0 };
    const totalDe = (tramo) => {
      const t = de(tramo);
      return (t.anon || 0) + (t.cuenta || 0);
    };

    /*
      La altura sale del MÁXIMO y no del total, igual que las barras del mapa y
      por la misma razón medida: sobre el total, con seis tramos todas las
      columnas quedan de dos píxeles y dejan de compararse entre sí. La
      proporción DENTRO de la columna sí va sobre su propio total.
    */
    const maximo = Math.max(1, ...TRAMOS_PERMANENCIA.map(totalDe));

    const columnas = TRAMOS_PERMANENCIA.map((tramo) => {
      const { anon = 0, cuenta = 0 } = de(tramo);
      const suma = anon + cuenta;
      const alto = (suma / maximo) * 100;
      const parte = (n) => (suma ? (n / suma) * 100 : 0);
      const etiqueta =
        `${tramo}: ${suma} — ${cuenta} con sesión, ${anon} sin sesión`;

      return `
        <li class="admin__columna">
          <span class="admin__columna-total">${suma}</span>
          <span class="admin__columna-pista" role="img"
                aria-label="${escapar(etiqueta)}" title="${escapar(etiqueta)}">
            <span class="admin__columna-pila" style="height: ${alto.toFixed(2)}%">
              <span class="admin__columna-parte admin__columna-parte--cuenta"
                    style="height: ${parte(cuenta).toFixed(2)}%"></span>
              <span class="admin__columna-parte admin__columna-parte--anon"
                    style="height: ${parte(anon).toFixed(2)}%"></span>
            </span>
          </span>
          <span class="admin__columna-nombre">${escapar(tramo)}</span>
        </li>`;
    }).join("");

    /* Los tres cortes gruesos, que es como se lee un histograma de un vistazo:
       rápido, normal, largo. Salen de sumar tramos, no de un dato aparte —dos
       números para lo mismo pueden discrepar. */
    const rango = (desde, hasta) => TRAMOS_PERMANENCIA
      .slice(desde, hasta).reduce((s, t) => s + totalDe(t), 0);
    const porciento = (n) => Math.round((n / vista.total) * 100);

    const tarjetas = [
      ["Menos de 1 min", "Rápido", rango(0, 2)],
      ["De 1 a 5 min", "Estándar", rango(2, 4)],
      ["Más de 5 min", "Intensivo", rango(4, 6)],
    ].map(([titulo, mote, n]) => `
      <li class="admin__corte">
        <span class="admin__corte-nombre">${titulo} · ${mote}</span>
        <span class="admin__corte-cifra">${porciento(n)}%</span>
      </li>`).join("");

    const completitud = Math.round((vista.con_resultado / vista.total) * 1000) / 10;

    bloque.hidden = false;
    caja.innerHTML = avisoInerte + leyendaDe()
      + `<ul class="admin__columnas">${columnas}</ul>`
      + `<ul class="admin__cortes">${tarjetas}</ul>`
      + `<p class="admin__consumo">
           ${completitud}% de las visitas terminó en un análisis ·
           ${vista.total} ${vista.total === 1 ? "visita" : "visitas"}
         </p>`
      + avisoDeMuestra(vista.total, panelEnCache.periodo);
  }

  // --- Fallos por banco ----------------------------------------------------

  /*
    De los bancos que SÍ soportamos, cuáles están fallando.

    NO OBEDECE AL INTERRUPTOR, y acá es una DECISIÓN, no una imposibilidad
    —la `0037` le dio a la tabla la columna `es_admin`, así que podría—.

    Las otras tres secciones miden USO: cuánta gente, desde dónde, cuánto se
    queda. Ahí las pruebas de la casa son ruido. Ésta mide si el SOFTWARE
    FUNCIONA, y si un banco revienta, revienta para todos: que lo haya
    encontrado un administrador no lo vuelve menos real. Restarlo escondería
    defectos genuinos justo en la tabla que existe para hallarlos.

    Los intentos de administración se ANOTAN bajo el nombre del banco, porque
    el número solo tampoco alcanza: tres fallos de tres personas y tres de una
    tarde de depuración piden acciones distintas.

    Va UNA anotación por fila y no una por celda: cubre los fallos y los
    descuadres, que es donde el servidor la cuenta.
  */
  function pintarMetricaBanco() {
    const caja = el("tablaMetricaBanco");
    const bloque = el("seccionMetricaBanco");
    if (!caja || !bloque) return;

    /* Los mismos tres estados del resto del panel, y acá el del medio es una
       BUENA noticia: sin él, "este servidor no lo mide" y "no falló nada este
       mes" se ven idénticos — una sección que no está. */
    const datos = panelEnCache.metricaBanco;
    if (!datos) {
      bloque.hidden = true;
      return;
    }

    const nodoMes = el("mesMetricaBanco");
    if (nodoMes) {
      nodoMes.textContent = panelEnCache.periodo
        ? `· ${panelEnCache.periodo}` : "";
    }

    /* Sólo los bancos con algo que reportar, y ordenados por fallos. Seis filas
       de ceros son ruido: la sección existe para decir a cuál mirar primero. */
    const filas = Object.entries(datos.bancos || {})
      .map(([banco, d]) => ({
        banco,
        fallaron: d.fallaron || 0,
        noCuadraron: d.no_cuadraron || 0,
        enPruebas: d.en_pruebas || 0,
      }))
      .filter((f) => f.fallaron || f.noCuadraron)
      .sort((a, b) => (b.fallaron - a.fallaron)
        || (b.noCuadraron - a.noCuadraron));

    bloque.hidden = false;

    /* Los archivos sin banco identificado, ABIERTOS EN TRES.

       Un número solo volvería a juntar lo que la `0036` separó, y son dos
       cosas con acciones opuestas: un estado de cuenta real de un banco que
       todavía no cubrimos —la señal que decide qué construir después— y un PDF
       que nunca fue un estado de cuenta, que es ruido.

       El tercero no es relleno: un escaneado no tiene texto donde buscar, así
       que no es "no era un estado de cuenta", es "no se pudo saber".

       Va ACÁ ARRIBA, antes del retorno por tabla vacía: puede haber archivos
       sueltos en un mes en el que ningún banco falló, y ese caso es
       precisamente el que más interesa leer. */
    const nodoSin = el("sinIdentificarMetricaBanco");
    if (nodoSin) {
      const sin = datos.sin_identificar;
      if (!sin || typeof sin !== "object") {
        // Un servidor viejo manda un número, o no manda nada. Ausencia no es
        // cero: pintar ceros afirmaría algo que nadie midió.
        nodoSin.hidden = true;
      } else {
        const num = (v) => Number(v) || 0;
        const total = num(sin.total);
        nodoSin.hidden = false;
        /* El conteo va DESPUÉS de la etiqueta, y no antes, para que el
           singular no rompa la frase: "1 parecían estados de cuenta" no se
           puede escribir. */
        nodoSin.innerHTML = `
          <strong>${total} archivo${total === 1 ? "" : "s"} sin banco
            identificado.</strong>
          <span>Parecían estados de cuenta: ${num(sin.parecian)} — bancos que
            aún no cubrimos.</span>
          <span>No eran estados de cuenta: ${num(sin.no_eran)}.</span>
          <span>Escaneados, no se pudo saber: ${num(sin.no_se_sabe)}.</span>`;
      }
    }

    if (!filas.length) {
      caja.innerHTML =
        '<p class="admin__vacio">Ningún banco falló este mes.</p>';
      return;
    }

    caja.innerHTML = `
      <table class="admin__tabla">
        <thead>
          <tr>
            <th scope="col">Banco</th>
            <th scope="col">Fallaron</th>
            <th scope="col">No cuadraron</th>
          </tr>
        </thead>
        <tbody>
          ${filas.map((f) => `
            <tr>
              <th scope="row">${escapar(f.banco)}${f.enPruebas
                ? `<span class="admin__en-pruebas">${f.enPruebas} en pruebas</span>`
                : ""}</th>
              <td class="${f.fallaron ? "admin__fallo" : ""}">${f.fallaron}</td>
              <td class="${f.noCuadraron ? "admin__descuadre" : ""}">${f.noCuadraron}</td>
            </tr>`).join("")}
        </tbody>
      </table>`;
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
      if (r.ok) {
        const cuerpo = await r.json();
        extra = cuerpo.perfiles || {};
        recordarPanel(cuerpo);
        // Del MISMO viaje: el endpoint devuelve los agregados, así que los dos
        // gráficos no cuestan una consulta más. Se pintan acá y no en su propia
        // carga por eso.
        // `recordarRegiones` se lleva TODOS los agregados geográficos —el
        // completo, el filtrado y el de dos series— porque una sola vista los
        // combina. Antes había dos pintores y el filtro alimentaba al que
        // estaba oculto.
        recordarRegiones(cuerpo);
        pintarSerie();
        pintarPermanencia();
        pintarMetricaBanco();
      } else {
        console.warn("[admin] /api/admin/perfiles respondió", r.status);
        fallarRegiones();
      }
    } catch (error) {
      console.warn("[admin] no se pudo leer correo/consumo:", error);
      fallarRegiones();
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
        // `esAdmin` vivía acá para la insignia de las tarjetas de actividad.
        // Se fue con ellas el 2026-08-28: nadie lo leía ya, y un campo que se
        // calcula y no se usa es lo que hace creer que algo depende de él.
        // El acento de las filas de administración sale de `p.rol` directo.
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
    conectarRegiones();
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
