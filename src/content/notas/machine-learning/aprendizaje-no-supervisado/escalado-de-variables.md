Casi todos los algoritmos no supervisados se basan en **distancias**. Y una
distancia suma las columnas tal como vienen, sin saber que una está en pesos y
otra en años.

```python
import numpy as np

# Ingreso mensual vs. antigüedad en años.
a = np.array([25_000, 3])
b = np.array([26_000, 12])

# La diferencia de 9 años pesa 0.008% del total: la distancia es el ingreso.
print(np.linalg.norm(a - b))   # -> 1000.04
```

El modelo corre, devuelve grupos y nadie ve un error. Simplemente agrupó por
ingreso e ignoró todo lo demás. **Es el fallo silencioso más común del área.**

## Los cuatro métodos

| Escalador | Qué hace | Cuándo |
| --- | --- | --- |
| `StandardScaler` | Media 0, desviación 1 | El predeterminado razonable |
| `MinMaxScaler` | Comprime al rango [0, 1] | Cuando necesitas límites fijos |
| `RobustScaler` | Usa mediana y rango intercuartil | Cuando hay outliers |
| `Normalizer` | Norma 1 **por fila** | Texto, perfiles de composición |

`Normalizer` es el que confunde: opera **por fila, no por columna**. No es un
sustituto de los otros tres, resuelve otro problema — comparar la forma de un
perfil sin importar su magnitud total.

## StandardScaler y los outliers

$$
z = \frac{x - \mu}{\sigma}
$$

Media y desviación son sensibles a valores extremos. Un solo registro absurdo
—un ingreso de 50 millones por un error de captura— infla $\sigma$ y comprime a
todos los demás en un rango minúsculo. `RobustScaler` usa mediana y rango
intercuartil, que ese outlier no mueve.

## El error que invalida la evaluación

```python
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans

# MAL: el escalador ve el conjunto completo, incluido el de prueba.
#   X_escalado = StandardScaler().fit_transform(X)

# BIEN: dentro de un pipeline, se ajusta solo con lo que corresponde.
modelo = make_pipeline(StandardScaler(), KMeans(n_clusters=4, n_init=10))
modelo.fit(X_entrena)
```

Escalar antes de partir los datos filtra la media y la desviación del conjunto
de prueba hacia el entrenamiento. El resultado se ve mejor de lo que es, y esa
diferencia solo aparece en producción.

## Qué necesita escalado y qué no

**Sí**: [[k-means]], [[dbscan]], [[k-vecinos-mas-cercanos]],
[[analisis-de-componentes-principales]], SVM, y cualquier modelo lineal con
regularización.

**No**: árboles y todo lo construido sobre ellos. Un árbol solo compara un valor
contra un umbral, así que las unidades le dan igual.

> Ante la duda, escala. En los modelos que no lo necesitan, no hace daño; en los
> que sí, es la diferencia entre un resultado real y uno que solo mide qué
> columna tiene los números más grandes.
