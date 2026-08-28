La ciberseguridad no es un producto que se instala: es el trabajo continuo de
decidir **qué proteger, de quién, y cuánto cuesta equivocarse**.

## La tríada

Casi todo lo que se hace en el área persigue una de estas tres propiedades:

- **Confidencialidad.** Que solo quien deba pueda leer. Es el terreno del
  [[cifrado-simetrico-y-asimetrico]].
- **Integridad.** Que nadie pueda modificar sin que se note.
- **Disponibilidad.** Que el sistema siga en pie cuando se le necesita.

Tiran en direcciones distintas. Cifrar todo protege la confidencialidad y
complica la disponibilidad; replicar en cinco lugares mejora la disponibilidad y
multiplica la superficie de exposición. **No hay configuración que maximice las
tres**, y elegir el balance es la decisión de diseño.

## Modelo de amenazas

Antes de cualquier control va la pregunta de quién ataca y con qué recursos. No
es lo mismo defenderse de un script automatizado que de alguien con acceso
físico y tiempo. Un control caro contra un adversario que no existe es
presupuesto que no se gastó en el hueco real.

> La cadena se rompe por el eslabón más débil, y casi nunca es la criptografía.
> Es la contraseña reutilizada, el servidor que nadie actualizó, el permiso que
> se dio "temporalmente" hace dos años.

## Detectar, no solo prevenir

Ningún perímetro aguanta indefinidamente, así que la pregunta deja de ser cómo
impedir toda intrusión y pasa a ser **cuánto tardas en enterarte**. Ahí es donde
el área se cruza con el análisis de datos: buscar lo que se sale del patrón sin
saber de antemano qué se busca, que es el tema de
[[deteccion-de-anomalias]].
