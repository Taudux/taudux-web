// crear-qr: el ÚNICO camino para crear un QR (0044 no concede insert a nadie
// desde el navegador).
//
// Orden de la revisión, y por qué ese orden:
//   1. Origen y sesión: sólo cuentas de Taudux crean QR.
//   2. Reglas del link (_shared/revisarEnlace.mjs): gratis, sin red.
//   3. ¿La cuenta puede crear? (qr_motivo_rechazo): ANTES de Web Risk, para no
//      gastar una consulta en alguien que llegó a su límite o está bloqueado.
//   4. Google Web Risk. Si no responde, sólo pasan los dominios de la lista
//      confiable; cualquier otro espera a que Web Risk vuelva.
//   5. qr_crear: vuelve a verificar el cupo dentro de un candado y crea.
//
// Los `code` de las respuestas son estables: qr.nucleo.js los traduce a
// mensajes para la persona.

import { consultarWebRisk, evaluarEnlace } from "../_shared/revisarEnlace.mjs";

const PRODUCTION_ORIGINS = new Set(["https://taudux.com"]);
const MAX_BODY_BYTES = 8 * 1024;
export const TITULO_MAXIMO = 80;

// Motivo de 0044 → respuesta HTTP.
const RECHAZOS_DE_CUENTA = Object.freeze({
  qr_sin_cuenta: [403, "sin_cuenta"],
  qr_cuenta_bloqueada: [403, "cuenta_bloqueada"],
  qr_limite_alcanzado: [409, "limite_alcanzado"],
  qr_demasiados_hoy: [429, "demasiados_hoy"],
});

