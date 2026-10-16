/* www.taudux.com redirige a taudux.com antes de servir nada.
 *
 * Por qué existe este test. Hasta el 2026-10-16 Vercel servía el sitio en los
 * dos dominios, y "Continuar con Google" fallaba siempre que se entraba por
 * `www`. El `code_verifier` de PKCE quedaba en el storage de `www`; Supabase no
 * tiene `www` en su lista de Redirect URLs (sólo `https://taudux.com/**`), así
 * que devolvía al Site URL, `taudux.com`. Ese origen no tiene el verifier, el
 * canje nunca ocurría y oauth-callback mostraba "No pudimos completar el
 * acceso con Google" a los 8 segundos. Pasó en un iPhone y en una Mac a la vez:
 * no era el navegador, era el dominio.
 *
 * Un solo dominio canónico cierra eso y cualquier otra cosa atada al origen
 * (sesión, "Recordarme", CORS de las edge functions).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const config = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));

test("www.taudux.com redirects permanently to the same path on taudux.com", () => {
  const regla = config.redirects.find((r) =>
    (r.has || []).some((h) => h.type === "host" && h.value === "www.taudux.com")
  );
  assert.ok(regla, "falta la redirección de www.taudux.com");
  // `(.*)` y no `/:path*`: el segundo no captura la barra final, así que "/" y
  // las páginas de carpeta (`/app/features/auth/login/`, justo la del login)
  // se seguían sirviendo desde www. Pasó en producción el 2026-10-16.
  assert.equal(regla.source, "/:path(.*)", "debe cubrir todas las rutas, con barra final incluida");
  assert.equal(regla.destination, "https://taudux.com/:path", "debe conservar la ruta");
  assert.equal(regla.permanent, true);
});

test("the www redirect runs before every other redirect", () => {
  // Primero el dominio y después /src/: así www.taudux.com/src/x llega a
  // taudux.com/x en dos saltos que ya resuelven en el origen correcto, y
  // ninguna otra regla puede responder desde www.
  const indice = config.redirects.findIndex((r) =>
    (r.has || []).some((h) => h.type === "host" && h.value === "www.taudux.com")
  );
  assert.equal(indice, 0);
});
