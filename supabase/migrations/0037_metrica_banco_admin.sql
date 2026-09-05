-- Saber CUÁNTOS de los fallos de un banco salieron de probar la herramienta.
--
-- NO ES PARA FILTRAR, Y ESA ES LA DECISIÓN
--
-- Las otras tres secciones del panel miden USO —cuánta gente entra, desde
-- dónde, cuánto se queda— y ahí el interruptor "excluir a los administradores"
-- descuenta las pruebas de la casa, que son ruido. La `0035` agregó `es_admin`
-- a `extractor_visita` justamente para eso.
--
-- **Acá no.** Esta tabla no mide uso: mide si el SOFTWARE FUNCIONA. Si un banco
-- revienta, revienta para todos, y que lo haya encontrado un administrador no
-- lo vuelve menos real. Restar esos intentos escondería defectos genuinos justo
-- en la tabla que existe para hallarlos.
--
-- Pero el número solo tampoco alcanza: tres fallos de tres personas distintas y
-- tres de una tarde de depuración piden acciones distintas, y "3" no las separa.
-- Por eso el panel los ANOTA bajo el nombre del banco —"1 en pruebas"— y nunca
-- los descuenta. Va UNA anotación por fila, no una por columna: el descuadre
-- hecho probando también es contexto, y es justamente el fallo silencioso.
--
-- La columna existe para esa anotación. Si algún día alguien la usa para
-- filtrar esta sección, que lea antes este párrafo.
--
-- LO QUE NO CAMBIA
--
-- Sigue sin haber `user_id`, sesión ni IP, y el grano sigue siendo el día. La
-- `0030` separó esta tabla de `extractor_uso` para que la hora exacta no
-- permitiera volver a identificar a quien subió el documento, y eso queda
-- intacto: `es_admin` señala al DUEÑO del sitio, no a quien lo usa, y la
-- inmensa mayoría de las filas lleva `false`, que no distingue a nadie.
--
-- POR QUÉ `default false`
--
-- Las filas ya escritas no tienen forma de saber su valor. `false` las cuenta
-- como intentos comunes, que es lo correcto: son de antes de que existiera la
-- distinción, y afirmar lo contrario inventaría pruebas que nadie hizo.
--
-- NO CUESTA UNA CONSULTA
--
-- `_es_admin()` está cacheado en `flask.g` y `_acceso()` ya lo resolvió al
-- cobrar la cuota, antes de procesar el documento. El servidor sólo lee ese
-- caché.
--
-- Aplicar dos veces es seguro: `if not exists`.

begin;

do $preflight$
begin
  if to_regclass('public.extractor_metrica_banco') is null then
    raise exception using
      errcode = 'P0001',
      message = '0037 preflight failed: public.extractor_metrica_banco is required (0030)';
  end if;
end
$preflight$;

alter table public.extractor_metrica_banco
  add column if not exists es_admin boolean not null default false;

comment on column public.extractor_metrica_banco.es_admin is
  'Si el intento lo hizo un administrador del sitio. Existe para ANOTAR cuántos '
  'fallos salieron de probar la herramienta, no para restarlos: un fallo es un '
  'fallo lo haya encontrado quien lo haya encontrado, y filtrarlos escondería '
  'defectos reales. Señala al dueño del sitio, no a quien lo usa.';

commit;
