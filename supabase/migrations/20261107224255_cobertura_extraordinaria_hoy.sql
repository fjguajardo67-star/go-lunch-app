-- Alta adicional desde el panel; las funciones de supervisores conservan sus cortes.
ALTER TABLE public.solicitudes_cobertura ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solicitudes_cobertura_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solicitudes_cobertura
  ALTER COLUMN supervisor_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS origen varchar NOT NULL DEFAULT 'supervisor',
  ADD COLUMN IF NOT EXISTS autorizado_por varchar,
  ADD COLUMN IF NOT EXISTS motivo_autorizacion text,
  ADD COLUMN IF NOT EXISTS entrega_programada_en timestamptz,
  ADD COLUMN IF NOT EXISTS idempotencia uuid UNIQUE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.solicitudes_cobertura'::regclass AND conname='cobertura_origen_autorizado') THEN
  ALTER TABLE public.solicitudes_cobertura ADD CONSTRAINT cobertura_origen_autorizado CHECK (
    (origen = 'supervisor' AND supervisor_id IS NOT NULL AND autorizado_por IS NULL
      AND motivo_autorizacion IS NULL AND entrega_programada_en IS NULL AND idempotencia IS NULL)
    OR
    (origen = 'extraordinaria' AND supervisor_id IS NULL AND autorizado_por IS NOT NULL
      AND autorizado_por IN ('admin','gerente') AND motivo_autorizacion IS NOT NULL
      AND length(trim(motivo_autorizacion)) BETWEEN 5 AND 500
      AND entrega_programada_en IS NOT NULL AND idempotencia IS NOT NULL)
  );
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.autorizar_cobertura_extraordinaria(
  p_fecha date, p_turno varchar, p_zona varchar, p_folio text,
  p_responsable_numero text, p_items jsonb, p_autorizado_por varchar,
  p_motivo text, p_entrega_programada_en timestamptz, p_idempotencia uuid
)
RETURNS SETOF public.solicitudes_cobertura
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
  v_ahora timestamptz := clock_timestamp();
  v_hoy date := timezone('America/Mexico_City',v_ahora)::date;
  v_menu public.menus_cobertura%ROWTYPE;
  v_responsable public.empleados%ROWTYPE;
  v_existente public.solicitudes_cobertura%ROWTYPE;
  v_id bigint;
  v_error text;
  v_items jsonb;
  v_guardados jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('cobertura:' || p_fecha::text));
  IF p_fecha IS NULL OR p_fecha <> v_hoy THEN RAISE EXCEPTION 'fecha_cobertura_invalida'; END IF;
  IF p_autorizado_por IS NULL OR p_autorizado_por NOT IN ('admin','gerente') THEN
    RAISE EXCEPTION 'autorizacion_extraordinaria_invalida';
  END IF;
  IF p_turno IS NULL OR p_turno NOT IN ('turno_a','turno_b') THEN RAISE EXCEPTION 'turno_cobertura_invalido'; END IF;
  IF p_zona IS NULL OR p_zona NOT IN ('zona_vdc','zona_refris') THEN RAISE EXCEPTION 'zona_invalida'; END IF;
  IF p_motivo IS NULL OR length(trim(p_motivo)) NOT BETWEEN 5 AND 500 THEN
    RAISE EXCEPTION 'motivo_extraordinario_invalido';
  END IF;
  IF p_idempotencia IS NULL THEN RAISE EXCEPTION 'idempotencia_extraordinaria_invalida'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'sin_alimentos';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('numero_empleado',trim(x->>'numero_empleado'),'opcion_id',x->>'opcion_id') ORDER BY trim(x->>'numero_empleado'))
    INTO v_items FROM jsonb_array_elements(p_items) x;
  -- Reintentar una confirmación cuya respuesta se perdió devuelve el mismo folio.
  SELECT * INTO v_existente FROM public.solicitudes_cobertura WHERE idempotencia = p_idempotencia;
  IF FOUND THEN
    SELECT jsonb_agg(jsonb_build_object('numero_empleado',empleado_numero_snapshot,'opcion_id',opcion_id) ORDER BY empleado_numero_snapshot)
      INTO v_guardados FROM public.solicitudes_cobertura_items WHERE solicitud_id = v_existente.id;
    IF v_existente.fecha_servicio IS DISTINCT FROM p_fecha OR v_existente.turno IS DISTINCT FROM p_turno
      OR v_existente.zona IS DISTINCT FROM p_zona OR v_existente.autorizado_por IS DISTINCT FROM p_autorizado_por
      OR v_existente.motivo_autorizacion IS DISTINCT FROM trim(p_motivo)
      OR v_existente.entrega_programada_en IS DISTINCT FROM p_entrega_programada_en
      OR v_existente.responsable_numero_snapshot IS DISTINCT FROM trim(p_responsable_numero)
      OR v_guardados IS DISTINCT FROM v_items THEN RAISE EXCEPTION 'idempotencia_extraordinaria_invalida'; END IF;
    RETURN NEXT v_existente; RETURN;
  END IF;
  -- Se decide la ventana de entrega, sin reabrir el corte general del turno.
  IF p_entrega_programada_en IS NULL OR p_entrega_programada_en <= clock_timestamp()
    OR timezone('America/Mexico_City',p_entrega_programada_en)::date <> v_hoy THEN
    RAISE EXCEPTION 'entrega_extraordinaria_invalida';
  END IF;
  SELECT * INTO v_menu FROM public.menus_cobertura WHERE fecha=p_fecha AND activo=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'menu_cobertura_no_disponible'; END IF;
  SELECT * INTO v_responsable FROM public.empleados WHERE numero_empleado=trim(p_responsable_numero) AND activo=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'responsable_no_encontrado'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) x
    WHERE x->>'opcion_id' IS NULL OR x->>'opcion_id' NOT IN ('especial_1','especial_2','especial_3')) THEN
    RAISE EXCEPTION 'opcion_especial_invalida';
  END IF;
  SELECT string_agg(numero,', ') INTO v_error FROM (
    SELECT trim(x->>'numero_empleado') AS numero FROM jsonb_array_elements(p_items) x
    GROUP BY trim(x->>'numero_empleado') HAVING count(*)>1
  ) repetidos;
  IF v_error IS NOT NULL THEN RAISE EXCEPTION 'empleados_repetidos:%',v_error; END IF;
  SELECT string_agg(coalesce(x->>'numero_empleado','(sin número)'),', ') INTO v_error
    FROM jsonb_array_elements(p_items) x LEFT JOIN public.empleados e
      ON e.numero_empleado=trim(x->>'numero_empleado') AND e.activo=true WHERE e.telefono IS NULL;
  IF v_error IS NOT NULL THEN RAISE EXCEPTION 'empleados_no_encontrados:%',v_error; END IF;
  SELECT string_agg(e.numero_empleado,', ') INTO v_error
    FROM jsonb_array_elements(p_items) x JOIN public.empleados e ON e.numero_empleado=trim(x->>'numero_empleado')
    JOIN public.solicitudes_cobertura_items i ON i.empleado_telefono=e.telefono AND i.fecha_servicio=p_fecha
    JOIN public.solicitudes_cobertura s ON s.id=i.solicitud_id
    WHERE s.turno=p_turno AND s.estado <> 'cancelada';
  IF v_error IS NOT NULL THEN RAISE EXCEPTION 'empleados_ya_asignados:%',v_error; END IF;
  INSERT INTO public.solicitudes_cobertura (
    folio,fecha_servicio,supervisor_id,supervisor_numero_snapshot,supervisor_nombre_snapshot,
    responsable_telefono,responsable_numero_snapshot,responsable_nombre_snapshot,zona,turno,estado,
    origen,autorizado_por,motivo_autorizacion,entrega_programada_en,idempotencia,total_porciones
  ) VALUES (
    p_folio,p_fecha,NULL,p_autorizado_por,CASE WHEN p_autorizado_por='gerente' THEN 'Gerente' ELSE 'Administrador' END,
    v_responsable.telefono,v_responsable.numero_empleado,v_responsable.nombre,p_zona,p_turno,'confirmada',
    'extraordinaria',p_autorizado_por,trim(p_motivo),p_entrega_programada_en,p_idempotencia,jsonb_array_length(p_items)
  ) RETURNING id INTO v_id;
  INSERT INTO public.solicitudes_cobertura_items (
    solicitud_id,fecha_servicio,empleado_telefono,empleado_numero_snapshot,empleado_nombre_snapshot,opcion_id,opcion_texto
  ) SELECT v_id,p_fecha,e.telefono,e.numero_empleado,e.nombre,x->>'opcion_id',
    CASE x->>'opcion_id' WHEN 'especial_1' THEN v_menu.opcion_1 WHEN 'especial_2' THEN v_menu.opcion_2 ELSE v_menu.opcion_3 END
    FROM jsonb_array_elements(p_items) x JOIN public.empleados e ON e.numero_empleado=trim(x->>'numero_empleado') AND e.activo=true;
  RETURN QUERY SELECT * FROM public.solicitudes_cobertura WHERE id=v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.autorizar_cobertura_extraordinaria(date,varchar,varchar,text,text,jsonb,varchar,text,timestamptz,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.autorizar_cobertura_extraordinaria(date,varchar,varchar,text,text,jsonb,varchar,text,timestamptz,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
