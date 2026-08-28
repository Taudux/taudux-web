El aprendizaje supervisado es el caso en el que alguien ya se tomó la molestia
de responder. Tenemos ejemplos donde conocemos tanto las características como el
resultado, y queremos una función que, ante un caso nuevo del que solo vemos las
características, acierte el resultado.

## Los tres ingredientes

Todo problema supervisado, sin importar el algoritmo, se arma con lo mismo:

1. **Datos etiquetados.** Un conjunto de pares $(x_i, y_i)$, donde $x_i$ son las
   características observadas y $y_i$ la respuesta conocida.
2. **Una familia de funciones.** El espacio de modelos donde vamos a buscar: rectas,
   árboles, redes. Elegir la familia es elegir qué formas de relación admitimos.
3. **Una función de pérdida.** Cómo se mide equivocarse. Es la parte que más se
   descuida y la que más determina el resultado.

Entrenar es recorrer la familia buscando la función que minimiza la pérdida
promedio sobre los datos:

$$
\hat{f} = \arg\min_{f \in \mathcal{F}} \frac{1}{n} \sum_{i=1}^{n} L\big(y_i, f(x_i)\big)
$$

## Regresión y clasificación

La naturaleza de $y$ parte el mundo supervisado en dos:

| Si $y$ es… | El problema es… | Ejemplo |
| --- | --- | --- |
| Un número continuo | Regresión | Predecir el precio de una casa |
| Una categoría | Clasificación | Decidir si un correo es spam |

No es una distinción cosmética: cambia la pérdida, cambia la métrica y cambia
cómo se lee el resultado. La puerta de entrada a la primera rama es
[[regresion-lineal]].

## Lo que de verdad se está pidiendo

Minimizar el error sobre los datos que ya tenemos es fácil: basta memorizarlos.
Un modelo con suficiente capacidad puede llegar a error cero en entrenamiento y
ser inservible con datos nuevos. Eso es **sobreajuste**, y es el motivo por el
que ningún resultado de entrenamiento se reporta como si fuera el desempeño real.

```python
from sklearn.model_selection import train_test_split

# La partición va ANTES de mirar los datos, no después de elegir el modelo.
X_entrena, X_prueba, y_entrena, y_prueba = train_test_split(
    X, y, test_size=0.2, random_state=42
)
```

> El conjunto de prueba se toca una sola vez, al final. Si se usa para decidir
> algo —qué modelo, qué hiperparámetro, qué variables— deja de estimar el
> desempeño futuro y pasa a ser parte del entrenamiento.

## Dónde termina lo supervisado

Todo lo anterior descansa en un supuesto costoso: que las etiquetas existen.
Etiquetar suele ser lento, caro y a veces imposible. Cuando no hay $y$, el
problema cambia de naturaleza —no solo de algoritmo— y entramos en
[[que-es-el-aprendizaje-no-supervisado]].

Y hay un tercer caso, distinto de los dos: cuando no existe una respuesta
correcta que copiar sino solo una señal de qué tan bien va saliendo, y donde cada
decisión cambia el problema siguiente. Eso es
[[que-es-el-aprendizaje-por-refuerzo]].
