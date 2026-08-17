En vez de partir los datos en $k$ grupos de una vez, el clustering jerárquico
construye **todos los niveles de agrupamiento a la vez**, desde cada punto solo
hasta un único grupo con todo.

La versión aglomerativa, que es la que se usa casi siempre:

1. Cada observación empieza siendo su propio grupo.
2. Se fusionan los dos grupos más cercanos.
3. Se repite hasta que queda uno solo.

## El criterio de enlace lo cambia todo

"Los dos grupos más cercanos" exige definir la distancia **entre grupos**, no
entre puntos. Esa elección determina la forma de lo que encuentras:

| Enlace | Distancia entre grupos | Tiende a producir |
| --- | --- | --- |
| Simple | Entre sus dos puntos más cercanos | Cadenas largas y serpenteantes |
| Completo | Entre sus dos puntos más lejanos | Grupos compactos y de tamaño parejo |
| Promedio | Promedio de todos los pares | Un intermedio equilibrado |
| Ward | Aumento de varianza al fusionar | Grupos de tamaño similar |

No hay uno correcto. El enlace simple encuentra formas alargadas que Ward jamás
vería, y a cambio sufre de *chaining*: dos grupos legítimos unidos por unos
pocos puntos intermedios terminan fusionados.

```python
from scipy.cluster.hierarchy import linkage, dendrogram, fcluster

Z = linkage(X_escalado, method="ward")

# El corte se decide DESPUÉS de ver el dendrograma, no antes.
etiquetas = fcluster(Z, t=4, criterion="maxclust")
```

## Cómo se lee un dendrograma

El eje vertical es la **distancia a la que ocurrió cada fusión**, y ahí está toda
la información:

- Fusiones **bajas** son grupos que se parecen mucho.
- Un salto **alto** significa que hubo que unir cosas muy distintas: justo debajo
  de ese salto está la partición más defendible.
- Ramas largas sin fusiones indican grupos bien separados.

> El orden horizontal de las hojas **no** significa nada. Cualquier rama puede
> rotarse sobre su nodo sin cambiar el árbol, así que dos hojas vecinas en el
> dibujo pueden ser completamente distintas. Es el error de lectura más común.

## Frente a k-means

- **A favor**: no exiges $k$ de antemano, ves la estructura en todas las escalas
  y el dendrograma es una salida interpretable por sí sola.
- **En contra**: cuesta $O(n^2)$ en memoria y peor en tiempo, lo que lo vuelve
  inviable con cientos de miles de filas. Y las fusiones son definitivas: un
  error temprano se arrastra hasta arriba, mientras que [[k-means]] reasigna
  puntos en cada iteración.

La combinación práctica cuando hay muchos datos: correr k-means para reducir a
unos cientos de centroides y aplicar el jerárquico sobre esos centroides.
