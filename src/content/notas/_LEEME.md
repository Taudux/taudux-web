Esta carpeta es el área de notas de Taudux. Dos cosas conviven aquí:

- **Los `.md`** — el contenido, uno por nota, puro texto sin encabezado ni
  metadatos.
- **`manifiesto.json`** — el esqueleto: qué área contiene qué temas, qué temas
  contienen qué notas, en qué orden y con qué título. **Lo escribes tú a mano.**

El navegador no puede listar carpetas, solo pedir archivos por nombre. Por eso el
manifiesto existe: es lo único que le dice al sitio qué hay y cómo se conecta.

## Publicar

```bash
node tools/notas.js                                    # revisa que todo cuadre
git add -A && git commit -m "notas: agrega X" && git push
```

Si algo está mal, `tools/notas.js` te dice **qué archivo y qué le falta**, con
número de línea cuando el problema es el JSON. Si no dice nada, está listo.

## Agregar una nota

**1.** Crea el `.md` donde corresponda. El nombre del archivo es la URL: en
minúsculas, con guiones y sin acentos.

```
machine-learning/aprendizaje-supervisado/regresion/regularizacion.md
```

**2.** Declárala en el manifiesto, dentro del arreglo `notas` de su tema:

```json
{
  "slug": "regularizacion",
  "titulo": "Regularización",
  "resumen": "Ridge y Lasso, o cómo evitar que el modelo memorice.",
  "archivo": "machine-learning/aprendizaje-supervisado/regresion/regularizacion.md",
  "etiquetas": ["regresión", "sobreajuste"],
  "relacionadas": ["regresion-lineal"]
}
```

| Campo | ¿Obligatorio? | Para qué sirve |
| --- | --- | --- |
| `slug` | Sí | La URL. Único en todo el árbol |
| `titulo` | Sí | Encabezado en la tarjeta, el mapa y la lectura |
| `resumen` | Sí | Texto de la tarjeta y del buscador |
| `archivo` | Sí | Ruta del `.md` desde esta carpeta |
| `etiquetas` | No | Píldoras bajo el resumen; también se buscan |
| `relacionadas` | No | Aristas del mapa. Deben coincidir con los `[[enlaces]]` del texto |
| `publicada` | No | `false` la oculta del sitio sin borrarla |

El orden de lectura es el orden del arreglo: para mover una nota, muévela dentro
del JSON.

## Agregar un tema o un área

Un objeto con `slug`, `titulo`, `resumen` y, dentro, `notas` y/o `hijos`:

```json
{
  "slug": "regresion",
  "titulo": "Regresión",
  "resumen": "Cuando lo que se predice es un número continuo.",
  "notas": [ ... ],
  "hijos": [ ... ]
}
```

La profundidad es libre: `área → tema → nota` y `área → tema → subtema → nota`
funcionan igual y pueden convivir en la misma rama.

## Enlazar notas entre sí

Dentro del texto, con `[[slug-de-la-otra-nota]]` o `[[slug|el texto que se lee]]`.

Esos enlaces hacen dos cosas: se vuelven navegables al leer y **dibujan las
líneas punteadas del mapa**. Si una nota de un área cita a otra de un área
distinta, la conexión aparece agregada en el nivel que estés viendo.

Cada enlace del texto debe estar también en `relacionadas`. Es la duplicación que
permite al mapa dibujarse sin descargar todas las notas del sitio, y
`tools/notas.js` no te deja olvidarla:

```
regresion-lineal: el .md enlaza a [[dbscan]] pero «relacionadas» no lo declara
```

Un `[[enlace]]` dentro de un bloque de código no cuenta: el `df[["a","b"]]` de
pandas no genera relaciones.

## Reglas que la herramienta hace cumplir

- Todo `.md` debe estar declarado en el manifiesto, y todo lo declarado debe
  existir.
- Los slugs solo admiten minúsculas, dígitos y guiones, y no se repiten.
- El `.md` no lleva `# título` ni bloque de metadatos: eso vive en el manifiesto.
- Un tema sin notas ni subtemas es un error.
- Los archivos que empiezan con `_` se ignoran. Úsalos para borradores que
  quieras tener al lado sin publicar.
