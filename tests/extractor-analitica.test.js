/* El evento de analítica del botón Procesar, y sobre todo su LÍMITE legal.
 *
 * Decisión del 2026-08-21: GA4 registra cada pulsación de Procesar para medir
 * el funnel — cuántos llegan a la página y cuántos procesan de verdad, que es
 * lo único que el servidor no puede ver (el resultado ya vive en
 * `extractor_uso` y `extractor_metrica_banco`, sin Google de por medio).
 *
 * Lo que este archivo blinda no es que el evento exista: es que NO CREZCA.
 * Al evento sólo pueden viajar metadatos — el plan como categoría y cuántos
 * archivos—. El nombre del archivo, el contenido del PDF, el correo o el id
 * anónimo son datos personales (LFPDPPP) y además violan los términos de GA4;
 * mandarlos convertiría una métrica en una fuga. La lista de parámetros es
 * CERRADA, y agregarle una clave nueva exige pasar por acá y justificarla.
 *
 * Los comentarios se quitan antes de mirar el código: explicar qué NO puede
 * viajar nombrándolo no debe hacer fallar (ni pasar) ningún aserto.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SCRIPT = "src/app/features/transactions/extractor.js";

const sinComentariosJs = (js) => js
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "");

const codigo = () =>
  sinComentariosJs(fs.readFileSync(path.join(ROOT, SCRIPT), "utf8"));

test("pressing Procesar fires exactly one analytics event", () => {
  const eventos = codigo().match(/gtag\(\s*"event"/g) || [];
  assert.equal(
    eventos.length,
    1,
    "un solo evento de negocio: el clic de Procesar. Cualquier otro pasa " +
      "primero por la conversación legal que definió esta lista"
  );
  assert.match(
    codigo(),
    /gtag\(\s*"event",\s*"procesar_pdf"/,
    "el evento del funnel se llama procesar_pdf"
  );
});

test("the event's parameter list is closed: plan and file count, nothing else", () => {
  /*
    El regex captura el objeto de parámetros y se valida clave por clave
    contra una lista blanca. Así, agregar `nombre: archivo.name` —el error
    más fácil de cometer— pone este test en rojo aunque suene inocente.
  */
  const evento = codigo().match(
    /gtag\(\s*"event",\s*"procesar_pdf",\s*\{([\s\S]*?)\}\s*\)/
  );
  assert.ok(evento, "el evento debe declarar sus parámetros inline");

  const claves = [...evento[1].matchAll(/(\w+)\s*:/g)].map((m) => m[1]);
  const permitidas = new Set(["plan", "archivos"]);
  for (const clave of claves) {
    assert.ok(
      permitidas.has(clave),
      `la clave "${clave}" no está en la lista permitida: sólo metadatos ` +
        "pueden viajar a Google (LFPDPPP y términos de GA4)"
    );
  }
  assert.ok(claves.length > 0, "el evento sin parámetros no mide el funnel");
});

test("without GA4 loaded, Procesar still works", () => {
  /*
    Bloqueadores de anuncios cortan gtag.js a diario. El evento va detrás de
    un guard para que la analítica caída jamás se lleve puesto el
    procesamiento — la medición es cortesía, el producto no.
  */
  assert.match(
    codigo(),
    /typeof\s+gtag\s*===\s*"function"/,
    "la llamada a gtag necesita el guard: sin GA4 la página funciona igual"
  );
});
