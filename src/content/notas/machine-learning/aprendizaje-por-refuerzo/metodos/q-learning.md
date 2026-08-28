Q-learning aprende una tabla $Q(s, a)$: cuánto vale, a largo plazo, tomar la
acción $a$ estando en el estado $s$. Con esa tabla, decidir es trivial — se elige
la acción de mayor valor.

## La actualización

$$
Q(s_t, a_t) \leftarrow Q(s_t, a_t) + \alpha \Big[ r_{t+1} + \gamma \max_{a} Q(s_{t+1}, a) - Q(s_t, a_t) \Big]
$$

Es [[aprendizaje-por-diferencias-temporales]] aplicado a pares estado-acción. La
pieza distintiva es el $\max_a$: al actualizar, se asume que **desde el siguiente
estado se jugará óptimamente**, aunque en la práctica el agente vaya a explorar.

## Off-policy: lo que lo hace especial

Ese $\max$ tiene una consecuencia grande. El agente **actúa** con una política
exploratoria (ε-greedy, típicamente) pero **aprende** sobre la política óptima.
Las dos están desacopladas.

Eso significa que puede aprender de experiencia que no generó él: partidas de
otro agente, registros históricos, demostraciones humanas. Es lo que abre la
puerta a [[deep-q-networks]] y a su memoria de repetición.

El contraste es SARSA, que usa $Q(s_{t+1}, a_{t+1})$ con la acción que realmente
tomó. SARSA aprende el valor de la política que está siguiendo, exploración
incluida — por eso resulta más conservador cerca del peligro.

## El algoritmo completo

```python
import numpy as np

Q = np.zeros((n_estados, n_acciones))

for episodio in range(n_episodios):
    s = entorno.reiniciar()
    epsilon = max(0.01, 1.0 * (0.995 ** episodio))
    terminado = False

    while not terminado:
        # Actuar explorando, con epsilon decreciente.
        a = (np.random.randint(n_acciones) if np.random.rand() < epsilon
             else int(np.argmax(Q[s])))

        s_sig, r, terminado = entorno.paso(a)

        # Aprender asumiendo juego óptimo desde el estado siguiente.
        mejor_futuro = 0 if terminado else np.max(Q[s_sig])
        Q[s, a] += alfa * (r + gamma * mejor_futuro - Q[s, a])

        s = s_sig
```

Las dos líneas que importan son las dos formas de elegir acción: la de arriba
explora y la de abajo aprende. Esa separación es todo el algoritmo, y la
estrategia de exploración que use la primera es un asunto aparte —
[[exploracion-y-explotacion]].

## Garantías y letra chica

Con estados y acciones finitos, visitando cada par infinitas veces y con una tasa
de aprendizaje que decae adecuadamente, **Q-learning converge a la política
óptima**. Es un resultado sólido y explica su popularidad.

La letra chica es "estados y acciones finitos". La tabla tiene un renglón por
estado:

- Un tablero de 4×4: 16 renglones. Trivial.
- Ajedrez: más estados que átomos en el universo observable.
- Cualquier entrada continua —una imagen, una lectura de sensores—: infinitos.

## El sesgo de sobrestimación

El $\max$ sobre valores estimados con ruido tiende a elegir el que quedó alto
**por error**, no por ser realmente el mejor. Ese sesgo se acumula y el agente
termina confiando de más en acciones mediocres. La corrección estándar es Double
Q-learning: separar quién elige la acción de quién evalúa su valor.

> Q-learning tabular es el mejor lugar para entender el refuerzo, y casi nunca es
> lo que se despliega. Cuando los estados no caben en una tabla, la tabla se
> reemplaza por una red neuronal: [[deep-q-networks]].
