Dos familias que resuelven problemas distintos y casi siempre se usan juntas.

## Simétrico: una sola llave

La misma llave cifra y descifra. Es rápido —AES cifra gigabytes por segundo con
aceleración por hardware— y por eso es lo que protege el contenido real.

$$
C = E_k(M), \qquad M = D_k(C)
$$

El problema es logístico y se llama **distribución de llaves**: para hablar con
alguien hay que hacerle llegar la llave primero, y si el canal fuera seguro no
haría falta cifrar. Con $n$ participantes hacen falta $n(n-1)/2$ llaves.

## Asimétrico: un par de llaves

Cada quien tiene una llave pública y una privada. Lo que cifra una, solo lo
descifra la otra.

- **Cifrar** con la pública ⇒ solo el dueño de la privada lee.
- **Firmar** con la privada ⇒ cualquiera verifica quién lo emitió.

Resuelve la distribución de llaves, y a cambio es órdenes de magnitud más lento.

## Por eso se combinan

TLS —lo que protege cada `https://`— usa las dos: asimétrico al inicio para
acordar una llave de sesión, simétrico después para todo el tráfico.

```python
# El patrón, en una línea de pseudocódigo:
llave_sesion = intercambio_asimetrico()   # caro, una sola vez
datos        = AES(llave_sesion, mensaje) # barato, todo el tiempo
```

> El error clásico no es elegir mal el algoritmo: es implementarlo a mano.
> Usa bibliotecas establecidas. La criptografía rota se ve idéntica a la
> criptografía sana desde afuera.

Firmar el documento entero sería lento, así que en la práctica se firma su
huella. Eso lo hacen las [[funciones-hash]].
