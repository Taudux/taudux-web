KNN no entrena nada. Guarda todos los ejemplos y, cuando llega un caso nuevo,
busca los $k$ más parecidos y les pregunta: la clase que más se repite entre
ellos, gana.

## No confundir con k-means

Comparten la letra y nada más. Es la confusión más común del área:

| | KNN | [[k-means]] |
| --- | --- | --- |
| Tipo | Supervisado | No supervisado |
| Necesita etiquetas | Sí, obligatorio | No |
| Qué es la `k` | Cuántos vecinos votan | Cuántos grupos formar |
| Qué produce | La clase de un caso nuevo | Una partición de todos los datos |

KNN **necesita respuestas conocidas** para que los vecinos puedan votar. Sin
etiquetas no hay nada que votar.

## El algoritmo completo

1. Calcular la distancia del caso nuevo a todos los ejemplos guardados.
2. Quedarse con los $k$ más cercanos.
3. Devolver la clase mayoritaria entre esos $k$.

$$
\hat{y} = \text{moda}\{\, y_i : x_i \in \mathcal{N}_k(x) \,\}
$$

```python
from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

# El escalado va DENTRO del pipeline: si se escala antes de partir los datos,
# el conjunto de prueba filtra su media y su desviación al entrenamiento.
modelo = make_pipeline(
    StandardScaler(),
    KNeighborsClassifier(n_neighbors=5, weights="distance"),
).fit(X_entrena, y_entrena)
```

## Escalar no es opcional, es el modelo entero

KNN **es** la distancia. Con ingresos en pesos y edad en años, la distancia
euclidiana queda dominada por los ingresos y el modelo termina clasificando por
una sola columna sin que nada lo advierta. Ver [[escalado-de-variables]].

## Elegir k

- **k muy chica** (1, 2): el modelo copia el ruido. Un solo ejemplo mal
  etiquetado se convierte en una región de decisión equivocada.
- **k muy grande**: todo se suaviza hasta que el modelo predice siempre la clase
  mayoritaria.
- **k impar** en problemas de dos clases, para que no haya empates.

Se elige con validación cruzada, no a ojo.

## Su costo real

No tiene tiempo de entrenamiento, pero **cada predicción recorre todo el
conjunto de datos**. Con millones de filas eso es inviable en producción, y
estructuras como KD-tree solo ayudan en dimensión baja. En dimensión alta las
distancias se parecen tanto entre sí que "el vecino más cercano" deja de
significar algo — la maldición de la dimensionalidad, la misma razón por la que
conviene reducir dimensiones antes de usarlo.

> Su desempeño se evalúa como cualquier clasificador, y con clases
> desbalanceadas el accuracy engaña igual que siempre: la lectura correcta está
> en la [[matriz-de-confusion]].
