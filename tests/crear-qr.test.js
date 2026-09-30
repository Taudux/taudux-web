const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const FUNCTION_PATH = path.resolve("supabase/functions/crear-qr/index.ts");
const endpoint = import(pathToFileURL(FUNCTION_PATH).href);
const ORIGIN = "https://taudux.com";
const USUARIO = "123e4567-e89b-42d3-a456-426614174000";

function pedido(options = {}) {
  const { body = { destino: "https://forms.gle/AbC123", titulo: "Encuesta" }, method = "POST" } = options;
  const origin = Object.hasOwn(options, "origin") ? options.origin : ORIGIN;
  const token = Object.hasOwn(options, "token") ? options.token : "Bearer usuario";
  const headers = {};
  if (origin !== undefined) headers.origin = origin;
  if (token !== undefined) headers.authorization = token;
  if (method === "OPTIONS" || method === "GET") return new Request("https://edge.test/crear-qr", { method, headers });
  headers["content-type"] = options.contentType ?? "application/json";
  return new Request("https://edge.test/crear-qr", {
    method,
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function payload(response) {
  const texto = await response.text();
  return texto ? JSON.parse(texto) : null;
}

/*
  Arnés: cliente del que llama (getUser), cliente de servicio (rpc) y fetch de
  Web Risk, todos falsos. `calls` registra el orden, que es parte del contrato:
  Web Risk no se consulta si la cuenta no puede crear.
*/
async function harness(options = {}) {
  const { createCrearQrHandler } = await endpoint;
  const calls = { order: [], rpc: [], webRisk: [], logs: [] };
  const env = {
    SUPABASE_URL: "https://yqkvgfqplmbbcebrivpt.supabase.co",
    SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    WEB_RISK_API_KEY: "clave-web-risk",
    ...options.env,
  };
  const handler = createCrearQrHandler({
    getEnv: (name) => env[name],
    createCallerClient: () => ({
      auth: {
        async getUser() {
          calls.order.push("getUser");
          if (options.userError) return { data: { user: null }, error: true };
          return { data: { user: { id: USUARIO } }, error: null };
        },
      },
    }),
    createServiceClient: async () => ({
      async rpc(name, args) {
        calls.order.push(name);
        calls.rpc.push({ name, args });
        if (name === "qr_motivo_rechazo") {
          return options.cupoError ? { data: null, error: { message: "boom" } } : { data: options.motivo ?? null, error: null };
        }
        if (name === "qr_crear") {
          if (options.crearError) return { data: null, error: { message: options.crearError } };
          return {
            data: {
              id: 7,
              codigo: "k3m9xa",
              destino: args.p_destino,
              titulo: args.p_titulo,
              usuario_id: USUARIO,
              creado_en: "2026-09-28T12:00:00Z",
              vence_en: "2026-10-05T12:00:00Z",
              dominio_confiable: args.p_dominio_confiable,
              web_risk_revisado_en: args.p_web_risk_revisado ? "2026-09-28T12:00:00Z" : null,
            },
            error: null,
          };
        }
        throw new Error(`rpc inesperado ${name}`);
      },
    }),
    fetchImpl: async (url) => {
      calls.order.push("webRisk");
      calls.webRisk.push(new URL(url));
      if (options.webRisk instanceof Error) throw options.webRisk;
      const cuerpo = options.webRisk ?? {};
      return new Response(JSON.stringify(cuerpo), { status: options.webRiskStatus ?? 200 });
    },
    logger: {
      info: (linea) => calls.logs.push(JSON.parse(linea)),
      error: (linea) => calls.logs.push(JSON.parse(linea)),
    },
  });
  return { handler, calls };
}

test("a trusted form link, clean in Web Risk, creates the QR", async () => {
  const { handler, calls } = await harness();
  const response = await handler(pedido());
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
  const cuerpo = await payload(response);
  assert.equal(cuerpo.ok, true);
  assert.equal(cuerpo.qr.codigo, "k3m9xa");
  assert.equal(cuerpo.qr.vence_en, "2026-10-05T12:00:00Z");
  assert.equal(cuerpo.qr.usuario_id, undefined, "no devuelve más de lo necesario");

  assert.deepEqual(calls.order, ["getUser", "qr_motivo_rechazo", "webRisk", "qr_crear"]);
  const crear = calls.rpc.find((llamada) => llamada.name === "qr_crear").args;
  assert.deepEqual(crear, {
    p_usuario: USUARIO,
    p_destino: "https://forms.gle/AbC123",
    p_titulo: "Encuesta",
    p_dominio_confiable: true,
    p_web_risk_revisado: true,
  });
  assert.equal(calls.webRisk[0].searchParams.get("uri"), "https://forms.gle/AbC123");
});

test("the log carries the domain, never the full link", async () => {
  const { handler, calls } = await harness();
  await handler(pedido({ body: { destino: "https://forms.gle/AbC123?entry.1=juan@correo.mx" } }));
  const linea = JSON.stringify(calls.logs.at(-1));
  assert.match(linea, /forms\.gle/);
  assert.doesNotMatch(linea, /juan@correo\.mx/);
});

test("origin, method and session are checked before anything else", async () => {
  const { handler, calls } = await harness();
  assert.equal((await handler(pedido({ origin: "https://sitio-ajeno.com" }))).status, 403);
  assert.equal((await handler(pedido({ origin: undefined }))).status, 403);
  const preflight = await handler(pedido({ method: "OPTIONS" }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-methods"), "POST, OPTIONS");
  assert.equal((await handler(pedido({ method: "GET" }))).status, 405);
  assert.equal((await handler(pedido({ token: undefined }))).status, 401);
  assert.deepEqual(calls.order, [], "nada de lo anterior toca la base ni a Google");

  const local = await harness();
  assert.equal((await local.handler(pedido({ origin: "http://localhost:8181" }))).status, 201,
    "el servidor local (tools/servidor.js) puede crear QR");
});

test("an invalid session is rejected", async () => {
  const { handler, calls } = await harness({ userError: true });
  const response = await handler(pedido());
  assert.equal(response.status, 401);
  assert.equal((await payload(response)).code, "auth_required");
  assert.deepEqual(calls.order, ["getUser"]);
});

test("malformed requests are rejected without touching the database", async () => {
  const { handler, calls } = await harness();
  const casos = [
    [pedido({ body: "no es json" }), 400, "invalid_request"],
    [pedido({ contentType: "text/plain" }), 400, "invalid_request"],
    [pedido({ body: { titulo: "sin destino" } }), 400, "invalid_request"],
    [pedido({ body: { destino: 42 } }), 400, "invalid_request"],
    [pedido({ body: { destino: "https://forms.gle/a", titulo: 7 } }), 400, "invalid_request"],
    [pedido({ body: { destino: "https://forms.gle/a", titulo: "x".repeat(81) } }), 400, "titulo_largo"],
    [pedido({ body: { destino: `https://forms.gle/${"a".repeat(9000)}` } }), 413, "payload_too_large"],
  ];
  for (const [request, status, code] of casos) {
    const response = await handler(request);
    assert.equal(response.status, status, code);
    assert.equal((await payload(response)).code, code);
  }
  assert.deepEqual(calls.rpc, []);
});

test("a link that breaks the rules is rejected with its code, before the database", async () => {
  const { handler, calls } = await harness();
  const acortado = await handler(pedido({ body: { destino: "https://bit.ly/abc" } }));
  assert.equal(acortado.status, 422);
  assert.deepEqual(await payload(acortado), { ok: false, code: "enlace_acortador" });

  const imitado = await handler(pedido({ body: { destino: "https://login-bbva.com/" } }));
  assert.deepEqual(await payload(imitado), { ok: false, code: "enlace_suplantacion", detalle: "BBVA" });
  assert.deepEqual(calls.rpc, []);
  assert.deepEqual(calls.webRisk, []);
});

test("an account that cannot create does not spend a Web Risk lookup", async () => {
  const casos = {
    qr_limite_alcanzado: [409, "limite_alcanzado"],
    qr_cuenta_bloqueada: [403, "cuenta_bloqueada"],
    qr_sin_cuenta: [403, "sin_cuenta"],
    qr_demasiados_hoy: [429, "demasiados_hoy"],
    motivo_desconocido: [503, "no_disponible"],
  };
  for (const [motivo, [status, code]] of Object.entries(casos)) {
    const { handler, calls } = await harness({ motivo });
    const response = await handler(pedido());
    assert.equal(response.status, status, motivo);
    assert.equal((await payload(response)).code, code);
    assert.deepEqual(calls.order, ["getUser", "qr_motivo_rechazo"], `${motivo}: ni Web Risk ni qr_crear`);
  }
  const { handler } = await harness({ cupoError: true });
  assert.equal((await handler(pedido())).status, 503);
});

test("a link Web Risk flags is rejected even from a trusted provider", async () => {
  const { handler, calls } = await harness({ webRisk: { threat: { threatTypes: ["SOCIAL_ENGINEERING"] } } });
  const response = await handler(pedido());
  assert.equal(response.status, 422);
  assert.deepEqual(await payload(response), { ok: false, code: "enlace_peligroso" });
  assert.ok(!calls.order.includes("qr_crear"));
  assert.deepEqual(calls.logs.at(-1).amenazas, ["SOCIAL_ENGINEERING"]);
});

test("if Web Risk is down, trusted providers still pass and are marked as not reviewed", async () => {
  for (const opciones of [{ webRiskStatus: 503 }, { webRisk: new Error("sin red") }, { env: { WEB_RISK_API_KEY: "" } }]) {
    const { handler, calls } = await harness(opciones);
    const response = await handler(pedido());
    assert.equal(response.status, 201, JSON.stringify(Object.keys(opciones)));
    const crear = calls.rpc.find((llamada) => llamada.name === "qr_crear").args;
    assert.equal(crear.p_web_risk_revisado, false);
    assert.equal(crear.p_dominio_confiable, true);
  }
});

test("if Web Risk is down, any other domain waits", async () => {
  for (const opciones of [{ webRiskStatus: 500 }, { env: { WEB_RISK_API_KEY: undefined } }]) {
    const { handler, calls } = await harness(opciones);
    const response = await handler(pedido({ body: { destino: "https://mi-negocio.mx/registro" } }));
    assert.equal(response.status, 503);
    assert.equal((await payload(response)).code, "revision_no_disponible");
    assert.ok(!calls.order.includes("qr_crear"));
  }
});

test("any other domain, clean in Web Risk, is created as not trusted but reviewed", async () => {
  const { handler, calls } = await harness();
  const response = await handler(pedido({ body: { destino: "https://mi-negocio.mx/registro", titulo: "  " } }));
  assert.equal(response.status, 201);
  const crear = calls.rpc.find((llamada) => llamada.name === "qr_crear").args;
  assert.equal(crear.p_dominio_confiable, false);
  assert.equal(crear.p_web_risk_revisado, true);
  assert.equal(crear.p_titulo, null, "un título en blanco viaja como null");
});

test("losing the race for the last slot inside qr_crear maps to the same answer", async () => {
  const { handler } = await harness({ crearError: "qr_limite_alcanzado" });
  const response = await handler(pedido());
  assert.equal(response.status, 409);
  assert.equal((await payload(response)).code, "limite_alcanzado");

  const { handler: otro } = await harness({ crearError: "algo raro" });
  assert.equal((await otro(pedido())).status, 503);
});

test("missing server configuration is an internal error, not a crash", async () => {
  const { handler } = await harness({ env: { SUPABASE_SERVICE_ROLE_KEY: undefined } });
  const response = await handler(pedido());
  assert.equal(response.status, 500);
  assert.equal((await payload(response)).code, "internal_error");
});
