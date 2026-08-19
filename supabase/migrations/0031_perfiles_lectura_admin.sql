-- Administración puede leer todos los perfiles.
--
-- Hasta ahora `perfiles` sólo tenía `select_propio`: cada quien veía su fila y
-- nadie más. Eso alcanzaba mientras el sitio no tuviera una pantalla que
-- necesitara la lista, pero el panel del extractor sí la necesita — y sin esto
-- tendría que adivinar quién es administrador comparando contra una lista de
-- correos escrita en el código, que es el hallazgo F23.
--
-- POR QUÉ UNA POLICY Y NO `service_role`
--
-- El panel corre en el navegador con la clave `anon` y el token de quien lo
-- abre; la RLS decide qué ve. La alternativa —montar `service_role` en el
-- servidor -- exige un secreto más que administrar y mueve la decisión de
-- acceso fuera de la base, donde es más difícil auditarla. Mismo criterio y
-- misma forma que `eventos_negocio_select_admin` (0027).
--
-- QUÉ NO EXPONE
--
-- El correo. Vive en `auth.users`, fuera del alcance de PostgREST, y este
-- repositorio nunca lo ha entregado al navegador de nadie. Con esta policy un
-- administrador ve nombre, apellidos y rol: lo suficiente para saber a quién
-- le corresponde qué, sin repartir direcciones de correo por el camino.
--
-- Aplicar dos veces es seguro: la policy se borra antes de crearse.

begin;

do $preflight$
begin
  if to_regclass('public.perfiles') is null then
    raise exception using
      errcode = 'P0001',
      message = '0031 preflight failed: public.perfiles is required';
  end if;

  if to_regprocedure('public.es_admin()') is null then
    raise exception using
      errcode = 'P0001',
      message = '0031 preflight failed: public.es_admin() is required (0004)';
  end if;
end
$preflight$;

-- `es_admin()` es `security definer` con `search_path` vacío (0004): lee la
-- fila propia de quien pregunta sin quedar atrapada en la RLS de esta misma
-- tabla, que es lo que haría que la policy se llamara a sí misma.
drop policy if exists perfiles_select_admin on public.perfiles;
create policy perfiles_select_admin
  on public.perfiles for select
  to authenticated
  using ((select public.es_admin()));

-- Deliberadamente NO se concede update: administración puede VER quién es quién,
-- pero cambiar un rol sigue siendo una operación de base de datos, hecha a mano
-- y con intención. Un panel que reparte el rol de administrador desde el
-- navegador es una escalada de privilegios a un clic de distancia.

commit;
