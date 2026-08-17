La matriz de confusión es la tabla que cruza lo que pasó con lo que el modelo
dijo. Todas las métricas de clasificación salen de sus cuatro celdas.

|  | Predijo positivo | Predijo negativo |
| --- | --- | --- |
| **Es positivo** | Verdadero positivo (VP) | Falso negativo (FN) |
| **Es negativo** | Falso positivo (FP) | Verdadero negativo (VN) |

## Por qué el accuracy miente

$$
\text{Accuracy} = \frac{VP + VN}{VP + VN + FP + FN}
$$

Es la métrica más citada y la más engañosa. Con una enfermedad que afecta al 1%
de la población, el modelo que responde "sano" a todo el mundo obtiene **99% de
accuracy** y no detecta un solo caso. El número es correcto; la conclusión que
invita a sacar, no.

Cuando las clases están desbalanceadas, el accuracy mide sobre todo el tamaño de
la clase mayoritaria.

## Precisión y recall

$$
\text{Precisión} = \frac{VP}{VP + FP}
\qquad
\text{Recall} = \frac{VP}{VP + FN}
$$

Responden preguntas distintas:

- **Precisión**: de los que marqué como positivos, ¿cuántos lo eran? Importa
  cuando una falsa alarma es cara: bloquear la tarjeta de un cliente legítimo.
- **Recall**: de todos los positivos que existían, ¿cuántos alcancé a marcar?
  Importa cuando dejar pasar un caso es lo caro: un tumor sin detectar.

Se mueven en direcciones opuestas. Bajar el umbral de decisión sube el recall y
baja la precisión; subirlo hace lo contrario. Por eso el umbral de la
[[regresion-logistica]] es una decisión de negocio: estás eligiendo un punto en
esa curva.

## F1: el resumen, con su letra chica

$$
F_1 = 2 \cdot \frac{\text{Precisión} \cdot \text{Recall}}{\text{Precisión} + \text{Recall}}
$$

Media armónica, no aritmética: castiga los desequilibrios. Con precisión 1.0 y
recall 0.0, el promedio simple daría 0.5 y el $F_1$ da 0. Útil para comparar
modelos de un vistazo, malo para tomar decisiones: colapsa en un número los dos
errores que justamente necesitas distinguir.

```python
from sklearn.metrics import confusion_matrix, classification_report

print(confusion_matrix(y_prueba, y_pred))
print(classification_report(y_prueba, y_pred, digits=3))
```

> Lee siempre la matriz completa antes que cualquier métrica agregada. Las
> cuatro celdas dicen qué está fallando; un solo número dice cuánto, y a veces
> ni eso.

## El paralelo con regresión

El problema de fondo se repite en el otro lado del aprendizaje supervisado:
ninguna métrica única describe un modelo, y elegir cuál mirar es elegir qué
error estás dispuesto a cometer. La versión para variables continuas está en
[[metricas-de-regresion]].
