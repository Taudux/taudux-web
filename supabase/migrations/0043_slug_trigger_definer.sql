-- El trigger del slug pasa a SECURITY DEFINER: sin esto, ningún colaborador
-- puede cambiarse el nombre.
--
-- EL DEFECTO
--
-- La 0040 ensanchó el trigger a `before insert or update of es_colaborador,
-- nombre, apellidos` para que la dirección del perfil siguiera al nombre. Pero
-- `asignar_slug_colaborador()` no declara `security definer`, así que su
-- cuerpo corre con los privilegios de quien invoca, y su primer paso real
-- llama a `public.slug_colaborador(new.nombre)` —una función cuyo EXECUTE la
-- 0038 revocó a public, anon y authenticated.
--
-- Mientras el trigger sólo despertaba con `es_colaborador`, eso era correcto:
-- esa columna no tiene grant para `authenticated`, así que nadie sin
-- privilegios llegaba a la rama que calcula. La cabecera de la 0038 lo dice
-- con todas las letras. La 0040 invalidó esa premisa: `nombre` y `apellidos`
-- SÍ los escribe `authenticated` (grant de la 0001 más
-- `perfiles_update_propio`).
--
-- Resultado: una cuenta con `es_colaborador = true` que guarda su nombre
-- desde Mi cuenta dispara el trigger, la guarda no corta, y el statement
-- entero aborta con 42501. Se pierden nombre, apellidos y teléfono en la
-- misma operación. A las cuentas que no colaboran no les pasa —por eso no
-- saltó en ninguna prueba de humo—.
--
-- POR QUÉ DEFINER Y NO VOLVER A ACOTAR LAS COLUMNAS
--
-- Acotar el trigger otra vez a `es_colaborador` también apaga el 42501, pero
-- revierte la decisión de que el slug siga al nombre, que es una decisión de
-- producto y no un accidente. Definer la conserva.
--
-- Es seguro: la función ya trae `set search_path = ''`, sólo lee
-- `public.perfiles`, no devuelve nada a quien la llama —asigna `new.slug` y
-- vuelve—, y su primera guarda corta cuando `new.es_colaborador` es falso,
-- una columna que `authenticated` no puede escribir.
--
-- Y ARREGLA UN SEGUNDO DEFECTO EN EL MISMO CAMINO
--
-- Los pre-chequeos de colisión (`select 1 from public.perfiles where slug =
-- ...`) corrían bajo la RLS del invocante, donde `perfiles_select_propio`
-- esconde las demás filas: el chequeo era CIEGO y sólo la constraint única
-- frenaba una colisión, con un error mucho peor de leer. Como definer ve
-- todas las filas y el desempate por apellido vuelve a funcionar.
--
-- EL REVOKE DE LA 0038 NO SE TOCA
--
-- Con definer, la llamada interna corre como dueño de la función, que sí
-- tiene EXECUTE. No hace falta devolverle el grant a `authenticated`, y no se
-- le devuelve: `slug_colaborador()` sigue sin poder invocarse desde el
-- cliente.
--
-- SE USA `alter function` Y NO `create or replace`
--
-- Cambiar el cuerpo obligaría a copiar cien líneas de lógica —incluida la
-- expresión de partículas del apellido— para cambiar una sola palabra, que es
-- justo como se rompen sin que se note. `alter function ... security definer`
-- cambia el atributo y nada más.

begin;

do $preflight$
begin
  if to_regprocedure('public.asignar_slug_colaborador()') is null then
    raise exception using
      errcode = 'P0001',
      message = '0043 preflight failed: public.asignar_slug_colaborador() is required (0038/0040)';
  end if;

  if to_regprocedure('public.slug_colaborador(text)') is null then
    raise exception using
      errcode = 'P0001',
      message = '0043 preflight failed: public.slug_colaborador(text) is required (0038)';
  end if;

  if current_setting('client_encoding') <> 'UTF8' then
    raise exception using
      errcode = 'P0001',
      message = '0043 preflight failed: client_encoding UTF8 is required, got '
        || current_setting('client_encoding'),
      hint = 'En psql: \encoding UTF8 antes de aplicar la migración.';
  end if;
end
$preflight$;

-- === 1. El atributo ========================================================

-- Idempotente por sí solo: sobre una función que ya es definer no hace nada
-- y no falla.
alter function public.asignar_slug_colaborador() security definer;

comment on function public.asignar_slug_colaborador() is
  'Calcula el slug de un colaborador al marcarlo y cuando cambia su nombre. '
  'SECURITY DEFINER (0043): su llamada interna a slug_colaborador() y sus '
  'chequeos de colisión necesitan privilegios que quien edita su propio '
  'nombre no tiene.';

commit;
