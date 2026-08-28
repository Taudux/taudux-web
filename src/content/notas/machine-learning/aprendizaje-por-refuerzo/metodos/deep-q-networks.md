[[q-learning]] necesita una tabla con un renglón por estado. Con una pantalla de
Atari como entrada, esa tabla no existe. DQN la reemplaza por una red neuronal
$Q(s, a; \theta)$ que **aproxima** la misma función.

Es el trabajo que en 2015 aprendió a jugar 49 juegos de Atari por encima del
nivel humano, con la misma arquitectura y sin cambiar nada entre juegos: solo
píxeles y puntaje.

## Por qué la sustitución directa no funciona

Poner una red donde estaba la tabla y entrenar con descenso de gradiente diverge.
Dos razones:

1. **Las muestras están correlacionadas.** Los cuadros consecutivos de un juego se
   parecen muchísimo. El entrenamiento supervisado supone muestras independientes;
   acá llegan en secuencia y la red se especializa en lo último que vio.
2. **El objetivo se mueve.** En la actualización TD, el valor objetivo se calcula
   con la propia red. Al ajustar los pesos cambia la predicción **y** el objetivo
   a la vez. Es perseguir algo que huye al mismo ritmo.

## Los dos trucos

**Memoria de repetición (experience replay).** Las transiciones
$(s, a, r, s')$ se guardan en un buffer grande y el entrenamiento toma **lotes
aleatorios** de ahí. Eso rompe la correlación temporal y además reaprovecha cada
experiencia muchas veces. Solo es posible porque Q-learning es *off-policy*:
puede aprender de transiciones generadas por una política vieja.

**Red objetivo (target network).** Una copia congelada de la red, $\theta^-$, que
se usa para calcular el objetivo y solo se sincroniza cada N pasos:

$$
y = r + \gamma \max_{a'} Q(s', a'; \theta^-)
$$

El objetivo deja de moverse en cada paso y el entrenamiento se estabiliza.

```python
# El ciclo, sin el detalle de la red.
buffer.agregar(s, a, r, s_sig, terminado)

if len(buffer) > tamano_minimo:
    lote = buffer.muestra(64)                    # rompe la correlación temporal

    with torch.no_grad():
        # La red CONGELADA calcula el objetivo.
        objetivo = lote.r + gamma * red_objetivo(lote.s_sig).max(1).values * (~lote.terminado)

    perdida = F.smooth_l1_loss(red(lote.s).gather(1, lote.a), objetivo)
    perdida.backward()

if paso % 1000 == 0:
    red_objetivo.load_state_dict(red.state_dict())
```

## Sus límites

- Solo sirve con **acciones discretas**: el $\max_{a'}$ exige recorrerlas todas.
  Para control continuo hacen falta otros métodos (DDPG, SAC, PPO).
- Sigue siendo **muy costoso en datos**: los agentes de Atari necesitaron
  decenas de millones de cuadros por juego.
- Hereda la sobrestimación de Q-learning, agravada por el ruido de la red. Double
  DQN es la corrección estándar y es casi gratis.

## Lo que dejó

DQN mostró que la aproximación por función podía funcionar en refuerzo si se
estabilizaba el entrenamiento. Las mejoras posteriores —Double, Dueling,
prioridad en el buffer, n-step, distribucional— se combinaron en Rainbow, y de
ahí en adelante la familia de métodos de política (PPO) tomó el relevo en la
mayoría de las aplicaciones.

> El patrón general vale más que el algoritmo: cuando el espacio de estados no
> cabe en una tabla, se aproxima; y aproximar rompe los supuestos que hacían
> converger al método tabular. Los dos trucos de DQN son parches a ese choque, no
> detalles de implementación.
