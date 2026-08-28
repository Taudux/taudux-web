Un proceso de decisión de Markov (MDP) es la forma estándar de escribir un
problema de refuerzo. Es una tupla de cinco elementos:

$$
\langle S, A, P, R, \gamma \rangle
$$

- $S$: los estados posibles.
- $A$: las acciones disponibles.
- $P(s' \mid s, a)$: la probabilidad de terminar en $s'$ tomando $a$ desde $s$.
- $R(s, a)$: la recompensa esperada.
- $\gamma$: el factor de descuento.

## El supuesto de Markov

Es lo único que hay que entender de verdad:

> **El estado actual contiene toda la información necesaria para decidir. El
> pasado no aporta nada más.**

Formalmente:

$$
P(s_{t+1} \mid s_t, a_t) = P(s_{t+1} \mid s_1, a_1, \dots, s_t, a_t)
$$

Sin esto, decidir bien exigiría recordar toda la historia y el problema sería
intratable. Con esto, basta mirar dónde estás.

## Cuando el supuesto no se cumple

Casi nunca se cumple solo: **hay que construir el estado para que se cumpla.**

La posición de una pelota en una foto no basta para decidir — no sabes hacia
dónde va. La posición sola **no es** un estado de Markov. Dos soluciones
habituales:

- **Apilar observaciones**: usar los últimos 4 cuadros en vez de uno. Es lo que
  hicieron los agentes de Atari, y así la velocidad queda implícita en el estado.
- **Agregar variables derivadas**: velocidad, aceleración, tiempo transcurrido.

Diseñar el estado es la mitad del trabajo de plantear un problema de refuerzo, y
la parte que menos se enseña.

## Un ejemplo mínimo

```python
# Inventario diario. El estado es lo que hay en bodega; la acción, cuánto pedir.
estados  = range(0, 21)          # unidades en existencia
acciones = range(0, 11)          # unidades a ordenar

def recompensa(existencia, pedido, demanda):
    disponible = min(existencia + pedido, 20)
    vendido    = min(disponible, demanda)
    return 12 * vendido - 4 * pedido - 0.5 * (disponible - vendido)
    #      ingreso        costo        almacenamiento
```

La existencia de hoy **sí** resume lo que hace falta para decidir: cómo se llegó
a tener 8 unidades no cambia cuál es el pedido óptimo. El supuesto se sostiene.

## Qué se busca

La **política óptima** $\pi^*$: la que maximiza la recompensa acumulada esperada
desde cualquier estado. Un resultado clásico garantiza que en todo MDP finito
existe al menos una política óptima determinista.

Cuando $P$ y $R$ se conocen, se puede calcular directamente con programación
dinámica. El problema real es que casi nunca se conocen: nadie tiene la tabla de
probabilidades de transición del mundo. De ahí sale todo lo demás —aprender
[[politica-valor-y-recompensa]] a partir de la experiencia, sin conocer el
modelo del entorno.
