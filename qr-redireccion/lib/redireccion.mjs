// El redireccionador de go.taudux.com: lo que pasa cuando alguien escanea un QR.
//
// Lógica pura con la consulta inyectada, para que los tests de Node la corran
// sin Supabase (tests/qr-redireccion.test.js). api/r.js la conecta con la
// base a través de qr_resolver() (0044), con la service_role key.
//
// QUÉ GUARDA DE QUIEN ESCANEA: país (lo resuelve Vercel) y tipo de
// dispositivo (lo clasifica esto). Nunca la IP ni el user agent completo.

// Mismo formato que el CHECK de public.qr_codigos: 6 caracteres sin 0/o/1/l/i.
export const CODIGO_VALIDO = /^[2-9a-hjkmnp-z]{6}$/;

export const URL_GENERADOR = "https://taudux.com/app/features/qr/";
export const URL_REPORTAR = "https://taudux.com/app/features/qr/reportar.html";

// Las páginas de aviso no cargan nada de afuera: ni fuentes ni imágenes. El
// isotipo va dibujado en el propio HTML.
const CABECERAS_PAGINA = Object.freeze({
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex",
});

export function clasificarDispositivo(userAgent) {
  const ua = String(userAgent ?? "");
  if (!ua) return "otro";
  if (/iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i.test(ua)) return "tableta";
  if (/Mobi|iPhone|iPod|Android|BlackBerry|Opera Mini|IEMobile/i.test(ua)) return "movil";
  if (/Windows NT|Macintosh|X11|Linux x86_64|CrOS/i.test(ua)) return "escritorio";
  return "otro";
}

const ISOTIPO = `<svg class="isotipo" viewBox="0 0 100 100" aria-hidden="true">
  <polygon fill="#1249a4" points="46,6 2,50 46,94 46,80 16,50 46,20"/>
  <polygon fill="#29c2e2" points="54,6 98,50 54,94 54,80 84,50 54,20"/>
  <polygon fill="#1249a4" points="50,28 28,50 50,72"/>
  <polygon fill="#29c2e2" points="50,28 72,50 50,72"/>
</svg>`;

// Los textos son fijos. Lo único de la petición que llega al HTML es el
// código, y sólo si ya pasó CODIGO_VALIDO (6 caracteres de [2-9a-hjkmnp-z]):
// no hay nada que escapar.
function pagina(estado, titulo, detalle, { conInvitacion = false, codigo = null, urlReportar = URL_REPORTAR } = {}) {
  const invitacion = conInvitacion
    ? `<a class="boton" href="${URL_GENERADOR}">Crea tu propio QR en Taudux</a>`
    : `<a class="enlace" href="https://taudux.com">Ir a taudux.com</a>`;
  const reportar = `<a class="reportar" href="${urlReportar}${codigo ? `?codigo=${codigo}` : ""}">Reportar este QR</a>`;
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${titulo} | Taudux</title>
<style>
  *{box-sizing:border-box;margin:0}
  body{min-height:100vh;display:grid;place-items:center;padding:1.5rem;background:#0d0f11;color:#fff;
    font-family:"Space Grotesk",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  main{max-width:26rem;text-align:center;display:grid;gap:1.1rem;justify-items:center}
  .isotipo{width:4.5rem;height:4.5rem}
  h1{font-size:1.45rem;line-height:1.3}
  p{color:#ccc;line-height:1.6}
  .boton{display:inline-block;padding:.8rem 1.6rem;border:1px solid #00e1ff;border-radius:10px;color:#fff;
    text-decoration:none;box-shadow:0 0 16px rgba(0,225,255,.35)}
  .enlace{color:#00e1ff}
  .reportar{margin-top:.6rem;color:#aab4c8;font-size:.9rem}
</style>
</head>
<body>
<main>
${ISOTIPO}
<h1>${titulo}</h1>
<p>${detalle}</p>
${invitacion}
${reportar}
</main>
</body>
</html>`;
  return new Response(html, { status: estado, headers: CABECERAS_PAGINA });
}

/*
  Todas llevan "Reportar este QR": un QR que ya no funciona puede haber
  llevado a algo malo antes, y quien lo escaneó es quien puede contarlo. Un QR
  activo redirige al instante y no pasa por acá: para esos, el formulario se
  enlaza desde los términos del generador.
*/
export const PAGINAS = Object.freeze({
  inexistente: (opciones) => pagina(404, "Este QR no existe", "Puede que lo hayan eliminado, o que el código esté mal escrito.", opciones),
  // 410 Gone y no 404: el QR sí existió, y a los buscadores y lectores les
  // dice que no vuelvan a intentar.
  vencido: (opciones) => pagina(410, "Este QR venció", "Los QR gratis de Taudux duran 7 días, y éste ya cumplió su plazo.", { ...opciones, conInvitacion: true }),
  bloqueado: (opciones) => pagina(410, "Este QR fue desactivado", "Por seguridad, este QR ya no lleva a ningún sitio.", opciones),
  error: (opciones) => pagina(503, "No pudimos abrir este QR", "Intenta escanearlo de nuevo en unos segundos.", opciones),
});

/*
  `resolver({ codigo, pais, dispositivo })` → { estado, destino }. En la
  práctica es qr_resolver() de 0044; en los tests, una función falsa.
*/
export function crearManejador({ resolver, logger = console, urlReportar = URL_REPORTAR }) {
  return async function GET(request) {
    const url = new URL(request.url);
    const codigo = String(url.searchParams.get("codigo") ?? "").trim().toLowerCase();
    if (!CODIGO_VALIDO.test(codigo)) return PAGINAS.inexistente({ urlReportar });
    const opciones = { codigo, urlReportar };

    let resultado;
    try {
      resultado = await resolver({
        codigo,
        pais: request.headers.get("x-vercel-ip-country"),
        dispositivo: clasificarDispositivo(request.headers.get("user-agent")),
      });
    } catch (error) {
      logger.error(JSON.stringify({ event: "qr_resolver", codigo, error: String(error?.message ?? error) }));
      return PAGINAS.error(opciones);
    }

    if (resultado?.estado === "activo" && /^https:\/\//.test(resultado.destino ?? "")) {
      // 302 y no 301: el navegador no debe recordar el destino. Con 301, un QR
      // bloqueado por phishing seguiría abriendo el sitio en quien ya lo escaneó.
      return new Response(null, {
        status: 302,
        headers: { Location: resultado.destino, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
      });
    }
    if (resultado?.estado === "vencido") return PAGINAS.vencido(opciones);
    if (resultado?.estado === "bloqueado") return PAGINAS.bloqueado(opciones);
    return PAGINAS.inexistente(opciones);
  };
}

// La consulta real, a qr_resolver() con la service_role key. supabase-js se
// importa aquí adentro para que los tests no lo necesiten instalado.
export function crearResolverSupabase({ url, llave }) {
  let cliente = null;
  return async function resolver({ codigo, pais, dispositivo }) {
    if (!cliente) {
      const { createClient } = await import("@supabase/supabase-js");
      cliente = createClient(url, llave, { auth: { persistSession: false, autoRefreshToken: false } });
    }
    const { data, error } = await cliente.rpc("qr_resolver", {
      p_codigo: codigo,
      p_pais: pais,
      p_dispositivo: dispositivo,
    });
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data[0] : data;
  };
}
