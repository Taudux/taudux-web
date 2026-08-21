/* Las tablas del extractor no se escriben desde el navegador. Ninguna. Nunca.
 *
 * Son dos, y las dos deciden dinero:
 *
 *   · `public.extractor_acceso` decide cuántos PDF puede procesar cada cuenta.
 *   · `public.extractor_uso`    es el conteo contra el que se cobra ese techo.
 *
 * Si el cliente pudiera escribir la primera se daría `limite = null`; si
 * pudiera escribir la segunda —o borrar de ella— se dejaría el contador en
 * cero. El resultado es el mismo por los dos caminos: la cuota entera pasa a
 * ser decorativa. La migración 0029 ya lo dejó escrito con todas las letras:
 *
 *   "si alguien pudiera darse Gold desde el navegador, el catálogo entero
 *    sería decorativo"
 *
 * Por eso esas tablas tienen SÓLO políticas de `select`, y toda escritura pasa
 * por Cloud Run con `service_role` —una clave que vive en Secret Manager y
 * nunca llega al navegador—: `PUT /api/admin/acceso/<uid>` detrás de
 * `_solo_admin()` para `extractor_acceso`, y `_escribir_uso()` dentro de
 * `/api/extraer` para `extractor_uso`.
 *
 * POR QUÉ ES UNA LISTA Y NO UN TEST POR TABLA. La segunda entró el 2026-08-21,
 * al cerrar F9, y agregarla fue añadir un elemento a `TABLAS_SOLO_LECTURA`.
 * Ése es el punto: la próxima tabla del extractor que guarde algo que el
 * usuario querría poder cambiar se protege recordando UNA cosa —sumarla acá—
 * en vez de recordando copiar un bloque de test entero, que es la clase de
 * tarea que se olvida.
 *
 * POR QUÉ ESTE TEST RECORRE EL DIRECTORIO ENTERO Y NO SÓLO LA MIGRACIÓN QUE
 * CREÓ CADA TABLA. El modo de falla realista acá no es un atacante: es alguien
 * —con buenas intenciones y prisa— agregando `create policy ... for update`
 * en la migración 0041 dentro de un año, para "arreglar" un panel que no
 * guardaba. Fijarse sólo en la 0029 y la 0030 dejaría esa puerta sin vigilar.
 * La pregunta que este archivo contesta es "¿alguien, alguna vez, abrió la
 * escritura?", y esa pregunta se responde mirando todas.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const MIGRACIONES = path.join(ROOT, "supabase", "migrations");

/*
  Las tablas del extractor que el cliente puede LEER (con RLS) y no puede
  escribir por ninguna vía. Sumar una acá es todo lo que hace falta para que
  quede vigilada.
*/
const TABLAS_SOLO_LECTURA = [
  {
    tabla: "extractor_acceso",
    escribe: "PUT /api/admin/acceso/<uid>, con service_role y detrás de _solo_admin()",
  },
  {
    tabla: "extractor_uso",
    escribe: "_escribir_uso() en /api/extraer, con service_role",
  },
];

/*
  Los comentarios se quitan antes de mirar: este repo documenta POR QUÉ algo
  NO está, y esos textos nombran justamente `insert`/`update` sobre la tabla
  al explicar que no se permiten. Sin quitarlos, explicar bien la decisión
  haría fallar el test que la protege — el incentivo exacto que no queremos.
*/
const sinComentarios = (sql) => sql
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*--.*$/gm, "");

const archivos = () => fs.readdirSync(MIGRACIONES)
  .filter((nombre) => nombre.endsWith(".sql"))
  .sort();

const leer = (nombre) => sinComentarios(
  fs.readFileSync(path.join(MIGRACIONES, nombre), "utf8"));

TABLAS_SOLO_LECTURA.forEach(({ tabla, escribe }) => {
  test(`no migration ever opens ${tabla} to client writes`, () => {
    /*
      `create policy <nombre> on public.<tabla> for insert|update|delete`
      en cualquier orden de saltos de línea: las migraciones de este repo
      parten la sentencia en varias líneas.
    */
    const abren = new RegExp(
      `on\\s+public\\.${tabla}\\s+for\\s+(insert|update|delete)`, "i");

    const culpables = archivos().filter((nombre) => abren.test(leer(nombre)));

    assert.deepEqual(
      culpables,
      [],
      `${tabla} sólo admite políticas de select: la escritura pasa por ${escribe}`
    );
  });
});

test("the migration that adds per-account limits creates no policy at all", () => {
  /*
    La 0032 agrega columnas (`personalizado`, `limite`, `lote`) y cambia el
    tipo de `lote` en el catálogo. Nada de eso necesita tocar la seguridad de
    la tabla, y una policy que apareciera acá sería un efecto colateral, no
    una decisión: el sitio donde menos se la revisaría.
  */
  const sql = leer("0032_extractor_limites_por_usuario.sql");

  assert.doesNotMatch(
    sql,
    /create\s+policy/i,
    "esta migración agrega columnas, no permisos"
  );

  // Y sí hace lo suyo: las tres columnas que el panel edita.
  ["personalizado", "limite", "lote"].forEach((columna) => {
    assert.match(
      sql,
      new RegExp(`add column if not exists\\s+${columna}\\b`, "i"),
      `falta la columna ${columna}`
    );
  });
});

test("green stays switched off: assigning paid tiers is another change", () => {
  /*
    El alcance se acotó a `anonimo` y `free`. `green` tiene precio ("$100/mes")
    y no hay infraestructura de cobro, así que activarlo permitiría regalar un
    nivel de pago — decisión de producto que no se toma de refilón dentro de
    una migración de límites.
  */
  const sql = leer("0032_extractor_limites_por_usuario.sql");

  assert.doesNotMatch(
    sql,
    /set\s+activo\s*=\s*true/i,
    "ningún nivel se activa en esta migración"
  );
});

test("connecting the usage counter needed no migration at all", () => {
  /*
    F9 se cerró el 2026-08-21 SIN migración nueva, y conviene que quede fijado
    por qué: la tabla, su RLS y sus índices ya existían desde la 0030 —
    `extractor_uso_user_fecha` es exactamente `(user_id, creado_en)`, que es el
    índice del `count(*)` del periodo—. Lo único que faltaba era código que
    escribiera.

    Este test falla si alguien agrega una migración `extractor_uso` posterior a
    la 0030, que es el momento de preguntarse si de verdad hace falta o si es
    la policy de insert que este archivo prohíbe unas líneas más arriba.
  */
  const posteriores = archivos().filter(
    (nombre) => /extractor_uso/i.test(nombre) && !nombre.startsWith("0030_"));

  assert.deepEqual(
    posteriores,
    [],
    "el contador se conectó con la 0030 tal como estaba: tabla, RLS e índice " +
    "(user_id, creado_en) ya existían y sólo faltaba escribirla"
  );

  // Y la 0030 sigue trayendo lo que el conteo necesita.
  const sql = leer("0030_extractor_uso.sql");
  assert.match(
    sql,
    /create index if not exists\s+extractor_uso_user_fecha\s+on\s+public\.extractor_uso\s*\(\s*user_id\s*,\s*creado_en\s*\)/i,
    "sin ese índice, contar el mes de alguien sería un scan de la tabla"
  );
  assert.match(
    sql,
    /create policy\s+extractor_uso_select_propio/i,
    "cada quien lee su propio uso: es lo que evita usar service_role para contar"
  );
  assert.match(
    sql,
    /create policy\s+extractor_uso_select_admin/i,
    "y el panel las lee todas con el token del admin, no con service_role"
  );
});
