/*
  El arranque del hub de entornos.

  Estas líneas vivían inline al final de `index.html` y no podían quedarse ahí:
  la CSP del sitio declara `script-src` sin `'unsafe-inline'`, así que el
  navegador se negaría a ejecutarlas y el mosaico del fondo no se montaría nunca
  en producción. Un test lo fija para todas las páginas fuera de `/afgi`.

  El hub no ejecuta código de nadie, así que el mosaico sólo deriva: los pulsos
  quedan para las páginas de cada lenguaje, donde sí hay algo que celebrar.
*/
montarFondoDeCodigo(document.getElementById("practicaFondo"));
