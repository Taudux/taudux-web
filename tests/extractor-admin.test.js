/* El panel de administración del extractor.
 *
 * Por qué existe este test. La página del proyecto original **asumía que quien
 * llegaba era administrador**: no verificaba nada, porque allá vivía detrás de
 * un servidor que ya lo había comprobado. Servida por Vercel, esa suposición
 * deja de valer — cualquiera puede pedir la URL.
 *
 * Lo que se blinda acá es que use el mismo arranque que las otras pantallas de
 * administración del sitio (`crearArranqueAdmin`), que exige sesión y rol antes
 * de revelar nada. La RLS sigue siendo el gate real de escritura; esto es la
 * puerta de UX, y una puerta que falta no se nota hasta que alguien entra.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const PAGINA = "src/app/features/transactions/admin.html";
const SCRIPT = "src/app/features/transactions/admin.js";
const HOJA = "src/app/features/transactions/admin.css";

/*
  Los asertos de ausencia miran el markup y las reglas, no la prosa.

  Este repo documenta POR QUÉ algo se fue, y ese comentario tiene que nombrar
  justamente lo que ya no está: `#panelInterno`, `api-cliente.js`, "dar acceso
  ilimitado". Leyendo el archivo entero, explicar bien una eliminación la haría
  fallar — el incentivo exacto que no queremos crear.
*/
const sinComentariosHtml = (html) => html.replace(/<!--[\s\S]*?-->/g, "");
const sinComentariosCss = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

test("the extractor admin page stays out of search engines", () => {
  // Mismo criterio que las dos páginas de Tools y las de auth: no listarla no
  // le pide a nadie que la ignore; el noindex sí.
  assert.match(
    read(PAGINA),
    /<meta\s+name="robots"\s+content="noindex">/,
    "la página de administración debe llevar noindex"
  );
});

test("it hides its content behind the site's admin gate", () => {
  const html = read(PAGINA);

  // Los tres ids que `crearArranqueAdmin` necesita para funcionar: sin ellos
  // el arranque falla y —peor— podría dejar el contenido visible.
  ["adminStartup", "adminContent", "adminStartupError"].forEach((id) => {
    assert.match(html, new RegExp(`id="${id}"`), `falta #${id}`);
  });

  // El contenido nace oculto: se revela recién cuando el rol se confirmó.
  assert.match(
    html,
    /id="adminContent"[^>]*\shidden/,
    "#adminContent debe empezar oculto"
  );

  assert.match(
    html,
    /admin-startup\.js/,
    "debe cargar el arranque compartido en vez de uno propio"
  );
});

