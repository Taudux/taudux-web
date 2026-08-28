K-means parte los datos en $k$ grupos buscando que cada punto quede lo más cerca
posible del centro de su grupo. Formalmente, minimiza la inercia:

$$
\sum_{j=1}^{k} \sum_{x \in C_j} \lVert x - \mu_j \rVert^2
$$

donde $\mu_j$ es el centroide del grupo $C_j$.

## El algoritmo

Dos pasos que se repiten hasta que nada cambia:

1. **Asignar.** Cada punto va al centroide más cercano.
2. **Actualizar.** Cada centroide se recalcula como el promedio de sus puntos.

```python
from sklearn.cluster import KMeans

# n_init=10 corre el algoritmo 10 veces con inicios distintos y se queda
# con el mejor: converge a un mínimo LOCAL, así que el punto de partida
# cambia el resultado final.
modelo = KMeans(n_clusters=4, n_init=10, random_state=42)
etiquetas = modelo.fit_predict(X)
```

Converge siempre, pero a un mínimo local. Correrlo una sola vez es dejar el
resultado al azar de la inicialización.

## Los supuestos ocultos

Nadie los declara y todos los sufren. K-means asume que los grupos son
**esféricos, de tamaño parecido y de densidad similar**, porque eso es lo que
implica minimizar la distancia euclidiana al centro. Cuando la realidad no es
así, el algoritmo no avisa: entrega grupos igual.

| Forma real de los datos | Qué hace k-means |
| --- | --- |
| Nubes redondas y separadas | Funciona muy bien |
| Grupos alargados o curvos | Los parte por la mitad |
| Un grupo grande y uno chico | Le roba puntos al grande |
| Densidades muy distintas | Ignora el grupo disperso |

**Escalar es obligatorio.** La distancia euclidiana suma las columnas tal como
vienen: una variable en pesos y otra en proporciones significa que la primera
decide sola los grupos. `StandardScaler` antes de agrupar, siempre.

## Elegir k

No hay respuesta automática. Las dos herramientas de siempre:

- **Codo.** Grafica la inercia contra $k$ y busca el quiebre. La inercia siempre
  baja al subir $k$ —con $k = n$ vale cero—, así que lo que se busca es dónde
  deja de bajar rápido. Muchas veces no hay codo visible.
- **Silueta.** Mide, para cada punto, qué tan cerca está de su grupo comparado
  con el grupo vecino más próximo. Va de -1 a 1 y sirve para comparar valores
  de $k$ entre sí.

> Ambas miden geometría, no verdad. Si el negocio necesita tres segmentos
> accionables y la silueta prefiere siete, la silueta no es el criterio que
> decide.

## Cuando los supuestos no se cumplen

Si no quieres fijar $k$ de antemano, o si los grupos tienen forma irregular y
jerarquía, la alternativa natural es [[clustering-jerarquico]].

Y si hay muchas columnas, conviene reducirlas antes: en dimensión alta las
distancias euclidianas se vuelven casi iguales entre todos los pares y k-means
pierde poder de discriminación. Ese pretratamiento es
[[analisis-de-componentes-principales]].

Si además los grupos no son redondos —lunas, espirales, densidades irregulares—
el problema no es la $k$ sino el supuesto de forma esférica, y ahí la
herramienta correcta es [[dbscan]], que agrupa por densidad y de paso marca los
puntos que no pertenecen a nada.

> Nada de lo anterior importa si las columnas están en unidades distintas: la
> distancia euclidiana quedaría dominada por la de números más grandes. Ver
> [[escalado-de-variables]].
