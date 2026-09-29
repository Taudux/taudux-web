const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const MODULO = import(pathToFileURL(path.join(ROOT, "qr-redireccion/lib/redireccion.mjs")).href);

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const IPAD = "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15";
const ANDROID_TELEFONO = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36";
const ANDROID_TABLETA = "Mozilla/5.0 (Linux; Android 15; SM-X910) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";

function escaneo(codigo, { ua = IPHONE, pais = "MX" } = {}) {
  const headers = { "user-agent": ua };
  if (pais) headers["x-vercel-ip-country"] = pais;
  return new Request(`https://go.taudux.com/api/r?codigo=${encodeURIComponent(codigo)}`, { headers });
}

async function manejador(respuesta) {
  const { crearManejador } = await MODULO;
  const llamadas = [];
  const logs = [];
  const GET = crearManejador({
    resolver: async (consulta) => {
      llamadas.push(consulta);
      if (respuesta instanceof Error) throw respuesta;
      return respuesta;
    },
    logger: { error: (linea) => logs.push(linea) },
  });
  return { GET, llamadas, logs };
}

test("an active QR redirects with 302, never cached, to its destination", async () => {
  const { GET, llamadas } = await manejador({ estado: "activo", destino: "https://forms.gle/AbC123" });
  const respuesta = await GET(escaneo("k3m9xa"));
  assert.equal(respuesta.status, 302, "302 y no 301: un 301 se queda en el navegador aunque el QR se bloquee");
  assert.equal(respuesta.headers.get("location"), "https://forms.gle/AbC123");
  assert.equal(respuesta.headers.get("cache-control"), "no-store");
  assert.deepEqual(llamadas, [{ codigo: "k3m9xa", pais: "MX", dispositivo: "movil" }]);
});

test("a code typed in capitals still resolves", async () => {
  const { GET, llamadas } = await manejador({ estado: "activo", destino: "https://forms.gle/a" });
  assert.equal((await GET(escaneo("K3M9XA"))).status, 302);
  assert.equal(llamadas[0].codigo, "k3m9xa");
});

test("a malformed code never reaches the database", async () => {
  const { GET, llamadas } = await manejador({ estado: "activo", destino: "https://forms.gle/a" });
  for (const codigo of ["", "favicon.ico", "k3m9x", "k3m9xaa", "k3m0xa", "k3m9x;", "robots.txt", "../etc"]) {
    const respuesta = await GET(escaneo(codigo));
    assert.equal(respuesta.status, 404, `"${codigo}"`);
  }
  assert.deepEqual(llamadas, []);
});

test("expired, blocked and unknown QRs get their own page, and none redirects", async () => {
  const casos = { vencido: [410, /venció/], bloqueado: [410, /desactivado/], inexistente: [404, /no existe/] };
  for (const [estado, [status, texto]] of Object.entries(casos)) {
    const { GET } = await manejador({ estado, destino: null });
    const respuesta = await GET(escaneo("k3m9xa"));
    assert.equal(respuesta.status, status, estado);
    assert.equal(respuesta.headers.get("location"), null);
    assert.match(respuesta.headers.get("content-type"), /text\/html/);
    assert.equal(respuesta.headers.get("cache-control"), "no-store");
    assert.match(respuesta.headers.get("content-security-policy"), /default-src 'none'/);
    assert.match(await respuesta.text(), texto);
  }
});

