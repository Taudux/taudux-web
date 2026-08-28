Un [[arboles-de-decision]] solo tiene varianza altísima: cambia unas filas y
cambia el árbol. Random Forest convierte ese defecto en la solución — entrena
**muchos** árboles inestables y promedia sus votos.

## Las dos fuentes de azar

Promediar árboles solo funciona si los árboles se equivocan de formas
**distintas**. Si todos cometen el mismo error, el promedio lo conserva. Random
Forest fuerza esa diversidad dos veces:

1. **Bagging.** Cada árbol se entrena sobre una muestra con reemplazo del
   conjunto original. Cada uno ve una versión ligeramente distinta del mundo.
2. **Submuestreo de variables.** En cada nodo, el árbol solo puede elegir entre
   un subconjunto aleatorio de columnas.

El segundo punto es el que le da el nombre y el que de verdad importa. Sin él,
si una variable es muy predictiva, **todos** los árboles la pondrían en la raíz
y quedarían casi idénticos. Obligarlos a ignorarla a veces los decorrelaciona, y
esa decorrelación es de donde sale la ganancia.

```python
from sklearn.ensemble import RandomForestClassifier

bosque = RandomForestClassifier(
    n_estimators=500,        # más árboles nunca empeora; solo cuesta tiempo
    max_features="sqrt",     # el submuestreo de columnas: la pieza clave
    n_jobs=-1,
    random_state=42,
).fit(X_entrena, y_entrena)
```

## Por qué se volvió el punto de partida

- Casi no se sobreajusta al agregar árboles: `n_estimators` alto es seguro.
- Funciona bien con los valores por omisión. Es raro que valga la pena ajustarlo
  mucho.
- No necesita escalado, hereda eso de los árboles.
- Trae una estimación de error **gratis**: cada árbol dejó fuera ~37% de los
  datos (out-of-bag), y esos sirven para evaluarlo sin apartar un conjunto.

## La trampa de la importancia de variables

`feature_importances_` es de lo más consultado y de lo más malinterpretado. La
importancia por impureza **favorece a las variables con muchos valores
distintos**: un identificador numérico o una fecha pueden salir en primer lugar
sin aportar nada real.

```python
# Más lenta pero honesta: mide cuánto empeora el modelo al desordenar
# cada columna, sobre datos que el bosque no usó para entrenar.
from sklearn.inspection import permutation_importance
importancia = permutation_importance(bosque, X_prueba, y_prueba, n_repeats=10)
```

Y aun así, importancia **no es causalidad**: dice que la variable ayuda a
predecir, no que intervenir sobre ella cambie el resultado.

## Lo que se pierde

La interpretabilidad. Un árbol se imprime y se explica; quinientos árboles
promediados, no. Se gana precisión y estabilidad, se pierde la regla legible —
que era la mitad del atractivo del árbol solo.

> Random Forest construye los árboles **en paralelo e independientes**. El
> [[boosting]] hace lo contrario: los construye en cadena, cada uno corrigiendo
> los errores del anterior. Esa diferencia explica casi todo lo demás.
