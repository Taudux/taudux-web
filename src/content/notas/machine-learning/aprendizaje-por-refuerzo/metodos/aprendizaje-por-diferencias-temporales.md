Hay dos formas de aprender el valor de un estado a partir de la experiencia.

**Monte Carlo**: juegas la partida completa, ves el resultado y corriges. Honesto
pero lento, y **imposible si la tarea no termina nunca**.

**Diferencias temporales**: corriges en cada paso, usando tu propia estimación
del siguiente estado como si fuera el resultado real.

## La actualización

$$
V(s_t) \leftarrow V(s_t) + \alpha \underbrace{\big[\, r_{t+1} + \gamma V(s_{t+1}) - V(s_t) \,\big]}_{\text{error TD}}
$$

El corchete es el **error TD**: la diferencia entre lo que creías que valía este
estado y lo que ahora parece valer, vista la recompensa que acabas de recibir y
el estado al que llegaste.

## Bootstrapping

Ahí está la idea rara y potente: **se actualiza una estimación usando otra
estimación**. No se espera a conocer la verdad; se usa la predicción actual del
siguiente estado como sustituto.

Suena a hacer trampa —y de hecho introduce sesgo—, pero funciona porque el
componente real, la recompensa $r_{t+1}$, es información verdadera que entra en
cada paso. Con el tiempo esa verdad se propaga hacia atrás por toda la cadena de
estados.

| | Monte Carlo | TD |
| --- | --- | --- |
| Cuándo aprende | Al terminar el episodio | En cada paso |
| Tareas infinitas | No sirve | Sí sirve |
| Sesgo | Sin sesgo | Con sesgo |
| Varianza | Alta | Baja |
| Velocidad | Lenta | Rápida |

```python
# TD(0) para estimar el valor de una política dada.
for episodio in range(n_episodios):
    s = entorno.reiniciar()
    terminado = False
    while not terminado:
        a = politica(s)
        s_siguiente, r, terminado = entorno.paso(a)

        # Si el episodio terminó, no hay estado siguiente que valga nada:
        # olvidarlo hace que el agente crea que después del final sigue ganando.
        objetivo = r + (0 if terminado else gamma * V[s_siguiente])
        V[s] += alfa * (objetivo - V[s])

        s = s_siguiente
```

## Por qué importa

Casi todo el refuerzo moderno es TD por dentro. [[q-learning]] es exactamente
esta actualización aplicada a $Q(s,a)$ en vez de a $V(s)$, tomando el máximo
sobre las acciones del estado siguiente. Y el error TD es también la señal que
usan los métodos actor-crítico para saber si una acción salió mejor o peor de lo
esperado.

## El parámetro α

La tasa de aprendizaje decide cuánto se le hace caso a cada corrección. Muy alta
y las estimaciones oscilan sin asentarse; muy baja y el aprendizaje se arrastra.
Con entornos deterministas se puede subir; con entornos ruidosos hay que bajarla,
porque cada observación aislada dice poco.

> Todo esto estima [[politica-valor-y-recompensa]] sin conocer las
> probabilidades de transición del entorno. Ese es el punto: aprender a decidir
> bien sin tener un modelo del mundo.
