// revisar-qr: la revisión diaria. Vuelve a pasar por Google Web Risk los QR
// activos, porque un link sano al crearse puede volverse malicioso después (un
// dominio que se vende, un sitio que se compromete). Si Web Risk lo marca, el
// QR se bloquea y deja de redirigir.
//
// La llama pg_cron (0045) una vez al día. La autoriza SÓLO la cabecera
// x-taudux-qr-secret, comparada en tiempo constante contra QR_CRON_SECRET; el
// Authorization que manda pg_cron es la anon key pública y no autoriza nada.
//
// Si Web Risk falla con un QR, ese QR se salta y queda pendiente para mañana:
// no se bloquea nada por un error de red.

import { consultarWebRisk } from "../_shared/revisarEnlace.mjs";

// Cuántos QR se revisan por corrida, y cuánto tiempo como máximo. Lo que no
// alcance queda pendiente (qr_pendientes_revision ordena los más atrasados
// primero), así que un día con muchos QR se reparte en varios.
export const LOTE = 300;
export const PRESUPUESTO_MS = 45000;

function constantTimeEquals(a, b) {
  const left = String(a ?? "");
  const right = String(b ?? "");
  const length = Math.max(left.length, right.length);
  let diff = left.length === right.length ? 0 : 1;
  for (let index = 0; index < length; index++) {
    const leftCode = index < left.length ? left.charCodeAt(index) : 0;
    const rightCode = index < right.length ? right.charCodeAt(index) : 0;
    diff |= leftCode ^ rightCode;
  }
  return diff === 0;
}

export function createRevisarQrHandler(overrides = {}) {
  const dependencies = {
    getEnv: (name) => globalThis.Deno?.env?.get(name),
    fetchImpl: globalThis.fetch?.bind(globalThis),
    createServiceClient: createSupabaseServiceClient,
    logger: globalThis.console,
    now: () => globalThis.performance?.now?.() ?? Date.now(),
    ...overrides,
  };

  return async function handleRevisarQr(request) {
    const started = dependencies.now();
    const finish = (status, code, payload) => {
      const event = {
        event: "revisar_qr",
        code,
        status,
        durationMs: Math.max(0, Math.round(dependencies.now() - started)),
        ...(payload?.ok ? payload : {}),
      };
      dependencies.logger[status >= 400 ? "error" : "info"](JSON.stringify(event));
      return new Response(JSON.stringify(payload), {
        status,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    };

    try {
      if (request.method !== "POST") {
        return finish(405, "method_not_allowed", { ok: false, code: "method_not_allowed" });
      }
      const secreto = dependencies.getEnv("QR_CRON_SECRET");
      if (typeof secreto !== "string" || secreto.length === 0 ||
          !constantTimeEquals(request.headers.get("x-taudux-qr-secret"), secreto)) {
        return finish(401, "unauthorized", { ok: false, code: "unauthorized" });
      }

      const apiKey = dependencies.getEnv("WEB_RISK_API_KEY");
      const projectUrl = dependencies.getEnv("SUPABASE_URL");
      const serviceRole = dependencies.getEnv("SUPABASE_SERVICE_ROLE_KEY");
      if (!apiKey) return finish(503, "web_risk_sin_configurar", { ok: false, code: "web_risk_sin_configurar" });
      if (!projectUrl || !serviceRole) return finish(500, "internal_error", { ok: false, code: "internal_error" });

      const service = await dependencies.createServiceClient({ projectUrl, serviceRole });
      const { data: pendientes, error } = await service.rpc("qr_pendientes_revision", { p_limite: LOTE });
      if (error || !Array.isArray(pendientes)) {
        return finish(503, "no_disponible", { ok: false, code: "no_disponible" });
      }

      const resumen = { ok: true, pendientes: pendientes.length, revisados: 0, bloqueados: 0, errores: 0 };
      for (const { id, destino } of pendientes) {
        if (dependencies.now() - started > PRESUPUESTO_MS) break;
        const resultado = await consultarWebRisk({ url: destino, apiKey, fetchImpl: dependencies.fetchImpl });
        if (resultado.estado !== "limpio" && resultado.estado !== "peligroso") {
          resumen.errores++;
          continue;
        }
        const { error: errorRegistro } = await service.rpc("qr_registrar_revision", {
          p_id: id,
          p_amenazas: resultado.amenazas,
        });
        if (errorRegistro) {
          resumen.errores++;
          continue;
        }
        resumen.revisados++;
        if (resultado.estado === "peligroso") resumen.bloqueados++;
      }
      return finish(200, "revision_completa", resumen);
    } catch {
      return finish(500, "internal_error", { ok: false, code: "internal_error" });
    }
  };
}

async function createSupabaseServiceClient({ projectUrl, serviceRole }) {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(projectUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

// Keep platform JWT verification enabled: pg_cron sends the public anon key as
// Authorization only to satisfy it. Authorization for this function is the
// x-taudux-qr-secret header alone, compared in constant time.
if (globalThis.Deno && typeof globalThis.Deno.serve === "function") {
  globalThis.Deno.serve(createRevisarQrHandler());
}
