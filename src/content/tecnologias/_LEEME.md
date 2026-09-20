Esta carpeta tiene un solo archivo: **`catalogo.json`**, la lista de
tecnologías que el campo **Stack** de *Mi ficha* ofrece como sugerencias
mientras escribes.

## Qué NO es

**No es una lista blanca.** El catálogo sugiere, nunca restringe: cualquiera
puede escribir una tecnología que no esté aquí y guardarla. Si el archivo se
cae o no carga, el campo sigue funcionando — sólo deja de sugerir.

Por eso agregar algo aquí es una comodidad, no un trámite obligatorio para
nadie.

## Forma

```json
{ "version": 1, "tecnologias": ["Angular", "AWS", "Bash"] }
```

Un arreglo plano de textos. Sin alias, sin categorías, sin metadatos: si algún
día hacen falta, se agregan sin romper lo que ya hay.

## Reglas

Las revisa `tests/tecnologias-catalogo.test.js`, así que si alguna se rompe te
lo dice la suite:

- **Entre 1 y 40 caracteres**, sin espacios en los bordes. Es el mismo límite
  que la migración `0039` le pone a cada elemento del stack.
- **Sin caracteres de control ni de formato bidireccional** — también de la
  `0039`.
- **Sin duplicados** comparando en minúsculas y sin acentos: `PostgreSQL` y
  `postgresql` son la misma.
- **Ordenado** por esa misma clave normalizada.
- Escrita como la escribe su gente: `PostgreSQL`, no `postgresql`; `pandas`,
  no `Pandas`.

## Cómo se busca

La búsqueda ignora mayúsculas y acentos y va por **substring**, no por
prefijo: `gres` encuentra `PostgreSQL`. La consecuencia asumida es que las
abreviaturas que no son parte del nombre no funcionan — `js` no encuentra
`JavaScript`.
