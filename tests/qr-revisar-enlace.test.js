const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const MODULO = import(pathToFileURL(path.resolve("supabase/functions/_shared/revisarEnlace.mjs")).href);

/* Capa 1: lo que se rechaza sin preguntar. */

test("links that no legitimate QR needs are rejected with a stable code", async () => {
  const { evaluarEnlace } = await MODULO;
  const casos = {
    "": "enlace_vacio",
    "   ": "enlace_vacio",
    "no es un link": "enlace_invalido",
    "https://ejemplo.mx/a b": "enlace_invalido",
    "https://ejemplo.mx/\tx": "enlace_invalido",
    "ftp://ejemplo.mx/archivo": "enlace_invalido",
    "javascript:alert(1)": "enlace_invalido",
    "data:text/html,<script>alert(1)</script>": "enlace_invalido",
    "http://ejemplo.mx": "enlace_no_https",
    "https://google.com@sitio-malo.com/login": "enlace_con_credenciales",
    "https://usuario:clave@ejemplo.mx": "enlace_con_credenciales",
    "https://ejemplo.mx:8443/": "enlace_puerto",
    "https://192.168.0.10/": "enlace_ip",
    "https://0x7f.1/": "enlace_ip",
    "https://[::1]/": "enlace_ip",
    "https://localhost/": "enlace_invalido",
    "https://intranet/": "enlace_invalido",
    "https://servidor.local/": "enlace_invalido",
    "https://ejemplo.com./": "enlace_invalido",
    "https://аpple.com/": "enlace_punycode",
    "https://go.taudux.com/k3m9xa": "enlace_propio",
    "https://bit.ly/3abc": "enlace_acortador",
    "https://www.bit.ly/3abc": "enlace_acortador",
    "https://tinyurl.com/xyz": "enlace_acortador",
    "https://descargas.ejemplo.mx/instalador.exe": "enlace_descarga",
    "https://ejemplo.mx/app.APK": "enlace_descarga",
    "https://docs.google.com/forms/d/1AbCdEfGh/edit": "enlace_formulario_edicion",
    "https://docs.google.com/forms/d/1AbCdEfGh/edit#responses": "enlace_formulario_edicion",
    "https://docs.google.com/forms/u/0/d/1AbCdEfGh/edit": "enlace_formulario_edicion",
  };
  for (const [entrada, codigo] of Object.entries(casos)) {
    const resultado = evaluarEnlace(entrada);
    assert.equal(resultado.ok, false, `${JSON.stringify(entrada)} debió rechazarse`);
    assert.equal(resultado.codigo, codigo, `${JSON.stringify(entrada)} → ${resultado.codigo}`);
  }
});

test("a link longer than 2048 characters is rejected before parsing", async () => {
  const { evaluarEnlace, LARGO_MAXIMO } = await MODULO;
  const largo = `https://ejemplo.mx/${"a".repeat(LARGO_MAXIMO)}`;
  assert.deepEqual(evaluarEnlace(largo), { ok: false, codigo: "enlace_largo" });
});

test("non-string input never throws", async () => {
  const { evaluarEnlace } = await MODULO;
  for (const valor of [undefined, null, 42, {}, []]) {
    assert.equal(evaluarEnlace(valor).codigo, "enlace_vacio");
  }
});

/* Capa 2: la lista confiable. */

test("form providers on the trusted list pass and say which provider they are", async () => {
  const { evaluarEnlace } = await MODULO;
  const casos = {
    "https://forms.gle/AbC123": "Google Forms",
    "https://docs.google.com/forms/d/e/1FAIpQLSf/viewform?usp=sf_link": "Google Forms",
    "https://forms.office.com/r/abc123": "Microsoft Forms",
    "https://form.typeform.com/to/abc": "Typeform",
    "https://empresa.typeform.com/to/abc": "Typeform",
    "https://form.jotform.com/123": "Jotform",
    "https://www.surveymonkey.com/r/abc": "SurveyMonkey",
    "https://tally.so/r/abc": "Tally",
    "https://youtu.be/dQw4w9WgXcQ": "YouTube",
    "https://taudux.com/app/features/courses/cursos.html": "Taudux",
  };
  for (const [entrada, proveedor] of Object.entries(casos)) {
    const resultado = evaluarEnlace(entrada);
    assert.equal(resultado.ok, true, `${entrada} debió pasar: ${resultado.codigo}`);
    assert.equal(resultado.confiable, true, `${entrada} es de la lista confiable`);
    assert.equal(resultado.proveedor, proveedor);
  }
});

test("docs.google.com is trusted only for forms, not for any document someone uploads", async () => {
  const { evaluarEnlace } = await MODULO;
  const documento = evaluarEnlace("https://docs.google.com/document/d/1abc/edit");
  assert.equal(documento.ok, true);
  assert.equal(documento.confiable, false, "un documento suelto no es un formulario");
});

test("a lookalike of a trusted domain is not trusted", async () => {
  const { evaluarEnlace } = await MODULO;
  const imitacion = evaluarEnlace("https://forms-gle.com/abc");
  assert.equal(imitacion.ok, true);
  assert.equal(imitacion.confiable, false);
  assert.equal(evaluarEnlace("https://forms.gle.evil.mx/abc").confiable, false);
});

