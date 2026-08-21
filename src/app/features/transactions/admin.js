/* Panel de administración del extractor: lista las cuentas del sitio y su rol.
 *
 * Portado del proyecto original con un cambio de fondo: allá la página vivía
 * detrás de un servidor que ya había comprobado quién entraba, así que el
 * JavaScript no verificaba nada. Servida por Vercel esa suposición se cae —
 * cualquiera puede pedir la URL—, así que acá el contenido se revela sólo
 * después de `asegurarAdmin()`, el mismo arranque que usan las pantallas de
 * administración de cursos.
 *
 * Traía además tres cosas que se quitaron el 2026-08-20, todas por el mismo
 * motivo: mostraban datos que no eran ciertos.
 *
 *   · El alta de accesos ilimitados no otorgaba nada — indexaba por
 *     `user:<correo>` cuando la identidad en producción es `user:<uuid>`
 *     (hallazgo F30).
 *   · El consumo del mes leía el estado en memoria de UNA instancia de Cloud
 *     Run: con `--max-instances 3` cada administrador veía otra cosa, y un
 *     reinicio lo borraba (hallazgo F25).
 *   · Los paneles internos volcaban el JSON crudo de esas mismas fuentes.
 *
 * Con ellas se fue `apiFetch`: lo que queda sale de Supabase, no de Cloud Run.
 *
 * Depende de: admin-startup.js, auth.service.js, supabase-client.js.
 */
(() => {
  "use strict";

  const el = (id) => document.getElementById(id);

  const escapar = (valor) => String(valor ?? "").replace(
    /[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c])
  );

  // --- Usuarios del sitio --------------------------------------------------

  /*
    Los usuarios REALES, leídos de `perfiles`. Están todos, hayan usado la
    herramienta o no, con el rol que de verdad tienen, y siguen ahí después de
    un reinicio: por eso es la única lista que sobrevivió a la limpieza del
    2026-08-20 — la de consumo salía de la memoria del servicio y se vaciaba
    cuando Cloud Run apagaba el contenedor.

    Se lee con la clave `anon` y el token de quien abre el panel: la policy
    `perfiles_select_admin` (migración 0031) decide si puede ver más que su
    propia fila. Sin ser administrador esto devuelve una sola fila, y eso es
    exactamente lo que tiene que pasar.

    El correo NO viene, y no es un olvido: vive en `auth.users`, fuera del
    alcance del cliente, y este sitio nunca lo ha entregado al navegador.
  */
  async function cargarUsuariosDelSitio() {
    const lista = el("listaPerfiles");

    const { data, error } = await supabaseClient
      .from("perfiles")
      .select("id, nombre, apellidos, rol, creado_en")
      .order("rol", { ascending: true })
      .order("creado_en", { ascending: false });

    if (error) {
      lista.innerHTML = '<p class="admin__vacio">No pudimos leer los perfiles.</p>';
      console.warn("[admin] fallo al leer perfiles:", error);
      return;
    }

    const perfiles = data || [];
    el("totalPerfiles").textContent = `· ${perfiles.length}`;

    if (!perfiles.length) {
      lista.innerHTML = '<p class="admin__vacio">No hay perfiles que mostrar.</p>';
      return;
    }

    // Administración primero: es lo que se busca al abrir esta lista.
    const orden = [...perfiles].sort(
      (a, b) => Number(b.rol === "admin") - Number(a.rol === "admin"));

    lista.innerHTML = orden.map((p) => {
      const nombre = [p.nombre, p.apellidos].filter(Boolean).join(" ").trim();
      const esAdmin = p.rol === "admin";
      return `
        <div class="admin__fila${esAdmin ? " admin__fila--ilimitado" : ""}">
          <div class="admin__quien">
            <span class="admin__usuario">${escapar(nombre || "(sin nombre)")}</span>
            <span class="admin__meta">${escapar(p.id)}</span>
          </div>
          <span class="admin__insignia">${escapar(p.rol)}</span>
        </div>`;
    }).join("");
  }

  // --- Arranque ------------------------------------------------------------

  async function iniciar() {
    const arranque = crearArranqueAdmin({
      pagina: "extractor_admin",
      tituloError: "No se pudo abrir la administración del extractor",
      // Sin esto vuelve al catálogo de cursos, que es el destino heredado de
      // las pantallas para las que se escribió este arranque. Quien intenta
      // abrir la administración del extractor sin permiso tiene que aterrizar
      // en el extractor, no en una lista de cursos que no pidió.
      rutaRechazo: "/app/features/transactions/",
    });

    // Nada del panel se revela antes de esto: `asegurarAdmin` exige sesión Y
    // rol. Quedarse en la sesión dejaría el panel abierto a cualquiera con
    // cuenta, que es justo lo que no puede pasar acá.
    const inicio = arranque.iniciarTiempo();
    if (!(await arranque.asegurarAdmin(inicio))) return;

    // `asegurarAdmin` COMPRUEBA, `revelar` MUESTRA. Son dos pasos y hay que dar
    // los dos: sin esta línea el rol se verifica correctamente, la consola no
    // dice nada, y la pantalla se queda con el loader girando para siempre —
    // porque nadie destapa el contenido. Las tres pantallas de cursos la
    // llaman; yo la había omitido.
    arranque.revelar();

    // Sin listeners que registrar: los que había colgaban del alta de accesos
    // y de los paneles internos, y esos botones ya no existen en el markup.
    cargarUsuariosDelSitio();
  }

  /*
    Se arranca YA, no en `DOMContentLoaded`.

    Este script va al final del `<body>`: cuando corre, el DOM ya está parseado
    y **ese evento probablemente ya disparó**. Registrar el listener entonces es
    esperar algo que no va a volver a ocurrir — `iniciar()` no se ejecutaba
    nunca, el gate no llegaba a correr, y el loader giraba para siempre sin un
    solo error en consola. Eso pasó el 2026-08-19 y costó encontrarlo justamente
    porque nada fallaba: simplemente no arrancaba.

    Es lo que hace `administrar-cursos.js`, del que salió este markup. El guard
    por `readyState` cubre además el caso de que alguien mueva el `<script>` al
    `<head>`, donde el DOM todavía no existiría.
  */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iniciar);
  } else {
    iniciar();
  }
})();