test("an expired QR invites to create one; a blocked one does not", async () => {
  const { GET: vencido } = await manejador({ estado: "vencido" });
  assert.match(await (await vencido(escaneo("k3m9xa"))).text(), /taudux\.com\/app\/features\/qr\//);
  const { GET: bloqueado } = await manejador({ estado: "bloqueado" });
  assert.doesNotMatch(await (await bloqueado(escaneo("k3m9xa"))).text(), /Crea tu propio QR/);
});

test("the pages load nothing from outside: no fonts, no images, no scripts", async () => {
  const { PAGINAS } = await MODULO;
  for (const construir of Object.values(PAGINAS)) {
    const html = await construir().text();
    assert.doesNotMatch(html, /<script|<link|<img|https:\/\/fonts\./);
  }
});

test("a database failure shows 'try again', not a broken page, and is logged", async () => {
  const { GET, logs } = await manejador(new Error("connection refused"));
  const respuesta = await GET(escaneo("k3m9xa"));
  assert.equal(respuesta.status, 503);
  assert.match(await respuesta.text(), /Intenta escanearlo de nuevo/);
  assert.match(logs[0], /connection refused/);
});

test("an 'active' answer with a non-https destination is not followed", async () => {
  const { GET } = await manejador({ estado: "activo", destino: "javascript:alert(1)" });
  const respuesta = await GET(escaneo("k3m9xa"));
  assert.equal(respuesta.status, 404, "la base ya lo impide (CHECK); esto es la segunda red");
  assert.equal(respuesta.headers.get("location"), null);
});

test("the device is classified, never stored raw", async () => {
  const { clasificarDispositivo } = await MODULO;
  assert.equal(clasificarDispositivo(IPHONE), "movil");
  assert.equal(clasificarDispositivo(ANDROID_TELEFONO), "movil");
  assert.equal(clasificarDispositivo(IPAD), "tableta");
  assert.equal(clasificarDispositivo(ANDROID_TABLETA), "tableta");
  assert.equal(clasificarDispositivo(WINDOWS), "escritorio");
  assert.equal(clasificarDispositivo(""), "otro");
  assert.equal(clasificarDispositivo("curl/8.0"), "otro");

  const { GET, llamadas } = await manejador({ estado: "activo", destino: "https://forms.gle/a" });
  await GET(escaneo("k3m9xa", { ua: WINDOWS, pais: null }));
  assert.deepEqual(llamadas[0], { codigo: "k3m9xa", pais: null, dispositivo: "escritorio" });
});

test("the code format matches the database constraint in 0044", async () => {
  const { CODIGO_VALIDO } = await MODULO;
  const migracion = fs.readFileSync(path.join(ROOT, "supabase/migrations/0044_qr_codigos.sql"), "utf8");
  const patron = /check \(codigo ~ '\^(\[[^\]]+\]\{6\})\$'\)/.exec(migracion);
  assert.ok(patron, "no se encontró el CHECK del código en 0044");
  assert.equal(CODIGO_VALIDO.source, `^${patron[1]}$`, "si cambia el formato, cambia en los dos lados");
});

test("the Vercel project rewrites /<code> to the function and sends / to the generator", () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, "qr-redireccion/vercel.json"), "utf8"));
  assert.deepEqual(config.rewrites, [{ source: "/:codigo", destination: "/api/r?codigo=:codigo" }]);
  assert.equal(config.redirects[0].destination, "https://taudux.com/app/features/qr/");
  assert.equal(config.redirects[0].permanent, false);
});

test("every go.taudux.com page offers 'Reportar este QR', with the code when it is valid", async () => {
  for (const estado of ["vencido", "bloqueado", "inexistente"]) {
    const { GET } = await manejador({ estado });
    const html = await (await GET(escaneo("k3m9xa"))).text();
    assert.match(html, /<a class="reportar" href="https:\/\/taudux\.com\/app\/features\/qr\/reportar\.html\?codigo=k3m9xa">Reportar este QR<\/a>/, estado);
  }
  const { GET } = await manejador({ estado: "activo", destino: "https://forms.gle/a" });
  const sinCodigo = await (await GET(escaneo("<script>"))).text();
  assert.match(sinCodigo, /href="https:\/\/taudux\.com\/app\/features\/qr\/reportar\.html">Reportar/,
    "un código con formato inválido no llega al HTML");
  assert.doesNotMatch(sinCodigo, /<script>/);
});

test("the report link can point elsewhere (the local lab)", async () => {
  const { crearManejador } = await MODULO;
  const GET = crearManejador({
    resolver: async () => ({ estado: "vencido" }),
    urlReportar: "http://localhost:8282/app/features/qr/reportar.html",
    logger: { error() {} },
  });
  assert.match(await (await GET(escaneo("k3m9xa"))).text(), /http:\/\/localhost:8282\/app\/features\/qr\/reportar\.html\?codigo=k3m9xa/);
});
