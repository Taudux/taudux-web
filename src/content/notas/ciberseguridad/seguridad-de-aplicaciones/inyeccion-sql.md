La inyección SQL lleva más de dos décadas encabezando las listas de
vulnerabilidades, y la causa siempre es la misma: **se construyó una consulta
pegando texto**.

## Cómo ocurre

```python
# NUNCA hagas esto.
consulta = f"SELECT * FROM usuarios WHERE correo = '{correo}'"
```

Si alguien escribe como correo `' OR '1'='1`, la consulta que llega a la base es:

```sql
SELECT * FROM usuarios WHERE correo = '' OR '1'='1'
```

`'1'='1'` es cierto para toda fila, así que devuelve la tabla completa. Con un
`;` de por medio se pueden encadenar sentencias y llegar a `DROP TABLE`.

El problema de fondo: la base no distingue **dato** de **instrucción**. Recibe
una cadena y la interpreta entera como código.

## La solución real

Consultas parametrizadas. El dato viaja **por un canal aparte** y nunca se
interpreta como SQL:

```python
cursor.execute(
    "SELECT * FROM usuarios WHERE correo = %s",
    (correo,)          # el valor va aparte; la base ya sabe que es un dato
)
```

Esto no es "escapar mejor las comillas". Es que la instrucción se compila antes
de que el valor aparezca, así que ya no hay forma de que el valor cambie su
estructura.

> Filtrar palabras peligrosas —bloquear `DROP`, `--`, `OR`— es una defensa que
> falla: siempre hay una codificación que la esquiva. Las consultas
> parametrizadas no filtran nada; hacen que el ataque sea imposible de expresar.

## Defensa en profundidad

Aunque parametrices, conviene:

- **Mínimo privilegio.** La aplicación se conecta con un usuario que solo puede
  hacer lo que necesita. Si no puede borrar tablas, una inyección no las borra.
- **Validar la entrada.** No como defensa principal, sino porque un campo de
  edad que acepta texto libre indica que algo más también falla.
- **Registrar y vigilar.** Una inyección exitosa deja rastro en los patrones de
  consulta antes de causar daño visible.
