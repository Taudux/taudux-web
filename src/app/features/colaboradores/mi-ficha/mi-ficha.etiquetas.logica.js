/*
  Comportamiento del editor de etiquetas de "Mi ficha": buscar en el catálogo,
  agregar, quitar y reordenar. Sin DOM y sin fetch, como el resto de los
  archivos .logica.js del proyecto.

  Depende de mi-ficha.logica.js (LIMITES_MI_FICHA, MENSAJES_MI_FICHA y
  errorDeElementoEtiquetaMiFicha) y debe cargarse después de él, igual que
  notas.grafo.js depende de notas.arbol.js. Va aparte porque son dos
  responsabilidades: allá se valida la ficha completa contra los CHECK de la
  0039 antes de enviarla, acá se decide qué pasa cuando alguien teclea. Los
  nombres son agnósticos al campo: hoy sólo lo instancian las herramientas,
  pero mañana también lo van a usar Habilidades e Idiomas, cada uno con su
  propia clave en LIMITES_MI_FICHA y MENSAJES_MI_FICHA.

  El catálogo es la lista blanca de lo que se puede AGREGAR (2026-10-13): el
  editor sólo agrega lo que se elige de las sugerencias, nunca texto libre.
  agregarEtiqueta() sigue validando cada elemento contra los CHECK de la base
  porque protege lo que llegue por cualquier camino, y las etiquetas ya
  guardadas que no estén en el catálogo se conservan y se muestran: el
  catálogo sólo decide qué se ofrece de ahora en adelante.
*/

// Cuántas sugerencias se devuelven a lo sumo. El catálogo tiene ~175 entradas
// y "a" coincide con media lista, pero desde 2026-10-13 el desplegable ocupa su
// propio lugar en el flujo y scrollea por dentro (unas 5 filas visibles), así
// que ya no tapa la página: el tope sólo evita pintar cientos de filas.
const MAXIMO_SUGERENCIAS_ETIQUETAS = 50;

