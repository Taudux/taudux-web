Acá no hay respuestas. Solo tenemos $x_i$: características, sin ningún $y_i$ que
diga cuál era el resultado correcto. La pregunta deja de ser "¿cómo predigo la
etiqueta?" y pasa a ser "¿qué estructura tienen estos datos?".

## Qué se puede buscar sin etiquetas

- **Grupos.** Observaciones más parecidas entre sí que con el resto. Es el
  terreno del clustering, y la puerta de entrada es [[k-means]].
- **Ejes.** Direcciones donde los datos realmente varían, para describirlos con
  menos columnas sin perder lo esencial.
- **Anomalías.** Puntos que no se parecen a nada, útiles en fraude y en control
  de calidad.
- **Asociaciones.** Cosas que tienden a ocurrir juntas, como los productos que
  se compran en el mismo carrito.

## El problema difícil: ¿cómo sé si sirve?

Esta es la diferencia real con [[que-es-el-aprendizaje-supervisado]], y no es de
grado. Allá existe una respuesta correcta contra la cual medirse: apartas datos
de prueba y comparas. Acá **no hay contra qué comparar**. Un algoritmo de
clustering siempre devuelve grupos, incluso sobre ruido puro.

```python
import numpy as np
from sklearn.cluster import KMeans

# Datos completamente aleatorios: no hay ninguna estructura que encontrar.
ruido = np.random.rand(500, 2)

etiquetas = KMeans(n_clusters=4, n_init=10).fit_predict(ruido)
print(np.bincount(etiquetas))   # cuatro grupos de tamaño razonable
```

Cuatro grupos limpios sobre datos sin estructura alguna. El algoritmo hizo lo
que se le pidió: partir el espacio. Que esa partición signifique algo es una
afirmación aparte, y el algoritmo nunca la hace.

> Las métricas internas —silueta, inercia, Davies-Bouldin— miden qué tan
> compactos y separados quedaron los grupos, no si son reales. Son útiles para
> comparar configuraciones, no para justificar que el resultado existe.

## Cómo se valida en la práctica

1. **Estabilidad.** Vuelve a correrlo con otra semilla y sobre submuestras. Si
   los grupos cambian de forma, no eran grupos.
2. **Interpretabilidad.** Describe cada grupo con las variables originales. Si
   nadie del dominio puede ponerles nombre, probablemente no describen nada.
3. **Utilidad externa.** Comprueba si los grupos se relacionan con algo que no
   entró al modelo. Es la evidencia más fuerte disponible.

## Por qué se usa igual

Porque etiquetar es caro y los datos sin etiquetar sobran. Y porque muchas veces
lo no supervisado es un **paso previo**, no el destino: reducir dimensiones antes
de entrenar, encontrar segmentos que después alguien etiqueta a mano, o explorar
un conjunto nuevo antes de decidir qué pregunta vale la pena hacerle.

## Antes de cualquier algoritmo

Todo lo anterior se apoya en distancias, y una distancia entre columnas con
unidades distintas no significa nada. El escalado no es un paso de limpieza
opcional: es parte del modelo. Ver [[escalado-de-variables]].

Y si lo que buscas no son grupos de observaciones sino cosas que ocurren juntas
—productos en el mismo ticket, síntomas en el mismo paciente— el planteamiento
cambia por completo: [[apriori-y-fp-growth]].
