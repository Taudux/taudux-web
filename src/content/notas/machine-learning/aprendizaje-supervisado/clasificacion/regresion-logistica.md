Se llama regresión y no lo es: predice una **categoría**, no un número. El
nombre viene de que por dentro sigue siendo un modelo lineal; lo que cambia es
lo que hace con el resultado de esa combinación lineal.

## De una recta a una probabilidad

Una combinación lineal $z = \beta_0 + \beta_1 x_1 + \dots + \beta_p x_p$ puede
dar cualquier número real, y una probabilidad tiene que caer entre 0 y 1. La
función logística hace exactamente esa traducción:

$$
P(y = 1 \mid x) = \sigma(z) = \frac{1}{1 + e^{-z}}
$$

```python
import numpy as np

def sigmoide(z):
    return 1 / (1 + np.exp(-z))

sigmoide(np.array([-4, -1, 0, 1, 4]))
# array([0.018, 0.269, 0.5, 0.731, 0.982])
```

Aplanada en los extremos y casi recta cerca de cero: mover $z$ de 0 a 1 cambia
mucho la probabilidad, moverlo de 4 a 5 casi no la cambia.

## Cómo se interpretan los coeficientes

Acá está la trampa más común. $\beta_j$ **no** es el cambio en la probabilidad;
es el cambio en el **log-odds**. Lo que sí es directo:

$$
e^{\beta_j} = \text{factor por el que se multiplican los momios}
$$

Un $\beta_j = 0.7$ da $e^{0.7} \approx 2$: esa variable **duplica los momios**,
no la probabilidad. Con probabilidad base de 0.1 el resultado es 0.18; con base
de 0.5, es 0.67. El mismo coeficiente, efectos muy distintos.

## El umbral no es parte del modelo

El modelo entrega una probabilidad. Convertirla en una decisión requiere un
corte, y **0.5 es solo un valor por omisión, no una respuesta**:

```python
proba = modelo.predict_proba(X_prueba)[:, 1]

# Con clases desbalanceadas o costos asimétricos, 0.5 es casi siempre
# el umbral equivocado. Es una decisión de negocio, no estadística.
y_pred = (proba >= 0.30).astype(int)
```

Elegir el umbral es decidir qué error prefieres cometer. Un falso negativo en un
diagnóstico y un falso positivo en un filtro de spam no cuestan lo mismo, y el
modelo no tiene forma de saberlo. Ese balance se lee en la
[[matriz-de-confusion]].

## Cuándo usarla

- Cuando necesitas la **probabilidad**, no solo la etiqueta.
- Cuando alguien va a preguntar *por qué* el modelo decidió eso.
- Como línea base obligatoria: es rápida, estable, y muchos problemas
  supuestamente complejos se resuelven casi igual de bien con ella.

> Requiere las mismas precauciones que cualquier modelo lineal: escalar las
> variables antes de comparar coeficientes y vigilar la colinealidad. Con
> separación perfecta —una variable que predice la clase sin error— los
> coeficientes se van al infinito y el ajuste no converge; la regularización lo
> evita y viene activada por omisión en scikit-learn.

## Cuándo no alcanza

Es lineal en el log-odds, así que una frontera de decisión curva se le escapa.
Cuando la relación tiene interacciones o cortes por umbral —"esta variable
importa solo si aquella supera cierto valor"— el modelo natural es otro:
[[arboles-de-decision]].