class ClientError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function allowedOrigin(origin) {
  if (!origin || origin === "null") return false;
  if (PRODUCTION_ORIGINS.has(origin)) return true;
  try {
    const url = new URL(origin);
    return url.origin === origin && url.protocol === "http:" && Boolean(url.port) &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

function corsHeaders(origin) {
  const result = { "Content-Type": "application/json; charset=utf-8", "Vary": "Origin" };
  if (origin) {
    result["Access-Control-Allow-Origin"] = origin;
    result["Access-Control-Allow-Headers"] = "authorization, x-client-info, apikey, content-type";
    result["Access-Control-Allow-Methods"] = "POST, OPTIONS";
  }
  return result;
}

async function boundedJson(request) {
  const type = request.headers.get("content-type") || "";
  if (!/^application\/json(?:;|$)/i.test(type) || !request.body) {
    throw new ClientError(400, "invalid_request");
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > MAX_BODY_BYTES) {
    throw new ClientError(413, "payload_too_large");
  }
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      reader.cancel();
      throw new ClientError(413, "payload_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ClientError(400, "invalid_request");
  }
}

// { destino, titulo? } → valores limpios, o ClientError.
function leerPedido(cuerpo) {
  if (!cuerpo || typeof cuerpo !== "object" || Array.isArray(cuerpo) || typeof cuerpo.destino !== "string") {
    throw new ClientError(400, "invalid_request");
  }
  if (cuerpo.titulo !== undefined && cuerpo.titulo !== null && typeof cuerpo.titulo !== "string") {
    throw new ClientError(400, "invalid_request");
  }
  const titulo = (cuerpo.titulo ?? "").trim();
  if (titulo.length > TITULO_MAXIMO) throw new ClientError(400, "titulo_largo");
  return { destino: cuerpo.destino, titulo: titulo || null };
}

function firstRow(data) {
  return Array.isArray(data) ? data[0] : data;
}

// Lo que vuelve al navegador: lo que la persona ya puede leer de su propio QR.
function qrPublico(fila) {
  return {
    id: fila.id,
    codigo: fila.codigo,
    destino: fila.destino,
    titulo: fila.titulo,
    creado_en: fila.creado_en,
    vence_en: fila.vence_en,
    dominio_confiable: fila.dominio_confiable,
  };
}

export function createCrearQrHandler(overrides = {}) {
  const dependencies = {
    getEnv: (name) => globalThis.Deno?.env?.get(name),
    fetchImpl: globalThis.fetch?.bind(globalThis),
    createCallerClient: createFetchCallerClient,
    createServiceClient: createSupabaseServiceClient,
    logger: globalThis.console,
    now: () => globalThis.performance?.now?.() ?? Date.now(),
    ...overrides,
  };

  return async function handleCrearQr(request) {
    const started = dependencies.now();
    let responseOrigin = null;
    // `detalle` va al log y NUNCA el link completo: puede traer datos de la
    // persona en la query (formularios prellenados). El dominio alcanza.
    const finish = (status, code, payload, origin, detalle = {}) => {
      const event = {
        event: "crear_qr",
        code,
        status,
        durationMs: Math.max(0, Math.round(dependencies.now() - started)),
        ...detalle,
      };
      dependencies.logger[status >= 400 ? "error" : "info"](JSON.stringify(event));
      return new Response(payload === null ? null : JSON.stringify(payload), {
        status,
        headers: corsHeaders(origin),
      });
    };
    const falla = (status, code, origin, extra = {}, detalle = {}) =>
      finish(status, code, { ok: false, code, ...extra }, origin, detalle);

    try {
      const requestOrigin = request.headers.get("origin");
      const origin = allowedOrigin(requestOrigin) ? requestOrigin : null;
      if (!origin) return falla(403, "invalid_origin", null);
      responseOrigin = origin;
      if (request.method === "OPTIONS") return finish(204, "preflight_ok", null, origin);
      if (request.method !== "POST") return falla(405, "method_not_allowed", origin);

      const authorization = request.headers.get("authorization");
      if (!authorization) return falla(401, "auth_required", origin);
      const projectUrl = dependencies.getEnv("SUPABASE_URL");
      const anonKey = dependencies.getEnv("SUPABASE_ANON_KEY");
      const serviceRole = dependencies.getEnv("SUPABASE_SERVICE_ROLE_KEY");
      if (!projectUrl || !anonKey || !serviceRole) return falla(500, "internal_error", origin);

      const caller = dependencies.createCallerClient({
        projectUrl,
        anonKey,
        authorization,
        fetchImpl: dependencies.fetchImpl,
      });
      const { data: userData, error: userError } = await caller.auth.getUser();
      const usuarioId = userData?.user?.id;
      if (userError || typeof usuarioId !== "string") return falla(401, "auth_required", origin);

      let pedido;
      try {
        pedido = leerPedido(await boundedJson(request));
      } catch (error) {
        const known = error instanceof ClientError ? error : new ClientError(400, "invalid_request");
        return falla(known.status, known.code, origin);
      }

      const evaluacion = evaluarEnlace(pedido.destino);
      if (!evaluacion.ok) {
        const extra = evaluacion.detalle ? { detalle: evaluacion.detalle } : {};
        return falla(422, evaluacion.codigo, origin, extra);
      }
      const host = new URL(evaluacion.url).hostname;

      const service = await dependencies.createServiceClient({ projectUrl, serviceRole });
      const cupo = await service.rpc("qr_motivo_rechazo", { p_usuario: usuarioId });
      if (cupo.error) return falla(503, "no_disponible", origin);
      if (cupo.data) {
        const [status, code] = RECHAZOS_DE_CUENTA[cupo.data] ?? [503, "no_disponible"];
        return falla(status, code, origin);
      }

      const webRisk = await consultarWebRisk({
        url: evaluacion.url,
        apiKey: dependencies.getEnv("WEB_RISK_API_KEY"),
        fetchImpl: dependencies.fetchImpl,
      });
      if (webRisk.estado === "peligroso") {
        return falla(422, "enlace_peligroso", origin, {}, { host, amenazas: webRisk.amenazas });
      }
      const revisado = webRisk.estado === "limpio";
      if (!revisado && !evaluacion.confiable) {
        return falla(503, "revision_no_disponible", origin, {}, { host, webRisk: webRisk.estado });
      }

      const creado = await service.rpc("qr_crear", {
        p_usuario: usuarioId,
        p_destino: evaluacion.url,
        p_titulo: pedido.titulo,
        p_dominio_confiable: evaluacion.confiable,
        p_web_risk_revisado: revisado,
      });
      if (creado.error) {
        // La carrera que el candado de qr_crear resuelve: entre la verificación
        // de arriba y este alta, otra pestaña ocupó el último lugar.
        const [status, code] = RECHAZOS_DE_CUENTA[creado.error.message] ?? [503, "no_disponible"];
        return falla(status, code, origin);
      }
      const fila = firstRow(creado.data);
      if (!fila?.codigo) return falla(503, "no_disponible", origin);

      return finish(201, "qr_creado", { ok: true, qr: qrPublico(fila) }, origin, {
        host,
        confiable: evaluacion.confiable,
        webRisk: webRisk.estado,
      });
    } catch {
      return falla(500, "internal_error", responseOrigin);
    }
  };
}

function createFetchCallerClient({ projectUrl, anonKey, authorization, fetchImpl }) {
  const headers = { apikey: anonKey, Authorization: authorization };
  return {
    auth: {
      async getUser() {
        const response = await fetchImpl(`${projectUrl}/auth/v1/user`, { headers });
        if (!response.ok) return { data: { user: null }, error: true };
        const user = await response.json();
        return { data: { user }, error: user?.id ? null : true };
      },
    },
  };
}

async function createSupabaseServiceClient({ projectUrl, serviceRole }) {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(projectUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

// Keep platform JWT verification enabled when deploying this browser endpoint.
if (globalThis.Deno && typeof globalThis.Deno.serve === "function") {
  globalThis.Deno.serve(createCrearQrHandler());
}
