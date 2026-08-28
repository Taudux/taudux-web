Conoces un restaurante que te gusta. Hay uno nuevo enfrente. ¿Vas al seguro o
pruebas? Si siempre vas al seguro, nunca descubrirás el mejor. Si siempre
pruebas, comerás mal la mayor parte del tiempo.

Ese es el dilema completo, y no tiene solución perfecta: **explorar cuesta
recompensa hoy y la única forma de saber si algo es mejor es probarlo.**

## Por qué no basta con explotar

Un agente que siempre elige la acción de mayor valor estimado se queda atrapado
en la primera opción que le salió bien. Nunca prueba la alternativa, así que su
estimación de ella nunca mejora, así que nunca la elige. El ciclo se cierra solo.

Se llama **convergencia prematura**, y es el modo de fallo más común de un agente
que "aprendió" y se quedó en algo mediocre.

## ε-greedy

La estrategia más usada, por simple:

$$
a =
\begin{cases}
\text{acción aleatoria} & \text{con probabilidad } \varepsilon \\[4pt]
\arg\max_a Q(s,a) & \text{con probabilidad } 1 - \varepsilon
\end{cases}
$$

```python
import numpy as np

def elegir_accion(Q, estado, epsilon, n_acciones):
    if np.random.rand() < epsilon:
        return np.random.randint(n_acciones)
    return int(np.argmax(Q[estado]))

# epsilon alto al inicio (no sabes nada) y decreciente después:
# explorar al azar cuando ya aprendiste solo tira recompensa a la basura.
epsilon = max(0.01, 1.0 * (0.995 ** episodio))
```

Ese decaimiento importa tanto como la estrategia. Un $\varepsilon$ fijo en 0.1
significa que el agente entrenado seguirá haciendo tonterías el 10% del tiempo,
para siempre.

## Otras estrategias

- **Softmax / Boltzmann.** Elige con probabilidad proporcional al valor estimado.
  Mejor que ε-greedy porque no trata igual a la segunda mejor acción que a la
  peor de todas.
- **Optimismo inicial.** Se inicializa $Q$ con valores altísimos. Como toda
  acción decepciona al probarla, el agente recorre todas las opciones por sí
  solo, sin azar.
- **UCB.** Suma un bono a las acciones poco probadas: $\bar{x}_a + c\sqrt{\ln t / n_a}$.
  Explora dirigido, no al azar.

## En problemas grandes esto se rompe

La exploración aleatoria funciona mientras el espacio sea chico. Cuando la
recompensa está muy lejos —el agente tiene que ejecutar cien acciones correctas
seguidas para recibir el primer punto—, el azar nunca da con la secuencia. Es el
problema de la **recompensa escasa**, y ahí hacen falta métodos de exploración
dirigida por curiosidad o recompensas intermedias diseñadas a mano.

> Estas estrategias son ortogonales al algoritmo de aprendizaje: ε-greedy es la
> forma habitual de elegir acciones tanto en [[q-learning]] como en casi todo lo
> demás. Aprender los valores y decidir cómo actuar mientras los aprendes son
> dos problemas separados.
