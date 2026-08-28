El problema del carrito de compras: dado un montón de transacciones, ¿qué
productos aparecen juntos más de lo que el azar explicaría? El resultado es una
regla de la forma **{pan, mantequilla} → {mermelada}**.

## Las tres métricas

Para una regla $A \rightarrow B$:

**Soporte** — qué tan frecuente es el conjunto completo.

$$
\text{soporte}(A \cup B) = \frac{\text{transacciones con } A \text{ y } B}{\text{total}}
$$

**Confianza** — de los que llevaron $A$, cuántos llevaron $B$.

$$
\text{confianza} = \frac{\text{soporte}(A \cup B)}{\text{soporte}(A)}
$$

**Lift** — la única que dice si hay relación de verdad.

$$
\text{lift} = \frac{\text{confianza}}{\text{soporte}(B)}
$$

## Por qué la confianza sola engaña

Supongamos que el 80% de las transacciones incluyen bolsas. Cualquier regla
`{lo que sea} → {bolsa}` tendrá ~80% de confianza, y no significa nada: la bolsa
se lleva sola.

El lift corrige exactamente eso comparando contra la frecuencia base de $B$:

- **lift > 1**: aparecen juntos más de lo esperado. Hay señal.
- **lift = 1**: independientes. La regla no aporta.
- **lift < 1**: se excluyen entre sí, lo cual también es información útil.

En el ejemplo de la bolsa, el lift sería ≈ 1 y la regla queda descartada sola.

## Apriori

Se apoya en una observación simple: **si un conjunto es poco frecuente, cualquier
conjunto que lo contenga lo será todavía menos**. Eso permite podar el espacio de
búsqueda sin revisarlo entero.

Recorre por niveles: primero los productos individuales frecuentes, luego los
pares que se pueden formar con ellos, luego los tríos. Su costo es que **recorre
la base de datos una vez por nivel**, lo que con muchas transacciones se vuelve
caro.

## FP-Growth

Comprime todas las transacciones en un árbol de prefijos (FP-tree) donde los
caminos compartidos se guardan una sola vez, y extrae los patrones recorriendo
ese árbol. **Dos lecturas de la base de datos en total**, sin generar candidatos.

En la práctica es varias veces más rápido y devuelve exactamente lo mismo. Salvo
que el conjunto sea pequeño, es el que conviene usar.

```python
from mlxtend.frequent_patterns import fpgrowth, association_rules
import pandas as pd

# Las transacciones van en formato one-hot: una fila por ticket,
# una columna booleana por producto.
frecuentes = fpgrowth(cesta, min_support=0.02, use_colnames=True)

reglas = association_rules(frecuentes, metric="lift", min_threshold=1.2)
print(reglas.sort_values("lift", ascending=False).head(10))
```

## Elegir el umbral de soporte

Es la decisión que define el resultado. Muy alto y solo salen las obviedades que
ya conocías; muy bajo y el número de reglas explota hasta volverse inmanejable, y
además aparecen patrones sostenidos por un puñado de transacciones. Se empieza
alto y se baja hasta que aparezca algo que no sabías y que siga teniendo
suficientes casos detrás.

> Como todo lo no supervisado, encontrar el patrón no es lo difícil: lo difícil
> es distinguir el patrón real de la coincidencia. Ver
> [[que-es-el-aprendizaje-no-supervisado]].
