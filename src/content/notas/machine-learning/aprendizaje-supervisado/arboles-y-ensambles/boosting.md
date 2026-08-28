[[random-forest]] entrena árboles **en paralelo**, todos independientes, y
promedia. Boosting hace lo contrario: entrena **en cadena**, y cada árbol nuevo
se dedica exclusivamente a lo que la cadena viene fallando.

## La idea en una línea

El modelo se construye por sumas sucesivas:

$$
F_m(x) = F_{m-1}(x) + \nu \cdot h_m(x)
$$

Cada $h_m$ es un árbol chico entrenado para predecir el **error residual** del
modelo acumulado hasta ese momento. $\nu$ es la tasa de aprendizaje: qué tanto
se le hace caso a cada corrección.

Los árboles son deliberadamente débiles —profundidad 3 a 6, no más—. La fuerza
no está en cada uno, sino en la cadena de correcciones.

```python
from sklearn.ensemble import HistGradientBoostingClassifier

modelo = HistGradientBoostingClassifier(
    learning_rate=0.05,
    max_depth=4,
    max_iter=2000,
    # Sin esto, agregar árboles termina sobreajustando: el boosting NO se
    # frena solo, a diferencia de Random Forest.
    early_stopping=True,
    validation_fraction=0.15,
    random_state=42,
).fit(X_entrena, y_entrena)
```

## La diferencia que hay que entender

| | Random Forest | Boosting |
| --- | --- | --- |
| Construcción | Paralela, independiente | Secuencial, dependiente |
| Cada árbol | Profundo y fuerte | Chico y débil |
| Qué ataca | La varianza | El sesgo |
| Más árboles | Nunca empeora | **Puede sobreajustar** |
| Ajuste | Funciona con valores por omisión | Exige cuidado |

Esa última fila es la práctica: Random Forest perdona, boosting no. Un
`learning_rate` alto con muchas iteraciones memoriza el conjunto de
entrenamiento sin avisar.

## La regla del compromiso

`learning_rate` y `n_estimators` se mueven en direcciones opuestas: tasa más
baja necesita más árboles, y da mejores resultados. En la práctica se fija una
tasa baja (0.01–0.05) y se deja que el paro temprano decida cuántos árboles
hacen falta.

## Cuándo usarlo

Con **datos tabulares**, boosting bien ajustado suele ser lo mejor disponible —
por encima de las redes neuronales, que dominan en imagen y texto pero no acá.
XGBoost, LightGBM y CatBoost son las implementaciones serias; `scikit-learn`
trae `HistGradientBoosting`, que es competitiva y no agrega dependencias.

En regresión aplica lo mismo, cambiando la pérdida. Y ahí conviene mirar el
hueco entre MAE y RMSE para saber si el modelo está fallando parejo o
catastróficamente en unos pocos casos: [[metricas-de-regresion]].

> Si el modelo tarda horas y gana dos décimas sobre un Random Forest de cinco
> minutos, la respuesta correcta muchas veces es quedarse con el bosque.
