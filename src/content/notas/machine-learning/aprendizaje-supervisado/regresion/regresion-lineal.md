La regresión lineal supone que la respuesta es una suma ponderada de las
características, más un error:

$$
y = \beta_0 + \beta_1 x_1 + \dots + \beta_p x_p + \varepsilon
$$

Entrenar es encontrar los $\beta$ que minimizan la suma de cuadrados de los
residuos. A diferencia de casi todo el resto del machine learning, acá la
solución tiene forma cerrada:

$$
\hat{\beta} = (X^\top X)^{-1} X^\top y
$$

## Por qué sigue siendo la primera parada

No porque sea la más precisa, sino porque es la única que responde tres
preguntas a la vez:

- **Predice.** Da un número para cada caso nuevo.
- **Explica.** Cada $\beta_j$ es el cambio esperado en $y$ por unidad de $x_j$,
  manteniendo lo demás constante. Casi ningún modelo moderno ofrece eso.
- **Sirve de piso.** Si un modelo complejo no le gana a una regresión lineal, el
  problema no está en el algoritmo.

```python
import numpy as np
from sklearn.linear_model import LinearRegression

modelo = LinearRegression().fit(X_entrena, y_entrena)

# Los coeficientes solo son comparables entre sí si las columnas están
# en la misma escala. Con variables en unidades distintas, un beta grande
# puede significar únicamente que esa columna se mide en números pequeños.
for nombre, beta in zip(columnas, modelo.coef_):
    print(f"{nombre:>20}: {beta: .4f}")
```

## Los supuestos que nadie revisa

La fórmula corre siempre, aunque los supuestos no se cumplan. Ahí es donde
aparecen los resultados que se ven bien y son falsos:

1. **Linealidad.** La relación real es aproximadamente recta. Si es curva, el
   modelo no falla con estruendo: falla sistemáticamente en los extremos.
2. **Independencia de los errores.** Con series de tiempo esto casi nunca se
   cumple, y el resultado son intervalos de confianza demasiado angostos.
3. **Varianza constante.** Cuando el error crece con la magnitud de $y$
   (heterocedasticidad), el modelo acierta en promedio y se equivoca justo donde
   más importa.
4. **Ausencia de colinealidad severa.** Si dos columnas dicen casi lo mismo,
   $X^\top X$ queda casi singular: los coeficientes se vuelven enormes, de signo
   arbitrario e inestables ante cualquier cambio mínimo de los datos.

> El diagnóstico más barato y más ignorado: graficar residuos contra valores
> predichos. Si se ve cualquier patrón —una curva, un cono, una banda— alguno de
> los supuestos se está violando.

La colinealidad tiene un puente directo con lo no supervisado: rotar los datos a
componentes ortogonales con [[analisis-de-componentes-principales]] la elimina
por construcción, al precio de perder la interpretación de los coeficientes.

## Cómo se evalúa

El $R^2$ del entrenamiento no dice nada sobre el desempeño futuro: sube siempre
que se agrega una variable, aunque sea ruido puro. Qué medir y con qué, en
[[metricas-de-regresion]].

Y si la respuesta es una categoría en vez de un número, el mismo andamiaje
lineal se recicla cambiando lo que sale del modelo: [[regresion-logistica]].