/*
  La clave con la que se compara y se busca: sin acentos, en minúsculas y con
  los espacios colapsados. Es lo que hace que "postgresql", "PostgreSQL" y
  "  PostgreSQL  " sean la misma etiqueta, tanto para no repetirla como para
  encontrarla mientras se escribe.
*/
function normalizarClaveEtiqueta(texto) {
  if (typeof texto !== "string") return "";
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/*
  Agrega al final. Devuelve { ok: true, lista } con un arreglo NUEVO, o
  { ok: false, motivo, lista } con el mismo de entrada: quien llama pinta el
  motivo y no tiene que adivinar si algo cambió.

  `campo` es la clave en LIMITES_MI_FICHA y MENSAJES_MI_FICHA (hoy siempre
  "herramientas"): de ahí sale el máximo de elementos y los mensajes por
  motivo.

  Motivos: "vacio" (no se escribió nada), "muchas" (ya se llegó al máximo),
  "duplicado" (con el `indice` de la que ya está, para poder señalarla) y los
  dos que decide mi-ficha.logica.js por elemento, "caracteres" y "largo".
*/
function agregarEtiqueta(campo, lista, textoCrudo) {
  const actual = Array.isArray(lista) ? lista : [];
  const texto = typeof textoCrudo === "string" ? textoCrudo.trim() : "";

  if (texto === "") return { ok: false, motivo: "vacio", lista: actual };
  if (actual.length >= LIMITES_MI_FICHA[campo].max) {
    return { ok: false, motivo: "muchas", lista: actual };
  }

  // El mismo veredicto por elemento que corre al enviar la ficha: lo que el
  // editor deja entrar es exactamente lo que la base va a aceptar.
  const error = errorDeElementoEtiquetaMiFicha(campo, texto);
  if (error !== null) {
    return {
      ok: false,
      motivo: error === MENSAJES_MI_FICHA[campo].largo ? "largo" : "caracteres",
      lista: actual,
    };
  }

  const clave = normalizarClaveEtiqueta(texto);
  const indice = actual.findIndex((elemento) => normalizarClaveEtiqueta(elemento) === clave);
  if (indice !== -1) return { ok: false, motivo: "duplicado", indice, lista: actual };

  return { ok: true, lista: [...actual, texto] };
}

/*
  Quita la de esa posición. Un índice que no apunta a ninguna devuelve el
  mismo arreglo —no una copia—, así quien llama puede comparar por identidad
  para saber si hace falta repintar.
*/
function quitarEtiqueta(lista, indice) {
  const actual = Array.isArray(lista) ? lista : [];
  if (!Number.isInteger(indice) || indice < 0 || indice >= actual.length) return actual;
  return actual.filter((_, posicion) => posicion !== indice);
}

/*
  Mueve una etiqueta de `origen` a `destino`. El destino se acota a los bordes
  en vez de rebotar o dar la vuelta, mismo criterio que moverSeleccion() en el
  roster: quien arrastra hasta el borde espera que se quede ahí. Un origen
  inválido o un movimiento que no mueve devuelven el mismo arreglo.
*/
function moverEtiqueta(lista, origen, destino) {
  const actual = Array.isArray(lista) ? lista : [];
  if (!Number.isInteger(origen) || origen < 0 || origen >= actual.length) return actual;
  if (!Number.isInteger(destino)) return actual;

  const acotado = Math.min(Math.max(destino, 0), actual.length - 1);
  if (acotado === origen) return actual;

  const movido = [...actual];
  const [etiqueta] = movido.splice(origen, 1);
  movido.splice(acotado, 0, etiqueta);
  return movido;
}

/*
  Las sugerencias para lo que se lleva escrito. Por substring y no por
  prefijo, para que "gres" encuentre "PostgreSQL"; la consecuencia asumida es
  que una abreviatura que no es parte del nombre no funciona ("js" no
  encuentra "JavaScript").

  Las que empiezan por la consulta van primero —es lo que se espera al teclear
  "post"— y dentro de cada grupo se respeta el orden del catálogo. Lo que ya
  está elegido no se ofrece: elegirlo sólo daría el aviso de duplicado.
*/
function sugerenciasDeEtiqueta(catalogo, consulta, yaElegidas = [], limite = MAXIMO_SUGERENCIAS_ETIQUETAS) {
  const lista = Array.isArray(catalogo) ? catalogo : [];
  const clave = normalizarClaveEtiqueta(consulta);
  if (clave === "") return [];

  const excluidas = new Set(
    (Array.isArray(yaElegidas) ? yaElegidas : []).map(normalizarClaveEtiqueta),
  );

  const empiezan = [];
  const contienen = [];
  for (const etiqueta of lista) {
    if (typeof etiqueta !== "string") continue;
    const suya = normalizarClaveEtiqueta(etiqueta);
    if (suya === "" || excluidas.has(suya)) continue;
    if (suya.startsWith(clave)) empiezan.push(etiqueta);
    else if (suya.includes(clave)) contienen.push(etiqueta);
  }

  return [...empiezan, ...contienen].slice(0, Math.max(limite, 0));
}

/*
  A qué lugar se pasa la etiqueta que se arrastra (2026-10-13). Toma números,
  no nodos: el cableado mide las cajas de LAYOUT de las etiquetas
  (offsetLeft y compañía, que ignoran transformaciones) y convierte el
  puntero a coordenadas de la lista; esta función sólo hace la aritmética.

  EL ERROR QUE EVITA. La primera versión elegía "el centro más cercano al
  puntero", y en el navegador las etiquetas se intercambiaban de ida y vuelta
  en cada paso: tras un cambio, el centro del vecino —que ahora está donde
  estaba la arrastrada, y es de otro ancho— seguía siendo el más cercano, y
  volvía a cambiar. Medir con getBoundingClientRect() empeoraba todo, porque
  incluye la animación de deslizamiento en curso.

  Ahora hay HISTÉRESIS, en orden de lectura:
    - el candidato es la caja que contiene al puntero, o la de menor distancia
      al rectángulo (0 si el punto está adentro);
    - si el candidato es la propia etiqueta, no se mueve;
    - para pasar a un lugar POSTERIOR hay que haber cruzado el centro del
      candidato (en su fila: x mayor; en una fila más abajo: ya cuenta);
    - para pasar a uno ANTERIOR, lo mismo al revés (x menor, o fila más arriba).
  Tras un cambio, el puntero queda del lado "ya cruzado" del vecino que acaba
  de pasar, así que no hay cambio de regreso hasta que lo recorra de vuelta:
  la holgura es el ancho de la etiqueta arrastrada más el hueco.

  \`cajas\` son { left, top, width, height } en coordenadas de la lista. Devuelve
  el índice de destino, que puede ser \`actual\` (no se mueve); con entradas
  inválidas devuelve \`actual\`, o -1 si \`actual\` tampoco es un índice.
*/
function destinoDeArrastre(cajas, actual, punto) {
  const lista = Array.isArray(cajas) ? cajas : [];
  if (!Number.isInteger(actual) || actual < 0 || actual >= lista.length) return -1;
  if (!punto || !Number.isFinite(punto.x) || !Number.isFinite(punto.y)) return actual;

  const valida = (caja) => caja
    && [caja.left, caja.top, caja.width, caja.height].every(Number.isFinite);

  let candidato = -1;
  let menor = Infinity;
  for (let i = 0; i < lista.length; i += 1) {
    const caja = lista[i];
    if (!valida(caja)) continue;
    const dx = Math.max(caja.left - punto.x, 0, punto.x - (caja.left + caja.width));
    const dy = Math.max(caja.top - punto.y, 0, punto.y - (caja.top + caja.height));
    const distancia = dx * dx + dy * dy;
    // Con empate gana la primera, como en lectura.
    if (distancia < menor) {
      menor = distancia;
      candidato = i;
    }
  }
  if (candidato === -1 || candidato === actual) return actual;

  const caja = lista[candidato];
  const centroX = caja.left + caja.width / 2;
  const debajo = punto.y > caja.top + caja.height;
  const encima = punto.y < caja.top;

  if (candidato > actual) return debajo || (!encima && punto.x > centroX) ? candidato : actual;
  return encima || (!debajo && punto.x < centroX) ? candidato : actual;
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    MAXIMO_SUGERENCIAS_ETIQUETAS,
    normalizarClaveEtiqueta,
    agregarEtiqueta,
    quitarEtiqueta,
    moverEtiqueta,
    sugerenciasDeEtiqueta,
    destinoDeArrastre,
  });
}
