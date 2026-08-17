PCA no selecciona columnas: las **reemplaza**. Rota el sistema de coordenadas
hacia las direcciones en las que los datos más varían, y se queda con las
primeras.

## Qué está haciendo por dentro

Sobre los datos centrados, PCA busca los vectores propios de la matriz de
covarianza:

$$
\Sigma = \frac{1}{n-1} X^\top X, \qquad \Sigma v_j = \lambda_j v_j
$$

Cada vector propio $v_j$ es una **componente principal**: una dirección en el
espacio original. Su valor propio $\lambda_j$ es cuánta varianza hay en esa
dirección. Se ordenan de mayor a menor y se conservan las primeras.

Dos propiedades que hacen a PCA lo que es:

- Las componentes son **ortogonales entre sí**, es decir, no correlacionadas.
- La primera componente captura la mayor varianza posible en una sola dirección;
  la segunda, la mayor de lo que queda, y así.

```python
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler

# Sin escalar, PCA describe la columna con los números más grandes.
X_escalado = StandardScaler().fit_transform(X)

pca = PCA(n_components=0.90)   # las componentes que expliquen el 90%
X_reducido = pca.fit_transform(X_escalado)

print(pca.explained_variance_ratio_.cumsum())
```

## El escalado no es opcional

PCA maximiza varianza, y la varianza depende de las unidades. Con ingresos en
pesos y edad en años, la varianza de los ingresos es de órdenes de magnitud
mayor: la primera componente será, esencialmente, la columna de ingresos. Con
variables en unidades distintas se escala **siempre**.

## Qué se gana y qué se pierde

| Ganas | Pierdes |
| --- | --- |
| Menos columnas con casi toda la información | La interpretación directa de cada variable |
| Componentes no correlacionadas | La escala original |
| Visualización en 2D de datos de alta dimensión | Relaciones no lineales, que PCA no captura |

Ese primer renglón de la columna derecha es el costo real. "Componente 1" no es
una variable con nombre: es una combinación lineal de todas. A veces esa
combinación es interpretable —los `loadings` muestran cuánto pesa cada variable
original— y a veces simplemente no significa nada explicable.

> PCA maximiza varianza, no poder predictivo. La dirección con más varianza
> puede ser irrelevante para lo que quieres predecir, y una componente
> descartada por tener poca varianza puede ser justo la que importaba. No es un
> paso automático antes de modelar.

## Dos usos concretos

**Contra la colinealidad.** Cuando varias columnas dicen casi lo mismo, la
matriz $X^\top X$ queda mal condicionada y los coeficientes de una
[[regresion-lineal]] se vuelven inestables. Como las componentes son ortogonales
por construcción, el problema desaparece —a costa de coeficientes que ya no se
pueden interpretar en términos de las variables originales—.

**Antes de agrupar.** En dimensión alta, todas las distancias euclidianas
tienden a parecerse entre sí y los algoritmos basados en distancia pierden
capacidad de discriminar. Reducir a unas pocas componentes antes de correr
[[k-means]] suele mejorar los grupos, además de permitir graficarlos.