test("the stored link is the normalized one", async () => {
  const { evaluarEnlace } = await MODULO;
  assert.equal(evaluarEnlace("  https://FORMS.GLE/AbC123  ").url, "https://forms.gle/AbC123");
  assert.equal(evaluarEnlace("https://ejemplo.mx").url, "https://ejemplo.mx/");
});

/* Capa 3: procedencia rara, sólo fuera de la lista. */

test("unknown domains from heavily abused endings are rejected", async () => {
  const { evaluarEnlace } = await MODULO;
  assert.equal(evaluarEnlace("https://promo-gratis.top/").codigo, "enlace_dominio_riesgoso");
  assert.equal(evaluarEnlace("https://archivo.zip/").codigo, "enlace_dominio_riesgoso");
  assert.equal(evaluarEnlace("https://mi-negocio.mx/").ok, true, "una terminación común pasa");
});

test("a brand name inside someone else's domain is rejected as impersonation", async () => {
  const { evaluarEnlace } = await MODULO;
  const casos = {
    "https://login-bbva.com/": "BBVA",
    "https://bbva.seguridad-mx.com/": "BBVA",
    "https://paypal-verificacion.net/": "PayPal",
    "https://netflix.cuenta-suspendida.info/": "Netflix",
  };
  for (const [entrada, marca] of Object.entries(casos)) {
    assert.deepEqual(evaluarEnlace(entrada), { ok: false, codigo: "enlace_suplantacion", detalle: marca }, entrada);
  }
});

test("the brand's own domains are not impersonation, country endings included", async () => {
  const { evaluarEnlace } = await MODULO;
  for (const legitimo of [
    "https://www.bbva.mx/",
    "https://www.banorte.com/",
    "https://www.santander.com.mx/personas",
    "https://www.citibanamex.com/",
    "https://login.microsoftonline.com/",
    "https://www.amazon.com.mx/",
    "https://www.paypal.com/mx/home",
  ]) {
    assert.equal(evaluarEnlace(legitimo).ok, true, `${legitimo} es de la marca`);
  }
});

test("a cascade of subdomains is rejected outside the trusted list", async () => {
  const { evaluarEnlace } = await MODULO;
  assert.equal(evaluarEnlace("https://a.b.c.d.ejemplo.mx/").codigo, "enlace_subdominios");
  assert.equal(evaluarEnlace("https://b.c.d.ejemplo.mx/").ok, true, "cinco etiquetas todavía pasan");
});

/* Google Web Risk. */

function fetchFalso(respuesta) {
  const llamadas = [];
  const fetchImpl = async (url, opciones) => {
    llamadas.push({ url: new URL(url), opciones });
    if (respuesta instanceof Error) throw respuesta;
    return respuesta;
  };
  return { fetchImpl, llamadas };
}

const json = (cuerpo, status = 200) => new Response(JSON.stringify(cuerpo), { status });

test("Web Risk is asked about the exact link, the three threat types, with the key", async () => {
  const { consultarWebRisk, WEB_RISK_URL } = await MODULO;
  const { fetchImpl, llamadas } = fetchFalso(json({}));
  const resultado = await consultarWebRisk({ url: "https://ejemplo.mx/?a=1&b=2", apiKey: "clave", fetchImpl });

  assert.deepEqual(resultado, { estado: "limpio", amenazas: [] });
  assert.equal(llamadas.length, 1);
  const pedido = llamadas[0].url;
  assert.equal(`${pedido.origin}${pedido.pathname}`, WEB_RISK_URL);
  assert.deepEqual(pedido.searchParams.getAll("threatTypes"), ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE"]);
  assert.equal(pedido.searchParams.get("uri"), "https://ejemplo.mx/?a=1&b=2");
  assert.equal(pedido.searchParams.get("key"), "clave");
  assert.ok(llamadas[0].opciones.signal, "la consulta lleva un timeout");
});

test("a match in Web Risk reports every threat type", async () => {
  const { consultarWebRisk } = await MODULO;
  const { fetchImpl } = fetchFalso(json({ threat: { threatTypes: ["SOCIAL_ENGINEERING", "MALWARE"], expireTime: "2026-10-01T00:00:00Z" } }));
  assert.deepEqual(
    await consultarWebRisk({ url: "https://x.mx", apiKey: "k", fetchImpl }),
    { estado: "peligroso", amenazas: ["SOCIAL_ENGINEERING", "MALWARE"] }
  );
});

test("Web Risk failures never pass as clean", async () => {
  const { consultarWebRisk } = await MODULO;
  for (const falla of [json({ error: "quota" }, 429), json({}, 500), new Error("red caída")]) {
    const { fetchImpl } = fetchFalso(falla);
    const resultado = await consultarWebRisk({ url: "https://x.mx", apiKey: "k", fetchImpl });
    assert.equal(resultado.estado, "error");
  }
  const { fetchImpl, llamadas } = fetchFalso(json({}));
  assert.equal((await consultarWebRisk({ url: "https://x.mx", apiKey: "", fetchImpl })).estado, "sin_configurar");
  assert.equal(llamadas.length, 0, "sin llave no se llama a Google");
});