test("it asks the shared gate for admin, not just for a session", () => {
  const js = read(SCRIPT);

  // `asegurarAdmin` es lo que distingue "hay sesión" de "es administrador".
  // Quedarse en la sesión dejaría el panel abierto a cualquier persona con
  // cuenta, que es justamente lo que este panel no puede permitir.
  assert.match(js, /crearArranqueAdmin\(/, "debe usar el arranque compartido");
  assert.match(js, /asegurarAdmin\(/, "debe exigir rol admin, no sólo sesión");
});

test("it sends unauthorised visitors back to the extractor, not to courses", () => {
  // `crearArranqueAdmin` manda al catálogo de cursos por defecto, que es de
  // donde vinieron las tres pantallas para las que se escribió. Caer ahí desde
  // la administración del extractor no le explica nada a nadie.
  assert.match(
    read(SCRIPT),
    /rutaRechazo:\s*"\/app\/features\/transactions\//,
    "debe devolver a la herramienta, no al catálogo de cursos"
  );
});

test("it lists the site's real users, not only the in-memory ones", () => {
  const js = read(SCRIPT);

  // Sin esto el panel sólo muestra quién usó la herramienta desde el último
  // reinicio del contenedor — que con escala a cero es casi nadie.
  assert.match(js, /from\("perfiles"\)/, "debe leer los perfiles de Supabase");
  assert.match(js, /"id, nombre, apellidos, rol/, "debe traer el rol real");

  // El correo vive en auth.users y este sitio nunca lo entrega al navegador.
  // Se mira la CONSULTA y no el archivo entero: la primera versión de este
  // test buscaba "email" en todo el texto y saltaba con el comentario que
  // explica, justamente, que los correos no se leen.
  const consulta = js.match(/\.from\("perfiles"\)[\s\S]{0,200}/)?.[0] ?? "";
  assert.doesNotMatch(
    consulta,
    /email|correo/i,
    "la consulta no debe pedir correos: no se exponen al cliente"
  );
});

test("each row shows the email from /api/admin/perfiles, not the raw uuid", () => {
  const js = read(SCRIPT);

  /*
    Ninguna CELDA debe pintar el uuid: el correo viene de /api/admin/perfiles,
    no de `p.id`.

    El aserto miraba el archivo entero (`${escapar(p.id)}` en cualquier lado) y
    eso dejó de servir cuando la tabla se volvió editable: los listeners van por
    delegación y necesitan el uuid en el markup para saber a quién guardar. Lo
    que se prohíbe es mostrarlo; llevarlo en `data-uid` es justamente lo que
    permite no mostrarlo, así que se pide.
  */
  assert.doesNotMatch(
    js,
    /<td[^>]*>\s*\$\{escapar\(p\.id\)\}/,
    "ninguna celda debe pintar el uuid crudo"
  );
  assert.match(
    js,
    /data-uid="\$\{escapar\(p\.id\)\}"/,
    "la fila debe llevar el uid para que la delegación sepa a quién guarda"
  );

  // La celda de correo sigue existiendo, ahora como <td>.
  assert.match(js, /admin__meta/, "la celda de correo debe seguir en el markup");
});

test("name and email share one 'Usuario' cell instead of two columns", () => {
  /*
    Nombre y correo identifican a la MISMA persona: separarlos en dos columnas
    los presentaba como dos datos independientes y le cobraba a la tabla un
    ancho que necesitan las columnas editables. Apilados en una celda se leen
    como lo que son —quién es esta fila—, y el `min-inline-size` de la tabla
    baja, así que el scroll horizontal aparece más tarde en pantallas chicas.

    Es el apilado que la lista tenía ANTES de volverse tabla (`.admin__quien`
    con el nombre arriba y el meta abajo); lo que cambia es que ahora convive
    con columnas de formulario.
  */
  const js = read(SCRIPT);

  assert.match(
    js,
    /<th[^>]*>\s*Usuario/,
    "el encabezado de la primera columna debe ser Usuario"
  );

  ["Nombre", "Correo"].forEach((viejo) => {
    assert.doesNotMatch(
      js,
      new RegExp(`<th[^>]*>\\s*${viejo}\\s*<`),
      `"${viejo}" dejó de ser una columna propia`
    );
  });

  // Y el nombre y el correo quedan dentro de la MISMA celda, apilados.
  assert.match(
    js,
    /<td[^>]*admin__quien[\s\S]{0,300}admin__usuario[\s\S]{0,300}admin__meta/,
    "nombre y correo van en una sola celda, uno debajo del otro"
  );
});

test("the plan column gives way to the two limits that can actually be edited", () => {
  /*
    Con un solo plan asignable —los de pago siguen apagados en el catálogo— la
    columna Plan repetía "free" en todas las filas: un dato cierto que no
    informa de nada y ocupa el lugar del que sí se puede cambiar. Los dos
    números que el administrador gobierna son el cupo mensual y cuántos PDF
    por envío, y hasta ahora no se veían.
  */
  const js = read(SCRIPT);

  ["Cupo mensual", "PDF por envío", "Con límite"].forEach((titulo) => {
    assert.match(
      js,
      new RegExp(`<th[^>]*>\\s*${titulo}`),
      `falta el encabezado "${titulo}"`
    );
  });

  assert.doesNotMatch(
    js,
    /<th[^>]*>\s*Plan/,
    "la columna Plan repetía el mismo valor en todas las filas"
  );

  // Su formateador se va con ella: código muerto que aún nombra el plan como
  // si la tabla lo mostrara.
  assert.doesNotMatch(js, /formatearPlan/, "sobra formatearPlan()");
});

test("saving a row writes it through PUT /api/admin/acceso/<uid>", () => {
  /*
    La tabla dejó de ser sólo lectura. El alta que se borró el 2026-08-20
    escribía contra una identidad rota (`user:<correo>` cuando en producción es
    `user:<uuid>`, hallazgo F30); ésta escribe contra el uuid y por el endpoint
    que lo espera, que además resuelve la herencia del plan en el servidor.
  */
  const js = read(SCRIPT);

  assert.match(
    js,
    /apiFetch\(\s*`\/api\/admin\/acceso\//,
    "debe guardar contra /api/admin/acceso/<uid>"
  );
  assert.match(js, /method:\s*"PUT"/, "el endpoint escribe con PUT");
  assert.match(
    js,
    /"Content-Type":\s*"application\/json"/,
    "el cuerpo va en JSON: sin la cabecera Flask no lo parsea"
  );

  // El endpoint no acepta `plan` y no hay que inventárselo: encender un nivel
  // de pago es otra decisión, tomada en otro lado.
  const cuerpo = js.match(/JSON\.stringify\([\s\S]{0,200}/)?.[0] ?? "";
  assert.doesNotMatch(cuerpo, /\bplan\b/, "el payload no lleva plan");
});

test("a row without its own limits shows no ceiling, not the plan's number", () => {
  /*
    El techo mensual es OPT-IN desde el 2026-08-21: con la bandera apagada el
    servidor devuelve `limite: null` —sin techo—, no el número del plan.

    Antes esta celda pintaba un input vacío con el 3 heredado asomando en el
    `placeholder`. Eso hoy sería una pantalla que miente en la dirección más
    cara: haría creer que hay un tope de 3 al mes donde no hay ninguno. El ∞
    ya existía para `ilimitado`; lo que cambia es que ahora también lo gana la
    fila sin personalizar.
  */
  const js = read(SCRIPT);

  // Lo que se fija es el TÉRMINO que manda: sin la bandera, la celda es un ∞,
  // sin importar qué más se le sume a esa condición. La primera versión de
  // este test copiaba la expresión entera (`datos.ilimitado || !personalizado`)
  // y se puso roja al sumarle el `lote` — sin que lo que probaba cambiara.
  assert.match(
    js,
    /\|\|\s*!personalizado/,
    "sin la bandera encendida la celda tiene que ser un ∞, no un input"
  );

  // Y que el ∞ del acceso ilimitado siga existiendo como caso propio: son dos
  // estados distintos —"nadie le puso techo" y "tiene un permiso especial"— y
  // sólo el primero se arregla marcando la casilla de al lado.
  assert.match(
    js,
    /datos\.ilimitado/,
    "el acceso ilimitado sigue siendo un camino aparte al ∞"
  );
});

test("neither limit shows a number while the row has none of its own", () => {
  /*
    Los DOS son opt-in, no sólo el mensual. Una fila sin la bandera no tiene
    tope por envío tampoco, así que su celda es el mismo "∞" de texto plano y
    no un input deshabilitado con un número heredado asomando.

    Que las dos celdas salgan de la MISMA función es lo que este test cuida:
    si cada columna armara su markup, la próxima vez que una de las dos cambie
    de estado la otra se queda atrás — que es exactamente cómo el `lote` llegó
    tarde a este cambio.
  */
  const js = read(SCRIPT);

  assert.match(
    js,
    /function\s+controlSinTope|controlLimite\s*\(/,
    "las dos celdas comparten el constructor del control"
  );
  // Ningún `${bloqueo}`: ya no queda un numérico que nazca deshabilitado,
  // porque sin bandera no hay input que deshabilitar en ninguna de las dos.
  assert.equal(
    (js.match(/\$\{bloqueo\}/g) || []).length,
    0,
    "sin la bandera no queda ningún input que bloquear: los dos son ∞"
  );
});

test("turning the flag on seeds the row from the plan, not from what applies", () => {
  /*
    Al encender la bandera hay que ofrecer un punto de partida, y ya no puede
    ser "lo que rige hoy": lo que rige es SIN TECHO, y `null` no se puede
    tipear en un `<input type="number">`.

    La semilla sale de `defecto`, que `/api/admin/perfiles` manda con los dos
    números del plan (3 y 2). Es el único lugar donde siguen escritos.
  */
  const js = read(SCRIPT);

  assert.match(
    js,
    /defecto/,
    "el panel tiene que leer la semilla que manda /api/admin/perfiles"
  );
  assert.doesNotMatch(
    js,
    /\[\["limite",\s*efectivo\.limite\]/,
    "prellenar con lo efectivo dejaría el campo vacío: hoy lo efectivo es null"
  );
});

test("it announces the result of every save with a toast", () => {
  /*
    Sin aviso, un guardado fallido se ve igual que uno exitoso: la fila queda
    como estaba. El toast es el único lugar donde se lee el `mensaje` que manda
    el endpoint —en español y explicando el rechazo—, así que se reusa en vez
    de escribir una segunda copia de esos textos acá.
  */
  const js = read(SCRIPT);

  assert.match(js, /mostrarToast\([^)]*"error"\)/, "el fallo debe avisar");
  assert.match(js, /mostrarToast\([^)]*"success"\)/, "el éxito debe avisar");
});

test("the page loads the shared field styles now that it has inputs again", () => {
  /*
    `field.css` se había quitado cuando el único formulario de la página era el
    alta de accesos borrada. La tabla editable trae inputs de vuelta, y sin esa
    hoja quedan con el estilo por defecto del navegador: fondo blanco sobre un
    panel oscuro.
  */
  assert.match(
    sinComentariosHtml(read(PAGINA)),
    /shared\/field\/field\.css/,
    "los campos de la tabla necesitan la hoja compartida"
  );
});

test("the copy stops promising a role column that no longer exists", () => {
  /*
    La columna Rol se quitó el 2026-08-21, y dos frases se quedaron hablando de
    ella: la bajada de la cabecera ("…y el rol de cada una") y `.admin__ayuda`
    ("…su rol, correo y consumo"). El rol ya no se puede LEER en la tabla: sólo
    se insinúa con la franja de acento de las filas de administración.

    Esta pantalla perdió cuatro secciones por mostrar datos que no eran ciertos;
    prometer una columna que no está es la misma clase de defecto, más barata
    de cometer. Se mira el markup sin comentarios: el de arriba explica el
    cambio y nombra justo lo que ya no está.
  */
  const html = sinComentariosHtml(read(PAGINA));

  assert.doesNotMatch(
    html,
    /\brol\b/i,
    "el copy visible no debe prometer un rol que la tabla ya no muestra"
  );
});

test("it reveals the content after the gate approves", () => {
  /*
    `asegurarAdmin` COMPRUEBA; `revelar` MUESTRA. Llamar sólo al primero deja
    la pantalla con el loader girando para siempre, con el rol verificado y sin
    un solo error en consola — el modo de falla más caro de diagnosticar,
    porque todo "funciona" salvo lo que se ve.

    Las tres pantallas de administración de cursos llaman `revelar()`; ésta lo
    había omitido (2026-08-19).
  */
  assert.match(
    read(SCRIPT),
    /arranque\.revelar\(\)/,
    "debe destapar el contenido tras aprobar el gate"
  );
});

test("it starts even if DOMContentLoaded already fired", () => {
  /*
    El script va al final del <body>: cuando corre, el DOM ya está parseado y
    ese evento probablemente ya pasó. Esperarlo a secas significa no arrancar
    nunca — y el modo de falla es cruel, porque **nada falla**: no hay error en
    consola, la página carga entera, y el loader gira para siempre.

    Pasó el 2026-08-19. Se pide el guard por `readyState`, que funciona tanto si
    el DOM ya está listo como si el script se moviera al <head>.
  */
  const js = read(SCRIPT);

  assert.match(
    js,
    /document\.readyState/,
    "debe comprobar readyState en vez de confiar en DOMContentLoaded"
  );

  // Y que efectivamente llame a iniciar() por fuera del listener.
  assert.match(
    js,
    /}\s*else\s*{\s*iniciar\(\);/,
    "con el DOM ya listo debe arrancar de inmediato"
  );
});

test("the panel reads what Supabase cannot give it from /api/admin/perfiles", () => {
  /*
    El correo y el consumo del mes no viven en `perfiles` (RLS + Supabase
    anon): el correo está en `auth.users`, fuera del alcance del cliente, y el
    consumo es estado en memoria de Cloud Run. `GET /api/admin/perfiles` es la
    única puerta admin-only que entrega ambos, así que el panel vuelve a
    llamar a `apiFetch`.

    Este test cubre la lectura; la escritura —`PUT /api/admin/acceso/<uid>`,
    la otra ruta que este panel usa— la cubre el suyo, más arriba.
  */
  assert.match(
    read(SCRIPT),
    /apiFetch\(\s*["']\/api\/admin\/perfiles["']/,
    "debe pedir el correo y el consumo a /api/admin/perfiles"
  );
  assert.match(
    sinComentariosHtml(read(PAGINA)),
    /api-cliente\.js/,
    "con apiFetch de vuelta, la página debe cargar su cliente"
  );
});

test("it keeps the profile list and nothing else", () => {
  const html = sinComentariosHtml(read(PAGINA));

  // Lo que se conserva: la única lista que dice la verdad, porque la lee de la
  // base de datos y no de la memoria de un contenedor.
  ["totalPerfiles", "listaPerfiles"].forEach((id) => {
    assert.match(html, new RegExp(`id="${id}"`), `falta #${id}`);
  });

  /*
    Lo que se fue, y por qué se fue (2026-08-20):

      · "Dar acceso ilimitado" no otorgaba nada: indexaba por `user:<correo>`
        cuando la identidad en producción es `user:<uuid>` (hallazgo F30).
      · El consumo del mes leía el estado en memoria de UNA instancia de Cloud
        Run: con `--max-instances 3` cada administrador veía otra cosa, y un
        reinicio lo borraba (hallazgo F25).
      · Los paneles internos volcaban el JSON crudo de esas mismas fuentes.

    Dos pantallas que mostraban datos falsos son peores que dos pantallas que
    no están.
  */
  [
    "adminCorreo",
    "adminMotivo",
    "btnDarAcceso",
    "adminError",
    "adminMes",
    "listaUsuarios",
    "btnTelemetria",
    "btnDonaciones",
    "panelInterno",
  ].forEach((id) => {
    assert.doesNotMatch(html, new RegExp(`id="${id}"`), `#${id} debía irse`);
  });

  assert.doesNotMatch(
    html,
    /admin__aviso/,
    "el aviso de accesos temporales no tiene accesos que advertir"
  );

  // Incluye la bajada de la cabecera: la página no puede seguir prometiendo
  // algo que ya no reparte.
  assert.doesNotMatch(
    html,
    /acceso ilimitado/i,
    "el copy visible no debe ofrecer el alta que se eliminó"
  );
});

test("its script drops the code that only fed the removed sections", () => {
  const js = read(SCRIPT);

  // `\b` corta antes de `cargarUsuariosDelSitio`: la D es carácter de palabra,
  // así que el nombre largo no matchea el corto.
  ["cargarUsuarios", "cambiarAcceso", "verPanelInterno"].forEach((nombre) => {
    assert.doesNotMatch(js, new RegExp(`\\b${nombre}\\b`), `sobra ${nombre}()`);
  });

  assert.match(js, /cargarUsuariosDelSitio\(/, "debe seguir listando los perfiles");
});

test("its stylesheet pays for the top offset that cursos.css never delivered", () => {
  /*
    `admin.html` reusa el markup y las clases de las pantallas de cursos pero no
    su hoja. El padding que despega el contenido del navbar fijo está en
    `.courses__main` de `cursos.css`, y acá no llega por partida doble: la
    página no carga esa hoja, y su `<main>` lleva `.courses`, no
    `.courses__main`.

    El contenido SIEMPRE arrancó debajo de la barra. No se notaba porque lo
    primero era el aviso de accesos temporales, que nadie extrañaba tapado; al
    quedar "Usuarios del sitio" en cabeza (2026-08-20) el título apareció
    cortado. El defecto es viejo, el borrado sólo lo destapó.

    Lo que se fija acá es de QUIÉN es el offset, no cuánto mide: esta hoja
    tiene que declararlo porque ninguna otra lo hace en esta página. El valor
    lo fija `--espacio-bajo-navbar` en `styles.css`, y su derivación la
    protege `ui-consolidation.test.js`. Este test decía `8rem` literal, que
    era el mismo número escrito dos veces: al mudarlo al token compartido el
    literal quedó viejo y contradecía al otro test.
  */
  assert.match(
    sinComentariosCss(read(HOJA)),
    /\.courses\s*\{[^}]*padding-block-start:\s*var\(--espacio-bajo-navbar\)/,
    "admin.css debe dar el offset superior: nadie más lo hace en esta página"
  );

  // Y no se arregla trayendo `cursos.css` entero: son las reglas del catálogo,
  // que esta pantalla no usa, por una sola declaración que le falta.
  assert.doesNotMatch(
    sinComentariosHtml(read(PAGINA)),
    /courses\/cursos\.css/,
    "no debe cargar la hoja del catálogo para conseguir un padding"
  );
});

test("its stylesheet keeps only the rules the profile list still uses", () => {
  const css = sinComentariosCss(read(HOJA));

  // Sin markup que las invoque: el formulario de alta, su error, el interruptor
  // de acceso, el aviso y el visor de JSON.
  [".admin__aviso", ".admin__alta", ".admin__error", ".admin__switch", "#panelInterno"]
    .forEach((selector) => {
      assert.ok(!css.includes(selector), `${selector} ya no tiene markup que lo use`);
    });

  // Y las que sí: con éstas se dibuja cada fila de la lista de perfiles, así
  // que borrarlas de paso dejaría la única sección viva sin estilos.
  // `.admin__plan` se fue con su columna (2026-08-21); los cuatro últimos son
  // los controles que la reemplazaron. Ojo con `.admin__switch`: aquel nombre
  // era del alta de accesos borrada y sigue prohibido arriba — reusarlo para el
  // interruptor nuevo mezclaría dos historias que terminaron distinto.
  [
    ".admin__lista",
    ".admin__fila",
    ".admin__tabla",
    ".admin__quien",
    ".admin__usuario",
    ".admin__meta",
    ".admin__vacio",
    ".admin__mes",
    ".admin__ayuda",
    ".admin__numero",
    ".admin__toggle",
    ".admin__guardar",
    ".admin__consumo",
  ].forEach((selector) => {
    assert.ok(css.includes(selector), `${selector} sigue en uso: no se borra`);
  });
});

/* ---------------------------------------------------------------------------
 * "Desde dónde se usa" — las barras por estado.
 *
 * El dato que manda sobre este diseño: medido contra la base GeoIP real, cerca
 * de la mitad de las IPs no baja de país. "Sin ubicación" no es un caso borde
 * que se pueda esconder — es una porción grande del total, y un panel que
 * mostrara sólo los estados conocidos afirmaría menos uso del que hubo.
 * ------------------------------------------------------------------------ */

test("the panel has a section for where the tool is used from", () => {
  const pagina = read(PAGINA);

  assert.match(
    pagina,
    /id="listaRegiones"/,
    "falta el contenedor donde se pintan las barras"
  );
  assert.match(
    pagina,
    /<div[^>]*id="listaRegiones"[^>]*aria-live="polite"/,
    "se llena por red después de cargar: sin aria-live, quien usa lector de " +
      "pantalla no se entera de que aparecieron datos"
  );
});

test("the bars are proportional, not a fixed width", () => {
  /*
    Una barra que no sale de un porcentaje sobre el máximo no es un gráfico:
    es una decoración que miente sobre la proporción. Y el porcentaje se
    calcula en JS porque el máximo depende de los datos del mes.
  */
  const js = read(SCRIPT);

  assert.match(
    js,
    /width:\s*\$\{[^}]*\}%/,
    "el ancho de la barra tiene que venir de un porcentaje calculado"
  );
});

test("rows with no known state are shown apart, never hidden", () => {
  /*
    Los dos errores posibles son opuestos y los dos mienten: descartar esas
    filas hace ver menos uso del real, y mezclarlas con los estados inventa
    uno que no existe. Van visibles y separadas.

    El nombre de la clave lo pone el SERVIDOR (`SIN_UBICACION` en app.py) para
    que los dos lados cuenten lo mismo; acá se verifica que el front la
    reconozca y le dé su propio tratamiento.
  */
  const js = read(SCRIPT);

  assert.match(
    js,
    /sin_ubicacion/,
    "el front tiene que reconocer la clave que manda el servidor"
  );
  assert.match(
    js,
    /admin__barra--sin-ubicar/,
    "y distinguirla visualmente de los estados reales"
  );
  assert.match(
    js,
    /Sin ubicación/,
    "con una etiqueta legible, no la clave cruda"
  );
});

test("each state shows its municipalities grouped underneath", () => {
  /*
    Estado y municipio resuelven SIEMPRE juntos (medido: 6 de 10 con las dos,
    4 sin ninguna, nunca una sin la otra), así que todo estado a la vista
    tiene detalle debajo. Se pintan agrupados y siempre visibles — sin clic:
    lo que interesa es leer de un vistazo cuánto pesa el estado Y cómo se
    reparte adentro.
  */
  const js = read(SCRIPT);

  assert.match(
    js,
    /admin__municipio/,
    "el nivel municipio necesita su propia clase para poder distinguirse"
  );
  assert.match(
    js,
    /admin__barra--municipio/,
    "y su propia barra: la jerarquía se lee por el estilo, no por un rótulo"
  );
});

test("a state's total is summed from its municipalities, never sent apart", () => {
  /*
    Dos números para lo mismo pueden discrepar, y ésa es la clase de bug que
    no falla: sólo miente. El servidor manda `{estado: {municipio: n}}` y el
    total sale de sumar ese dict.

    Si mañana alguien agrega un campo `total` al agregado para "ahorrarse la
    suma", este test lo obliga a justificarlo acá.
  */
  const js = read(SCRIPT);

  assert.match(
    js,
    /Object\.values\([^)]*\)\s*\.reduce/,
    "el total del estado se calcula sumando sus municipios"
  );
});

test("the unlocated row stays apart and has no breakdown", () => {
  /*
    No tiene municipios que mostrar: es justamente el grupo de las filas cuya
    IP no bajó de país. Un bloque de detalle vacío debajo sería peor que nada,
    y con el color de acento se leería como el estado que más usa la
    herramienta — cerca de la mitad de las IPs cae ahí.
  */
  const js = read(SCRIPT);

  assert.match(js, /sin_ubicacion/, "reconoce la clave que manda el servidor");
  assert.match(js, /admin__barra--sin-ubicar/, "y la distingue visualmente");
  assert.match(js, /Sin ubicación/, "con etiqueta legible, no la clave cruda");
});
