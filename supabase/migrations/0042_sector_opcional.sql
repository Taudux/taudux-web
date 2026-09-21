-- Sector opcional: deja de ser obligatorio llenarlo.
--
-- POR QUÉ
--
-- `sector` nació `not null` en la 0039 (como `especialidad`) junto con todo lo
-- demás de la ficha, bajo la idea de que una ficha a medias no sirve. Pero el
-- sector no es del colaborador: es de la empresa donde trabaja hoy. Quien no
-- trabaja en ninguna, o quien no quiere decir en cuál, no tiene qué escribir
-- ahí, y hoy la única salida es inventarse uno.
--
-- QUÉ NO CAMBIA
--
-- El CHECK `fichas_colaborador_sector_valido` (0040) se queda como está y NO
-- hay que tocarlo: un CHECK que da NULL se aprueba, así que `sector is null`
-- pasa solo y los valores presentes se siguen validando igual. Es el mismo
-- trato que `empresa` en la 0041, que nació nullable con su CHECK plano.
-- Reescribir la expresión para agregarle un `sector is null or ...` sería
-- peor que inútil: lleva bidireccionales crudos dentro de una clase y
-- copiarlos a mano es exactamente como se rompen sin que se note.
--
-- La RPC tampoco cambia: `listar_colaboradores()` ya declara `sector text` y
-- ya lo trae de un LEFT JOIN, o sea que devolver NULL ahí no es nuevo. Los
-- grants de insert/update tampoco: soltar un NOT NULL no los toca.
--
-- LAS FILAS VIVAS SE QUEDAN COMO ESTÁN
--
-- No hay backfill ni limpieza: todas las fichas de hoy tienen sector porque
-- era obligatorio, y siguen valiendo. Lo único que se abre es la puerta para
-- las que vengan —y para quien borre el suyo.

begin;

do $preflight$
begin
  if to_regclass('public.fichas_colaborador') is null then
    raise exception using
      errcode = 'P0001',
      message = '0042 preflight failed: public.fichas_colaborador is required (0039)';
  end if;

  -- La columna se llama `sector` recién desde la 0040; antes era
  -- `especialidad` y esta migración no sabría a qué soltarle el NOT NULL.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'fichas_colaborador'
      and column_name = 'sector'
  ) then
    raise exception using
      errcode = 'P0001',
      message = '0042 preflight failed: falta sector (0040)';
  end if;

  if current_setting('client_encoding') <> 'UTF8' then
    raise exception using
      errcode = 'P0001',
      message = '0042 preflight failed: client_encoding UTF8 is required, got '
        || current_setting('client_encoding'),
      hint = 'En psql: \encoding UTF8 antes de aplicar la migración.';
  end if;
end
$preflight$;

-- === 1. El NOT NULL ========================================================

-- `drop not null` es idempotente por sí solo: sobre una columna que ya es
-- nullable no hace nada y no falla. No necesita el guard de
-- information_schema que llevan los renames.
alter table public.fichas_colaborador
  alter column sector drop not null;

comment on column public.fichas_colaborador.sector is
  'Sector de la empresa donde trabaja. Opcional: sin él, el perfil público no '
  'muestra la fila.';

commit;
