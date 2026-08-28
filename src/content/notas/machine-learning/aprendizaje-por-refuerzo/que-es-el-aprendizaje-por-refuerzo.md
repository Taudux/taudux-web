
Un agente actúa sobre un entorno, el entorno le devuelve una recompensa y un
estado nuevo, y el agente ajusta su forma de decidir. Repetido millones de veces,
eso produce una estrategia.

No hay conjunto de datos. **Los datos se generan actuando.**

## En qué se diferencia de lo demás

| | Supervisado | No supervisado | Refuerzo |
| --- | --- | --- | --- |
| Qué recibe | La respuesta correcta | Nada | Una recompensa |
| De dónde salen los datos | Están dados | Están dados | El agente los genera |
| Qué optimiza | El error de cada caso | Estructura interna | Recompensa acumulada futura |
| Las decisiones... | son independientes | — | cambian lo que viene después |

Y a diferencia de [[que-es-el-aprendizaje-no-supervisado]], acá sí hay una señal
de qué tan bien vas: pobre, tardía y ruidosa, pero existe.

En [[que-es-el-aprendizaje-supervisado]] alguien te dice "la respuesta era 7".
Acá solo te dicen "eso estuvo mal", sin decirte qué era lo correcto. Y a veces
te lo dicen cien pasos después.

## Los tres problemas que lo hacen difícil

**1. La recompensa llega tarde.** En ajedrez solo sabes si ganaste al final. ¿Cuál
de las cuarenta jugadas fue la buena? Se llama el *problema de asignación de
crédito* y es el corazón del asunto.

**2. Las decisiones se encadenan.** En clasificación, equivocarte en una fila no
afecta a la siguiente. Acá una mala acción te deja en un estado peor, desde el
que todo lo demás empeora. Los errores se acumulan.

**3. Hay que elegir entre saber y ganar.** Para descubrir una acción mejor tienes
que probarla, y probar cuesta. Ver [[exploracion-y-explotacion]].

## El vocabulario mínimo

- **Agente**: quien decide.
- **Entorno**: todo lo demás.
- **Estado** ($s$): la situación actual.
- **Acción** ($a$): lo que el agente puede hacer.
- **Recompensa** ($r$): la señal numérica que devuelve el entorno.
- **Política** ($\pi$): la regla que va del estado a la acción. **Es lo que se
  aprende.**

El objetivo no es maximizar la recompensa inmediata sino la **acumulada**, con
las futuras descontadas:

$$
G_t = \sum_{k=0}^{\infty} \gamma^k r_{t+k+1}, \qquad 0 \le \gamma < 1
$$

Ese $\gamma$ es la paciencia del agente. Cerca de 0, solo le importa lo
inmediato; cerca de 1, planea a largo plazo. La formalización completa está en
[[procesos-de-decision-de-markov]].

## Dónde se usa de verdad

Juegos (AlphaGo, Atari), robótica, control de sistemas físicos —enfriamiento de
centros de datos, redes eléctricas—, gestión de inventario, y el ajuste fino de
modelos de lenguaje con retroalimentación humana (RLHF).

## La advertencia importante

Es la rama más costosa de las tres. Necesita **millones de interacciones**, y en
el mundo físico eso no siempre existe: un robot no puede caerse un millón de
veces. Por eso casi todo se entrena en simulación, y el salto de la simulación a
la realidad es un problema abierto.

> Si tu problema se puede plantear como predicción con datos ya etiquetados,
> resuélvelo así. El refuerzo es para cuando **la decisión de hoy cambia el
> problema de mañana**, y esa es una condición mucho más rara de lo que parece.
