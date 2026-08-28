Una función hash convierte una entrada de cualquier tamaño en una salida de
tamaño fijo. No es cifrado: **no hay vuelta atrás**, y esa es justamente la
gracia.

## Las tres propiedades

1. **Determinista.** La misma entrada da siempre la misma salida.
2. **Efecto avalancha.** Cambiar un bit cambia la mitad de la salida.
3. **Resistente a colisiones.** Encontrar dos entradas con el mismo hash debe
   ser computacionalmente inviable.

```python
import hashlib

hashlib.sha256(b"contrasena").hexdigest()[:16]   # '5e884898da280471'
hashlib.sha256(b"contrasenb").hexdigest()[:16]   # 'e2ab5e4e0d1e3b58'
```

Una letra de diferencia y no queda nada en común. Por eso sirve para detectar
que un archivo cambió: basta comparar dos cadenas cortas.

## Contraseñas: el caso especial

Guardar contraseñas con SHA-256 **está mal**, aunque suene contradictorio. El
problema es que SHA-256 es *rápida*: un atacante con la base robada prueba miles
de millones de candidatas por segundo.

Para contraseñas se usan funciones **deliberadamente lentas** —bcrypt, scrypt,
Argon2— y con **sal**: un valor aleatorio por usuario que se guarda junto al
hash.

| Sin sal | Con sal |
| --- | --- |
| Dos usuarios con la misma contraseña tienen el mismo hash | Cada uno tiene un hash distinto |
| Una tabla precalculada las rompe todas de golpe | La tabla precalculada no sirve |

## Firmar es hashear primero

Firmar con [[cifrado-simetrico-y-asimetrico]] es caro y el documento puede pesar
megabytes. Lo que se firma en realidad es su hash: un valor corto y de tamaño
fijo que identifica al documento entero. Si el documento cambia aunque sea en
una coma, el hash ya no coincide y la firma deja de validar.
