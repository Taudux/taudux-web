const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const FUNCTION_PATH = path.resolve("supabase/functions/revisar-qr/index.ts");
const endpoint = import(pathToFileURL(FUNCTION_PATH).href);
const SECRETO = "secreto-del-cron";

function pedido(options = {}) {
  // Object.hasOwn y no un default: `secreto: undefined` tiene que significar
  // "sin cabecera", no "el secreto correcto".
  const secreto = Object.hasOwn(options, "secreto") ? options.secreto : SECRETO;
  const method = options.method ?? "POST";
  const headers = { authorization: "Bearer anon" };
  if (secreto !== undefined) headers["x-taudux-qr-secret"] = secreto;
  return new Request("https://edge.test/revisar-qr", { method, headers });
}

async function harness(options = {}) {
  const { createRevisarQrHandler } = await endpoint;
  const calls = { rpc: [], webRisk: [] };
  const env = {
    QR_CRON_SECRET: SECRETO,
    WEB_RISK_API_KEY: "clave",
    SUPABASE_URL: "https://yqkvgfqplmbbcebrivpt.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    ...options.env,
  };
  const pendientes = options.pendientes ?? [
    { id: 1, destino: "https://forms.gle/limpio" },
    { id: 2, destino: "https://sitio-comprometido.mx/" },
    { id: 3, destino: "https://sin-respuesta.mx/" },
  ];
  let reloj = 0;
  const handler = createRevisarQrHandler({
    getEnv: (name) => env[name],
    now: () => reloj,
    createServiceClient: async () => ({
      async rpc(name, args) {
        calls.rpc.push({ name, args });
        if (name === "qr_pendientes_revision") {
          return options.pendientesError ? { data: null, error: { message: "boom" } } : { data: pendientes, error: null };
        }
        if (name === "qr_registrar_revision") {
          return { data: null, error: options.registroError ? { message: "boom" } : null };
        }
        throw new Error(`rpc inesperado ${name}`);
      },
    }),
    fetchImpl: async (url) => {
      const uri = new URL(url).searchParams.get("uri");
      calls.webRisk.push(uri);
      reloj += options.msPorConsulta ?? 100;
      if (uri.includes("comprometido")) {
        return new Response(JSON.stringify({ threat: { threatTypes: ["MALWARE"] } }));
      }
      if (uri.includes("sin-respuesta")) return new Response("{}", { status: 503 });
      return new Response("{}");
    },
    logger: { info() {}, error() {} },
  });
  return { handler, calls };
}

test("only the cron secret authorizes a review", async () => {
  const { handler, calls } = await harness();
  for (const secreto of [undefined, "", "otro", `${SECRETO}x`, SECRETO.slice(0, -1)]) {
    const response = await handler(pedido({ secreto }));
    assert.equal(response.status, 401, `secreto ${JSON.stringify(secreto)}`);
  }
  assert.equal((await handler(pedido({ method: "GET" }))).status, 405);
  assert.deepEqual(calls.rpc, []);

  const sinSecretoConfigurado = await harness({ env: { QR_CRON_SECRET: "" } });
  assert.equal((await sinSecretoConfigurado.handler(pedido({ secreto: "" }))).status, 401,
    "un secreto vacío en el servidor no abre la puerta a quien manda vacío");
});

test("a clean QR is marked reviewed, a flagged one is blocked, a failed lookup waits", async () => {
  const { handler, calls } = await harness();
  const response = await handler(pedido());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, pendientes: 3, revisados: 2, bloqueados: 1, errores: 1 });

  const registros = calls.rpc.filter((llamada) => llamada.name === "qr_registrar_revision").map((llamada) => llamada.args);
  assert.deepEqual(registros, [
    { p_id: 1, p_amenazas: [] },
    { p_id: 2, p_amenazas: ["MALWARE"] },
  ], "el que falló (id 3) no se registra: queda pendiente para mañana");
  assert.deepEqual(calls.rpc[0], { name: "qr_pendientes_revision", args: { p_limite: 300 } });
});

test("the run stops at its time budget and leaves the rest pending", async () => {
  const pendientes = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, destino: `https://forms.gle/${i}` }));
  const { handler, calls } = await harness({ pendientes, msPorConsulta: 10000 });
  const resumen = await (await handler(pedido())).json();
  assert.equal(resumen.pendientes, 20);
  assert.ok(resumen.revisados < 20 && resumen.revisados >= 4, `revisó ${resumen.revisados}`);
  assert.equal(calls.webRisk.length, resumen.revisados);
});

test("without a Web Risk key nothing is reviewed, and it says so", async () => {
  const { handler, calls } = await harness({ env: { WEB_RISK_API_KEY: undefined } });
  const response = await handler(pedido());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "web_risk_sin_configurar");
  assert.deepEqual(calls.rpc, []);
});

test("database failures are reported, never crash", async () => {
  const { handler } = await harness({ pendientesError: true });
  assert.equal((await handler(pedido())).status, 503);

  const { handler: conRegistroRoto } = await harness({ registroError: true });
  const resumen = await (await conRegistroRoto(pedido())).json();
  assert.equal(resumen.revisados, 0);
  assert.equal(resumen.errores, 3);
});
