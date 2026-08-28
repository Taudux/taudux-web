DBSCAN no busca centros. Busca **regiones densas** y las deja crecer hasta donde
la densidad se acaba. Lo que queda aislado no se fuerza a ningún grupo: se marca
como ruido.

## Dos parámetros y tres tipos de punto

- **`eps`**: el radio de vecindad. Qué tan cerca tienen que estar dos puntos para
  considerarse vecinos.
- **`min_samples`**: cuántos vecinos necesita un punto dentro de `eps` para ser
  **núcleo**.

De ahí salen tres categorías: **núcleo** (tiene suficientes vecinos), **frontera**
(no es núcleo pero cae dentro del `eps` de uno) y **ruido** (ni una cosa ni la
otra, se etiqueta como `-1`). Los grupos crecen encadenando puntos núcleo.

## Lo que hace y k-means no puede

```python
from sklearn.datasets import make_moons
from sklearn.cluster import DBSCAN, KMeans
from sklearn.preprocessing import StandardScaler

# Dos "lunas" entrelazadas.
X, _ = make_moons(n_samples=500, noise=0.10, random_state=42)
X = StandardScaler().fit_transform(X)

km = KMeans(n_clusters=2, n_init=10, random_state=42).fit(X)
db = DBSCAN(eps=0.18, min_samples=5).fit(X)

grupos = len(set(db.labels_)) - (1 if -1 in db.labels_ else 0)
print(f"DBSCAN -> grupos={grupos}, ruido={(db.labels_ == -1).sum()}")
# -> grupos=2, ruido=14
```

[[k-means]] solo sabe hacer cortes rectos alrededor de centroides, así que parte
las lunas por la mitad. DBSCAN sigue la densidad y recupera las dos formas. Esa
capacidad de **detectar el ruido automáticamente** es lo que lo vuelve natural
para detección de anomalías y fraude.

## Cómo elegir eps

Con el gráfico de **k-distancia**: se ordena la distancia de cada punto a su
k-ésimo vecino y se busca el codo de la curva.

```python
from sklearn.neighbors import NearestNeighbors
import numpy as np

distancias, _ = NearestNeighbors(n_neighbors=5).fit(X).kneighbors(X)
kdist = np.sort(distancias[:, -1])   # distancia al 5º vecino, ordenada
# El codo de esta curva es un buen punto de partida para eps.
```

Regla práctica para `min_samples`: al menos el número de dimensiones más uno, y
más alto cuando los datos son ruidosos.

## Sus límites

| Fortaleza | Debilidad |
| --- | --- |
| No exige saber cuántos grupos hay | Muy sensible a `eps` |
| Encuentra grupos de forma arbitraria | Sufre con densidades muy distintas entre grupos |
| Detecta outliers como parte del algoritmo | Se degrada en dimensión alta |
| No lo arrastran los puntos extremos | No es determinista con los puntos frontera |

La debilidad de las **densidades desiguales** es la seria: un solo par
`(eps, min_samples)` para todo el espacio significa que un grupo denso y otro
disperso no pueden capturarse bien a la vez. Para eso existe HDBSCAN.

> Escalar es obligatorio, igual que en el resto de lo que usa distancias: `eps`
> es un radio, y un radio solo tiene sentido si todas las columnas se miden en
> la misma unidad. Ver [[escalado-de-variables]].
