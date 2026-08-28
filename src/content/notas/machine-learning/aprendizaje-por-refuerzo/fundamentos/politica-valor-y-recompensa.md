Son tres cosas distintas y se mezclan todo el tiempo. La diferencia entre
recompensa y valor es la que más cuesta.

## Recompensa: lo inmediato

$r_t$ es lo que el entorno devuelve **ahora**, tras una acción. Es un número
suelto y de corto plazo. La define quien diseña el problema, y definirla mal es
la forma más común de arruinarlo todo.

## Valor: lo que viene después

$V^\pi(s)$ es la recompensa **acumulada esperada** desde el estado $s$ siguiendo
la política $\pi$:

$$
V^{\pi}(s) = \mathbb{E}_{\pi}\!\left[\sum_{k=0}^{\infty} \gamma^{k} r_{t+k+1} \;\middle|\; s_t = s\right]
$$

La distinción práctica: un estado puede dar **recompensa baja y valor alto**.
Estudiar hoy no paga nada inmediato, pero coloca en una posición desde la cual
todo lo que sigue es mejor. **El agente decide por valor, no por recompensa.**

También existe la versión por acción, $Q^\pi(s, a)$: el valor de tomar $a$ en $s$
y después seguir con $\pi$. Es la que usan casi todos los algoritmos, porque de
ella se lee directamente qué hacer.

## Política: la regla de decisión

$\pi(a \mid s)$ es qué acción tomar en cada estado. **Es lo que se aprende y lo
único que se despliega.** Puede ser determinista (siempre la misma acción) o
estocástica (una distribución sobre acciones).

Con $Q$ conocida, la política óptima sale sin esfuerzo:

$$
\pi^*(s) = \arg\max_a Q^*(s, a)
$$

## La ecuación de Bellman

Conecta las tres piezas. El valor de un estado es la recompensa inmediata más el
valor descontado de a dónde te lleva:

$$
V^{\pi}(s) = \sum_a \pi(a \mid s) \sum_{s'} P(s' \mid s, a)\,\big[R(s,a) + \gamma V^{\pi}(s')\big]
$$

Lo importante no es la fórmula sino su forma: **es recursiva**. El valor de hoy
se define en términos del valor de mañana. Toda la familia de algoritmos de
[[aprendizaje-por-diferencias-temporales]] sale de convertir esa recursión en una
regla de actualización que se puede aplicar con experiencia real, sin conocer $P$.

## El peligro de diseñar la recompensa

El agente optimiza **exactamente** lo que escribiste, no lo que querías decir.

```python
# Intención: que el robot de limpieza recoja basura.
recompensa = basura_recogida        # el agente tira basura para recogerla otra vez

# Intención: que el barco de carreras gane.
recompensa = puntos_obtenidos       # el agente da vueltas en círculo sobre los premios
```

Ambos son casos reales. Se llama *reward hacking*, y no es un fallo del
algoritmo: el agente encontró la solución óptima al problema que realmente le
planteaste. La recompensa debe describir **el objetivo**, no el comportamiento
que imaginas que lleva a él.

> La otra decisión de diseño es $\gamma$, que ya aparece en
> [[procesos-de-decision-de-markov]]. Bajarlo hace al agente cortoplacista;
> subirlo demasiado hace que el valor de estados lejanos domine y el aprendizaje
> se vuelva inestable.
