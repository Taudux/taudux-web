Un ataque nuevo no está en ninguna lista de firmas. Lo único que se puede
afirmar es que **no se parece a lo normal** — y eso convierte la detección en un
problema de aprendizaje no supervisado.

## Por qué no basta con reglas

Las reglas cubren lo conocido: esta IP, este hash de archivo, esta secuencia. Son
precisas y rapidísimas, y no ven nada que no se les haya escrito antes. El
atacante que cambia un byte deja de coincidir.

La detección por anomalías invierte la pregunta: en vez de describir lo malo
—una lista infinita y siempre incompleta— describe **lo normal**, y marca lo que
se sale.

## El desbalance que lo domina todo

Los ataques son rarísimos. En millones de sesiones legítimas puede haber
decenas maliciosas, y ahí el accuracy es inútil: decir "todo normal" acierta el
99.99% de las veces sin detectar nada.

Lo que manda es el costo asimétrico:

| Error | Qué cuesta |
| --- | --- |
| Falso negativo | Un intruso adentro, meses sin que nadie lo note |
| Falso positivo | Tiempo de analista, y fatiga de alertas |

La fatiga de alertas es real y peligrosa: un sistema que grita mil veces al día
se termina ignorando, y entonces vale lo mismo que no tenerlo.

## Herramientas prestadas del clustering

**Densidad.** [[dbscan]] encaja casi por diseño: no exige decir cuántos grupos
hay y **etiqueta como ruido** lo que no pertenece a ninguna región densa. En
detección de intrusiones ese ruido es justo lo que interesa mirar.

**Distancia al centro.** Con [[k-means]] sobre el tráfico normal, un punto muy
lejano a todos los centroides es sospechoso. Más simple, y hereda el supuesto de
grupos redondos: si el comportamiento legítimo tiene formas alargadas, marcará
como anómalo lo que solo era distinto.

```python
from sklearn.cluster import DBSCAN

etiquetas = DBSCAN(eps=0.35, min_samples=10).fit_predict(sesiones_escaladas)
sospechosas = sesiones[etiquetas == -1]   # -1 es ruido: lo que no encajó
```

> Escalar es obligatorio: bytes transferidos y duración en segundos no viven en
> la misma magnitud, y sin normalizar la distancia la decide una sola columna.

## El límite honesto

"Anómalo" no significa "malicioso". Un despliegue nuevo, un cierre de mes o un
equipo recién incorporado generan comportamiento inédito y perfectamente
legítimo. La salida de estos modelos es **una cola de revisión priorizada**, no
un veredicto.
