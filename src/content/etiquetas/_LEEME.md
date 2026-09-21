Esta carpeta tiene los tres catálogos de etiquetas que *Mi ficha* ofrece como
sugerencias mientras escribes:

- **`herramientas.json`** — lo que abres: lenguajes, frameworks, servicios.
- **`habilidades.json`** — lo que sabes hacer: prácticas, disciplinas, oficios.
- **`idiomas.json`** — los idiomas que hablas.

## Qué NO son

**No son listas blancas.** Los catálogos sugieren, nunca restringen:
cualquiera puede escribir una etiqueta que no esté aquí y guardarla. Si un
archivo se cae o no carga, el campo sigue funcionando — sólo deja de sugerir.

Por eso agregar algo aquí es una comodidad, no un trámite obligatorio para
nadie.

## Forma

```json
{ "version": 1, "etiquetas": ["Angular", "AWS", "Bash"] }
```

Un arreglo plano de textos. Sin alias, sin categorías, sin metadatos: si algún
día hacen falta, se agregan sin romper lo que ya hay. Los tres archivos tienen
la misma forma; el servicio que los baja
(`src/app/core/etiquetas/catalogo.service.js`) es uno solo, parametrizado por
nombre.

## Dónde va cada cosa

La frontera entre los dos primeros: **una habilidad es algo que sabes hacer;
una herramienta es algo que abres.** Los bordes que ya se discutieron:

- `CI/CD` es habilidad; `GitHub Actions`, herramienta.
- `REST API` es habilidad; `GraphQL`, herramienta.
- Nada de adjetivos de personalidad: una habilidad tiene que ser verificable
  por un tercero.

`REST` se guarda como **`REST API`**: a secas colisiona con el nombre del
estilo arquitectónico y sugiere mal al teclear "res".

Los idiomas van en **español y en su forma canónica** (`Español`, `Inglés`,
`Portugués`, `Mandarín`). La dedupe insensible a acentos del editor hace que
quien escriba "ingles" encuentre "Inglés" y no cree una segunda etiqueta.

## Reglas

Las revisa `tests/etiquetas-catalogos.test.js` sobre los tres archivos, así
que si alguna se rompe te lo dice la suite:

- **Entre 1 y 40 caracteres**, sin espacios en los bordes. Es el mismo límite
  que la migración `0041` le pone a cada elemento de una lista de etiquetas.
- **Sin caracteres de control ni de formato bidireccional** — también de la
  `0041`.
- **Sin duplicados** comparando en minúsculas y sin acentos: `PostgreSQL` y
  `postgresql` son la misma.
- **Ni una clave repetida entre dos catálogos.** Es lo que impide que `REST`
  vuelva a colarse en herramientas.
- **Ordenado** por esa misma clave normalizada.
- Escrita como la escribe su gente: `PostgreSQL`, no `postgresql`; `pandas`,
  no `Pandas`.

## Cómo se busca

La búsqueda ignora mayúsculas y acentos y va por **substring**, no por
prefijo: `gres` encuentra `PostgreSQL`. La consecuencia asumida es que las
abreviaturas que no son parte del nombre no funcionan — `js` no encuentra
`JavaScript`.
