Un árbol de decisión hace lo que haría una persona: preguntas sucesivas que
parten los datos. *¿Ingreso mayor a 30 000? ¿Antigüedad menor a 2 años?* Cada
respuesta lleva a una rama y cada hoja emite una predicción.

## Cómo elige las preguntas

En cada nodo prueba todos los cortes posibles de todas las variables y se queda
con el que deja los grupos **más puros**. La pureza se mide con Gini:

$$
G = 1 - \sum_{c=1}^{C} p_c^2
$$

$G = 0$ significa que en ese nodo quedó una sola clase. El árbol elige el corte
que más reduce la impureza ponderada de los hijos, y repite hacia abajo.

Es un algoritmo **voraz**: elige el mejor corte de este nodo sin considerar qué
consecuencias tendrá tres niveles después. Por eso no garantiza el mejor árbol
posible, solo uno bueno construido rápido.

```python
from sklearn.tree import DecisionTreeClassifier, plot_tree

# Sin límites, el árbol crece hasta que cada hoja tiene un solo ejemplo:
# accuracy perfecto en entrenamiento y un modelo inservible con datos nuevos.
arbol = DecisionTreeClassifier(
    max_depth=4,
    min_samples_leaf=20,
    random_state=42,
).fit(X_entrena, y_entrena)

plot_tree(arbol, feature_names=columnas, filled=True, fontsize=8)
```

## Lo que lo hace distinto

- **Se lee.** Es el único modelo que se puede imprimir y explicar a alguien sin
  formación técnica. Un banco puede justificar por qué rechazó un crédito.
- **No necesita escalado.** Solo compara valores contra un umbral, así que las
  unidades le dan igual — a diferencia de [[k-vecinos-mas-cercanos]] o de
  cualquier modelo basado en distancia.
- **Captura interacciones.** Que una variable importe solo cuando otra supera
  cierto valor es justamente lo que un árbol representa de forma natural.
- **Acepta relaciones no lineales** sin transformar nada.

## Su defecto es grave

**Un árbol solo tiene varianza altísima.** Cambia un puñado de filas del
conjunto de entrenamiento y el árbol resultante puede ser completamente distinto:
otra variable en la raíz, otra estructura, otras reglas. Eso significa que las
reglas que tanto se presumen de interpretables son, en buena medida, un accidente
de la muestra.

Hay dos salidas:

1. **Podar**: limitar `max_depth`, exigir un mínimo de ejemplos por hoja. Reduce
   la varianza sacrificando capacidad.
2. **Promediar muchos árboles**: es la idea de [[random-forest]], y es lo que
   convirtió a los árboles en la familia más usada con datos tabulares.

> Un árbol sin límites siempre llega a 100% de acierto en entrenamiento. Ese
> número no dice nada: mide memorización. La evaluación real se lee en la
> [[matriz-de-confusion]] sobre datos que el modelo no vio.
