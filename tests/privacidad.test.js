const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const html = fs.readFileSync(
  path.join(ROOT, "src/app/features/legal/privacidad.html"),
  "utf8"
);

/*
  Blinda la declaración legal que habilita el aviso de curso nuevo por correo
  (opt-out, default true). Si esta declaración desaparece o se afloja, la
  migración 0015 y la edge function de envío quedan operando sin respaldo en
  el aviso de privacidad.
*/

test("the notice declares the visit measurement, for as long as it exists", () => {
  /*
    `src/app/core/telemetry/permanencia.js` mide cuánto dura cada visita al
    extractor. Lo que obliga a declararlo NO es que identifique a alguien —no
    lo hace— sino que RECOLECTA.

    Este test ata las dos cosas: mientras el módulo esté en el repo, el aviso
    tiene que decirlo. Es la deuda que este proyecto ya arrastra dos veces
    —GA4 y la ubicación de `extractor_uso`, ambas con borrador escrito sin
    publicar— y la forma de que no crezca a tres.

    Los espacios se normalizan antes de buscar: el ajuste de línea del HTML
    parte las frases, y un aserto que no lo contemple falla contra un aviso que
    sí dice lo que se le pide.
  */
  const prosa = html.replace(/\s+/g, " ");

  assert.ok(
    fs.existsSync(path.join(ROOT, "src/app/core/telemetry/permanencia.js")),
    "hoy se mide la permanencia: el módulo está en el repo"
  );
  assert.match(
    prosa,
    /cu(á|a)nto tiempo activo/i,
    "el aviso tiene que declarar que se mide la duración de la visita"
  );
  assert.match(
    prosa,
    /no lleva tu nombre, tu correo ni ning(ú|u)n identificador tuyo/i,
    "y decir de frente que ese registro no permite señalar a nadie"
  );
});

test("privacy notice no longer claims there are no secondary purposes", () => {
  assert.doesNotMatch(html, /Actualmente no tratamos tus datos para finalidades secundarias/);
});

test("privacy notice discloses the new-course email as a secondary purpose", () => {
  assert.match(html, /Avisarte por correo electr(ó|o)nico cuando publicamos un curso nuevo/);
});

test("privacy notice names both opt-out mechanisms: the portal and the email footer link", () => {
  assert.match(html, /Portal de cuenta.{0,40}Preferencias de\s*correo\s*<\/strong>/s);
  assert.match(html, /enlace de baja/);
});

test("privacy notice states opting out does not affect the rest of the service", () => {
  assert.match(html, /Negarte no afecta el resto del servicio/);
});

test("privacy notice extends the Resend disclosure beyond authentication emails", () => {
  const resendBlock = html.slice(html.indexOf("<strong>Resend</strong>"));
  const closingLi = resendBlock.indexOf("</li>");
  const scoped = resendBlock.slice(0, closingLi === -1 ? undefined : closingLi);
  assert.match(scoped, /autenticaci(ó|o)n/);
  assert.match(scoped, /curso/i);
});
