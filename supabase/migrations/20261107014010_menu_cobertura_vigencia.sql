-- El menú sigue materializado por día para conservar las referencias de las
-- solicitudes existentes. Estas columnas identifican la publicación por periodo.
ALTER TABLE public.menus_cobertura
  ADD COLUMN IF NOT EXISTS vigencia_desde date,
  ADD COLUMN IF NOT EXISTS vigencia_hasta date,
  ADD COLUMN IF NOT EXISTS periodo_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menus_cobertura_vigencia_valida' AND conrelid = 'public.menus_cobertura'::regclass) THEN
    ALTER TABLE public.menus_cobertura ADD CONSTRAINT menus_cobertura_vigencia_valida CHECK (
      (vigencia_desde IS NULL AND vigencia_hasta IS NULL AND periodo_id IS NULL)
      OR (vigencia_desde IS NOT NULL AND vigencia_hasta IS NOT NULL AND periodo_id IS NOT NULL
          AND vigencia_hasta >= vigencia_desde AND fecha BETWEEN vigencia_desde AND vigencia_hasta)
    );
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_menus_cobertura_periodo ON public.menus_cobertura(periodo_id) WHERE periodo_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.publicar_menu_cobertura_periodo(
  p_desde date, p_hasta date, p_opcion_1 text, p_opcion_2 text, p_opcion_3 text,
  p_activo boolean DEFAULT true, p_periodo_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id uuid := coalesce(p_periodo_id, gen_random_uuid());
  v_fecha date;
  v_conflicto date;
BEGIN
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde OR p_hasta-p_desde > 365 THEN
    RAISE EXCEPTION 'vigencia_invalida';
  END IF;
  IF coalesce(trim(p_opcion_1),'')='' OR coalesce(trim(p_opcion_2),'')='' OR coalesce(trim(p_opcion_3),'')='' THEN
    RAISE EXCEPTION 'opciones_incompletas';
  END IF;
  p_opcion_1 := trim(p_opcion_1); p_opcion_2 := trim(p_opcion_2); p_opcion_3 := trim(p_opcion_3);
  IF lower(p_opcion_1)=lower(p_opcion_2) OR lower(p_opcion_1)=lower(p_opcion_3) OR lower(p_opcion_2)=lower(p_opcion_3) THEN
    RAISE EXCEPTION 'opciones_repetidas';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('menus_cobertura_periodos'));
  IF p_periodo_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.menus_cobertura WHERE periodo_id=p_periodo_id) THEN
    RAISE EXCEPTION 'periodo_no_encontrado';
  END IF;
  -- Mismo cerrojo diario que guardar_solicitud_cobertura: publicar y solicitar
  -- no pueden cambiar simultáneamente el menú que confirma un supervisor.
  FOR v_fecha IN
    SELECT dia::date FROM generate_series(p_desde::timestamp,p_hasta::timestamp,interval '1 day') dia
    UNION SELECT fecha FROM public.menus_cobertura WHERE periodo_id=v_id
    ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext('cobertura:' || v_fecha::text));
  END LOOP;

  IF EXISTS (SELECT 1 FROM public.menus_cobertura
      WHERE fecha BETWEEN p_desde AND p_hasta AND activo
        AND periodo_id IS NOT NULL AND periodo_id<>v_id) THEN
    RAISE EXCEPTION 'vigencia_solapada';
  END IF;

  SELECT m.fecha INTO v_conflicto
    FROM public.menus_cobertura m
   WHERE EXISTS (SELECT 1 FROM public.solicitudes_cobertura s
                 WHERE s.fecha_servicio=m.fecha AND s.estado<>'cancelada')
     AND (
       (m.fecha BETWEEN p_desde AND p_hasta AND
        (m.opcion_1 IS DISTINCT FROM p_opcion_1 OR m.opcion_2 IS DISTINCT FROM p_opcion_2
         OR m.opcion_3 IS DISTINCT FROM p_opcion_3 OR NOT coalesce(p_activo,true)))
       OR (m.periodo_id=v_id AND m.fecha NOT BETWEEN p_desde AND p_hasta)
     ) ORDER BY m.fecha LIMIT 1;
  IF v_conflicto IS NOT NULL THEN
    RAISE EXCEPTION 'menu_con_solicitudes:%',v_conflicto;
  END IF;

  -- Acortar una vigencia retira solo los días del mismo periodo y nunca borra
  -- referencias ni menús históricos que ya respaldan solicitudes.
  UPDATE public.menus_cobertura
     SET activo=false, periodo_id=NULL, vigencia_desde=NULL, vigencia_hasta=NULL, actualizado_en=now()
   WHERE periodo_id=v_id AND fecha NOT BETWEEN p_desde AND p_hasta;

  INSERT INTO public.menus_cobertura(fecha,opcion_1,opcion_2,opcion_3,activo,vigencia_desde,vigencia_hasta,periodo_id,actualizado_en)
  SELECT dia::date,p_opcion_1,p_opcion_2,p_opcion_3,coalesce(p_activo,true),p_desde,p_hasta,v_id,now()
    FROM generate_series(p_desde::timestamp,p_hasta::timestamp,interval '1 day') dia
  ON CONFLICT(fecha) DO UPDATE SET
    opcion_1=excluded.opcion_1,opcion_2=excluded.opcion_2,opcion_3=excluded.opcion_3,
    activo=excluded.activo,vigencia_desde=excluded.vigencia_desde,vigencia_hasta=excluded.vigencia_hasta,
    periodo_id=excluded.periodo_id,actualizado_en=excluded.actualizado_en;

  RETURN jsonb_build_object('periodo_id',v_id,'fecha_inicio',p_desde,'fecha_final',p_hasta,'dias',p_hasta-p_desde+1,
    'menu',(SELECT to_jsonb(m) FROM public.menus_cobertura m WHERE fecha=p_desde));
END;
$$;
REVOKE ALL ON FUNCTION public.publicar_menu_cobertura_periodo(date,date,text,text,text,boolean,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publicar_menu_cobertura_periodo(date,date,text,text,text,boolean,uuid) TO service_role;
