Las tres métricas de siempre miden cosas distintas, y la diferencia entre ellas
no es de precisión sino de **qué error decides que duele más**.

## MAE: el error típico

$$
\mathrm{MAE} = \frac{1}{n}\sum_{i=1}^{n} |y_i - \hat{y}_i|
$$

Se lee en las unidades de la variable: si predices precios en pesos, el MAE está
en pesos. Trata todos los errores por igual, así que un caso desastroso pesa lo
mismo que varios casos apenas imprecisos.

## RMSE: el error castigado

$$
\mathrm{RMSE} = \sqrt{\frac{1}{n}\sum_{i=1}^{n} (y_i - \hat{y}_i)^2}
$$

También se lee en las unidades originales, pero al elevar al cuadrado penaliza
desproporcionadamente los errores grandes. **RMSE ≥ MAE siempre**, y la brecha
entre ambos es en sí misma un diagnóstico: si el RMSE es mucho mayor, hay unos
pocos casos donde el modelo se equivoca feo.

| Escenario | MAE | RMSE | Lectura |
| --- | --- | --- | --- |
| Errores parejos | 10 | 12 | El modelo falla de forma uniforme |
| Pocos errores enormes | 10 | 45 | Hay casos atípicos que el modelo no captura |

## R²: la proporción explicada

$$
R^2 = 1 - \frac{\sum_i (y_i - \hat{y}_i)^2}{\sum_i (y_i - \bar{y})^2}
$$

Compara el modelo contra predecir siempre el promedio. $R^2 = 0$ significa
"no le gana a la media"; puede ser **negativo**, y en datos de prueba eso pasa
más de lo que la gente espera: significa que el modelo es peor que una constante.

```python
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

y_pred = modelo.predict(X_prueba)

print("MAE ", mean_absolute_error(y_prueba, y_pred))
print("RMSE", mean_squared_error(y_prueba, y_pred) ** 0.5)
print("R2  ", r2_score(y_prueba, y_pred))
```

## Cómo elegir

La pregunta no es cuál métrica es mejor, sino qué error es más caro en el
problema real:

- **Errores grandes son catastróficos** (dosis, estructuras, inventario crítico):
  RMSE. Que el entrenamiento persiga justamente lo que más duele.
- **Todos los errores cuestan proporcional** (tiempos de entrega, demanda):
  MAE. Además es robusto a los atípicos.
- **Hay que comunicar a alguien no técnico**: $R^2$ para el titular, MAE al lado
  para que el número tenga unidades.

> Una métrica sola nunca alcanza. Reporta al menos MAE y RMSE juntos: el hueco
> entre ambas dice dónde está fallando el modelo, algo que ninguna de las dos
> revela por separado.

## Comparar con la línea base

Antes de festejar cualquier número, calcula la métrica de un modelo trivial —la
media, o el valor del período anterior si es serie de tiempo—. Un RMSE de 4.2 no
significa nada hasta saber que el modelo tonto daba 4.3 o daba 40.
