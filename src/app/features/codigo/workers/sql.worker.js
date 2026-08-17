/*
  Worker de SQL (PGlite: Postgres real compilado a WebAssembly). Mismo motivo que
  el worker de Python para vivir fuera del hilo principal: una consulta cara —un
  join sin condición sobre dos tablas generadas— bloquea hasta terminar, y desde
  el hilo principal no habría forma de cortarla.

  La base es EN MEMORIA y a propósito. PGlite sabe persistir en IndexedDB, pero en
  un playground eso vuelve el `create table` del ejemplo un error de "ya existe" en
  la segunda visita. Acá cada pestaña arranca limpia; la persistencia tiene sentido
  más adelante, cuando cada ejercicio siembre su propio esquema.

  Este worker no formatea nada: devuelve las filas crudas de PGlite y el hilo
  principal las convierte con formatearTablaSql (practica.salida.js), que es donde
  esa lógica se puede probar sin navegador.

  Protocolo de mensajes (idéntico al de python.worker.js):
    recibe { tipo: "cargar", runtime: { url } }
    recibe { tipo: "ejecutar", codigo }
    emite  { tipo: "progreso", etapa }
           { tipo: "listo" }
           { tipo: "resultado", ok, resultados, error }
*/

let db = null;

async function cargar(runtime) {
  self.postMessage({ tipo: "progreso", etapa: "Descargando Postgres…" });
  const { PGlite } = await import(runtime.url);

  self.postMessage({ tipo: "progreso", etapa: "Iniciando base de datos…" });
  db = new PGlite();
  await db.waitReady;

  self.postMessage({ tipo: "listo" });
}

/*
  `exec` (no `query`) porque el alumno escribe varias sentencias seguidas: crea la
  tabla, inserta y consulta en la misma corrida. Devuelve un resultado por
  sentencia, en orden, y así cada select puede pintar su propia tabla.
*/
async function ejecutar(codigo) {
  try {
    const resultados = await db.exec(codigo);

    self.postMessage({
      tipo: "resultado",
      ok: true,
      /*
        Solo lo que sobrevive a structuredClone: PGlite adjunta al resultado cosas
        como el statement original y blobs que no cruzan el límite del worker.
      */
      resultados: resultados.map((resultado) => ({
        fields: (resultado.fields || []).map((campo) => ({ name: campo.name })),
        rows: resultado.rows || [],
        affectedRows: resultado.affectedRows || 0,
      })),
      error: null,
    });
  } catch (error) {
    /*
      Un error de Postgres trae position/hint/detail además del mensaje. Se arman
      en un solo texto porque el "position" es justo lo que le dice al alumno en
      qué carácter de su consulta está el problema.
    */
    const partes = [error?.message || String(error)];
    if (error?.detail) partes.push(`Detalle: ${error.detail}`);
    if (error?.hint) partes.push(`Sugerencia: ${error.hint}`);
    if (error?.position) partes.push(`Posición: ${error.position}`);

    self.postMessage({
      tipo: "resultado",
      ok: false,
      resultados: [],
      error: partes.join("\n"),
    });
  }
}

self.addEventListener("message", async (evento) => {
  const mensaje = evento.data || {};

  try {
    if (mensaje.tipo === "cargar") {
      await cargar(mensaje.runtime);
      return;
    }

    if (mensaje.tipo === "ejecutar") {
      await ejecutar(mensaje.codigo);
    }
  } catch (error) {
    self.postMessage({ tipo: "error", mensaje: error?.message || String(error) });
  }
});
