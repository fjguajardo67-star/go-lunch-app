-- Edición de un día futuro, sin alterar las opciones de los días vecinos.
SET LOCAL lock_timeout = '3s';
CREATE FUNCTION public.cambiar_menu_cobertura_fecha(
  p_fecha date, p_opcion_1 text, p_opcion_2 text, p_opcion_3 text,
  p_version timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
  anterior public.menus_cobertura%ROWTYPE;
  segmento record;
  segmento_id uuid;
  nuevo_id uuid := gen_random_uuid();
BEGIN
  -- Mismo orden de locks que publicar_menu_cobertura_periodo. El lock diario
  -- también serializa contra altas y modificaciones de solicitudes.
  PERFORM pg_advisory_xact_lock(hashtext('menus_cobertura_periodos'));
  PERFORM pg_advisory_xact_lock(hashtext('cobertura:' || p_fecha::text));
  IF p_fecha IS NULL OR p_fecha <= timezone('America/Mexico_City', clock_timestamp())::date THEN
    RAISE EXCEPTION 'menu_fecha_no_futura';
  END IF;
  IF coalesce(trim(p_opcion_1),'')='' OR coalesce(trim(p_opcion_2),'')='' OR coalesce(trim(p_opcion_3),'')='' THEN
    RAISE EXCEPTION 'opciones_incompletas';
  END IF;
  p_opcion_1:=trim(p_opcion_1); p_opcion_2:=trim(p_opcion_2); p_opcion_3:=trim(p_opcion_3);
  IF lower(p_opcion_1)=lower(p_opcion_2) OR lower(p_opcion_1)=lower(p_opcion_3) OR lower(p_opcion_2)=lower(p_opcion_3) THEN
    RAISE EXCEPTION 'opciones_repetidas';
  END IF;
  SELECT * INTO anterior FROM public.menus_cobertura WHERE fecha=p_fecha FOR UPDATE;
  IF NOT FOUND OR NOT anterior.activo THEN RAISE EXCEPTION 'menu_fecha_no_publicada'; END IF;
  IF EXISTS (SELECT 1 FROM public.solicitudes_cobertura WHERE fecha_servicio=p_fecha AND estado<>'cancelada') THEN
    RAISE EXCEPTION 'menu_fecha_con_pedidos';
  END IF;
  IF p_version IS NULL OR anterior.actualizado_en IS DISTINCT FROM p_version THEN
    RAISE EXCEPTION 'menu_fecha_version_obsoleta';
  END IF;

  -- Retira el ID original: un formulario de periodo abierto antes de esta
  -- separación debe recargarse, no sobreescribir los nuevos segmentos.
  FOR segmento IN
    SELECT fecha < p_fecha AS izquierda, min(fecha) AS inicio, max(fecha) AS final
      FROM public.menus_cobertura
     WHERE periodo_id=anterior.periodo_id AND fecha<>p_fecha
     GROUP BY fecha < p_fecha
  LOOP
    segmento_id := gen_random_uuid();
    UPDATE public.menus_cobertura
       SET periodo_id=segmento_id, vigencia_desde=segmento.inicio,
           vigencia_hasta=segmento.final, actualizado_en=clock_timestamp()
     WHERE periodo_id=anterior.periodo_id AND fecha<>p_fecha
       AND (fecha < p_fecha)=segmento.izquierda;
  END LOOP;
  UPDATE public.menus_cobertura
     SET opcion_1=p_opcion_1, opcion_2=p_opcion_2, opcion_3=p_opcion_3,
         periodo_id=nuevo_id, vigencia_desde=p_fecha, vigencia_hasta=p_fecha,
         actualizado_en=clock_timestamp()
   WHERE fecha=p_fecha;
  RETURN jsonb_build_object('fecha',p_fecha,'menu',
    (SELECT to_jsonb(m) FROM public.menus_cobertura m WHERE fecha=p_fecha));
END;
$$;
REVOKE ALL ON FUNCTION public.cambiar_menu_cobertura_fecha(date,text,text,text,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cambiar_menu_cobertura_fecha(date,text,text,text,timestamptz) TO service_role;
