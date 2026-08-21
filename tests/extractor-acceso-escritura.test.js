/* `public.extractor_acceso` no se escribe desde el navegador. Nunca.
 *
 * Esa tabla decide cuántos PDF puede procesar cada cuenta. Si el cliente
 * pudiera escribirla —aunque fuera con una policy condicionada a `es_admin()`—
 * la autorización se mudaría del backend a la base sin sacar al backend del
 * camino: superficie nueva a cambio de nada. La migración 0029 ya lo dejó
 * escrito con todas las letras:
 *
 *   "si alguien pudiera darse Gold desde el navegador, el catálogo entero
 *    sería decorativo"
 *
 * Por eso esa tabla tiene SÓLO políticas de `select` (propia y de admin), y
 * toda escritura pasa por `PUT /api/admin/acceso/<uid>` en Cloud Run, detrás
 * de `_solo_admin()` y con `service_role` —una clave que vive en Secret
 * Manager y nunca llega al navegador—.
 *
 * POR QUÉ ESTE TEST RECORRE EL DIRECTORIO ENTERO Y NO SÓLO LA MIGRACIÓN QUE
 * CREÓ LA TABLA. El modo de falla realista acá no es un atacante: es alguien
 * —con buenas intenciones y prisa— agregando `create policy ... for update`
 * en la migración 0041 dentro de un año, para "arreglar" un panel que no
 * guardaba. Fijarse sólo en la 0029 dejaría esa puerta sin vigilar. La
 * pregunta que este archivo contesta es "¿alguien, alguna vez, abrió la
 * escritura?", y esa pregunta se responde mirando todas.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const MIGRACIONES = path.join(ROOT, "supabase", "migrations");

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

test("no migration ever opens extractor_acceso to client writes", () => {
  /*
    `create policy <nombre> on public.extractor_acceso for insert|update|delete`
    en cualquier orden de saltos de línea: las migraciones de este repo parten
    la sentencia en varias líneas.
  */
  const abren = /on\s+public\.extractor_acceso\s+for\s+(insert|update|delete)/i;

  const culpables = archivos().filter((nombre) => abren.test(
    sinComentarios(fs.readFileSync(path.join(MIGRACIONES, nombre), "utf8"))));

  assert.deepEqual(
    culpables,
    [],
    "extractor_acceso sólo admite políticas de select: la escritura pasa por " +
    "PUT /api/admin/acceso/<uid>, con service_role y detrás del guard de admin"
  );
});

test("the migration that adds per-account limits creates no policy at all", () => {
  /*
    La 0032 agrega columnas (`personalizado`, `limite`, `lote`) y cambia el
    tipo de `lote` en el catálogo. Nada de eso necesita tocar la seguridad de
    la tabla, y una policy que apareciera acá sería un efecto colateral, no
    una decisión: el sitio donde menos se la revisaría.
  */
  const sql = sinComentarios(fs.readFileSync(
    path.join(MIGRACIONES, "0032_extractor_limites_por_usuario.sql"), "utf8"));

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
  const sql = sinComentarios(fs.readFileSync(
    path.join(MIGRACIONES, "0032_extractor_limites_por_usuario.sql"), "utf8"));

  assert.doesNotMatch(
    sql,
    /set\s+activo\s*=\s*true/i,
    "ningún nivel se activa en esta migración"
  );
});
