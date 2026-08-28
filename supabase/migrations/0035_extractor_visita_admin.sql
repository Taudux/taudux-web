-- Que el interruptor "excluir a los administradores" gobierne también la
-- sección de permanencia del panel. Hasta hoy era la única que no podía, y la
-- pantalla lo declaraba: "la visita no guarda quién fue, así que no hay a quién
-- excluir".
--
-- ESTA MIGRACIÓN CONTRADICE EN PARTE A LA 0034, Y HAY QUE MIRARLO DE FRENTE
--
-- La 0034 dice, con todas sus letras: "No hay `user_id`, no hay `sesion_anon`,
-- no hay IP y no la va a haber". `es_admin` no es ninguna de las tres, pero sí
-- es lo primero que esa tabla guarda sobre QUIÉN visitó, y merece el mismo
-- rigor con que se decidió no guardar nada.
--
-- Lo que lo hace aceptable, en orden:
--
--   · Señala al DUEÑO del sitio, no a quien lo usa. Con uno o dos
--     administradores, una fila en `true` apunta en la práctica a una persona
--     concreta — y esa persona es quien decide sobre esta tabla, no un tercero
--     que no eligió nada.
--   · Las filas de los demás no cambian. La inmensa mayoría lleva `false`, que
--     no distingue a nadie de nadie: sigue sin haber forma de saber cuál visita
--     fue de quién.
--   · Se declara en el aviso de privacidad, como el resto de la medición.
--
-- Lo que NO habilita: seguir sirviendo para señalar a un usuario común. Si
-- algún día hace falta distinguir a alguien más, la respuesta correcta es
-- preguntar por qué, no agregar la segunda columna.
--
-- SÓLO ALCANZA A LOS ADMINS CON SESIÓN
--
-- Un administrador que navegue sin iniciarla llega con `con_sesion` y
-- `es_admin` en `false` y se cuenta como visita anónima. No es un descuido: el
-- servidor no puede verlo, y es exactamente lo que hacen las otras tres
-- secciones, que excluyen por `user_id` y tampoco pueden.
--
-- POR QUÉ `default false` Y NO `default null`
--
-- La columna se llena desde un endpoint SIN autenticación, y las filas ya
-- escritas (las de agosto) no tienen forma de saber su valor. `false` las deja
-- contadas como visitas comunes, que es el error barato: ensucia un poco. Un
-- `null` obligaría a cada consumidor a decidir qué hacer con él, y el día que
-- alguno lo tratara como verdadero borraría visitas reales de la vista
-- filtrada — que es la que se enciende justamente para leer el uso real.
--
-- Y no hay backfill que valga: las cinco visitas de agosto se hicieron SIN
-- sesión, así que `false` no sólo es seguro, es correcto.
--
-- Aplicar dos veces es seguro: `if not exists`.

begin;

do $preflight$
begin
  if to_regclass('public.extractor_visita') is null then
    raise exception using
      errcode = 'P0001',
      message = '0035 preflight failed: public.extractor_visita is required (0034)';
  end if;
end
$preflight$;

alter table public.extractor_visita
  add column if not exists es_admin boolean not null default false;

comment on column public.extractor_visita.es_admin is
  'Si quien visitó es administrador del sitio. Existe para que el filtro del '
  'panel excluya el uso propio y no infle las métricas. Es la ÚNICA columna de '
  'esta tabla que dice algo sobre quién visitó, y señala al dueño del sitio, '
  'no a quien lo usa. Sólo distingue a los admins CON sesión: sin ella el '
  'servidor no puede verlos y se cuentan como anónimos.';

commit;
