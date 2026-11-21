SET LOCAL lock_timeout = '3s';

-- Necesaria para distinguir el mismo lote de otro subconjunto con igual motivo.
-- No guarda teléfonos, nombres ni motivos: solo huella y resultado de la operación.
CREATE TABLE public.entregas_admin_operaciones (
  idempotencia uuid PRIMARY KEY,
  huella text NOT NULL CHECK (huella ~ '^[0-9a-f]{64}$'),
  resultado jsonb NOT NULL,
  confirmado_en timestamptz NOT NULL
);
ALTER TABLE public.entregas_admin_operaciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.entregas_admin_operaciones FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.entregas_admin_operaciones TO service_role;
CREATE POLICY entregas_admin_operaciones_leer ON public.entregas_admin_operaciones
  FOR SELECT TO service_role USING (true);
CREATE POLICY entregas_admin_operaciones_insertar ON public.entregas_admin_operaciones
  FOR INSERT TO service_role WITH CHECK (true);

-- Misma vigencia que GoLunchOperacion.horaEntrega; horario explícito del folio
-- prevalece. Fecha/horario desconocidos se rechazan en vez de adivinarlos.
CREATE FUNCTION public.horario_entregas_admin(p_fecha date,p_turno text,p_zona text,p_programada timestamptz DEFAULT NULL)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT CASE
    WHEN p_programada IS NOT NULL THEN CASE WHEN isfinite(p_programada)
      AND timezone('America/Mexico_City',p_programada)::date=p_fecha THEN p_programada END
    WHEN p_turno IN ('turno_a','turno_b') AND (p_fecha<date '2026-11-07' OR p_zona IN ('zona_vdc','zona_refris'))
      THEN (p_fecha + CASE WHEN p_turno='turno_a' THEN time '10:00'
        WHEN p_fecha<date '2026-11-07' THEN time '17:00'
        WHEN p_zona='zona_vdc' THEN time '18:00'
        WHEN p_fecha>=date '2026-11-20' THEN time '17:30' ELSE time '17:00' END) AT TIME ZONE 'America/Mexico_City'
    END;
$$;

-- Única canonicalización para preview y confirmación; el contexto incluye
-- identidad visible del empleado o TODOS los campos del padre de cobertura.
CREATE FUNCTION public.version_entregas_admin(p_comida jsonb,p_contexto jsonb,p_horario timestamptz)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' SET timezone = 'UTC' AS $$
  SELECT encode(sha256(convert_to(jsonb_build_array(p_comida,p_contexto,p_horario)::text,'UTF8')),'hex');
$$;

CREATE FUNCTION public.preview_entregas_admin(p_fecha date)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET timezone = 'UTC' AS $$
DECLARE v_ahora timestamptz := clock_timestamp(); v_resultado jsonb;
BEGIN
  IF p_fecha IS NULL OR NOT isfinite(p_fecha) THEN RAISE EXCEPTION 'entrada_entregas_invalida'; END IF;
  IF p_fecha>timezone('America/Mexico_City',v_ahora)::date THEN RAISE EXCEPTION 'servicio_futuro'; END IF;
  WITH candidatos AS (
    SELECT 'regular'::text AS tipo,p.id,p.opcion_texto AS platillo,p.zona,p.turno,NULL::text AS folio,
      e.nombre,e.numero_empleado, to_jsonb(p) AS comida,
      jsonb_build_object('nombre',e.nombre,'numero_empleado',e.numero_empleado) AS contexto,
      public.horario_entregas_admin(p.fecha_menu,p.turno,p.zona) AS horario
    FROM public.pedidos p JOIN public.empleados e ON e.telefono=p.empleado_telefono
    WHERE p.fecha_menu=p_fecha AND p.entregado_en IS NULL AND p.no_surtido_en IS NULL AND p.entrega_conciliada_en IS NULL
    UNION ALL
    SELECT 'cobertura',i.id,i.opcion_texto,s.zona,s.turno,s.folio,
      i.empleado_nombre_snapshot,i.empleado_numero_snapshot,to_jsonb(i),to_jsonb(s),
      public.horario_entregas_admin(s.fecha_servicio,s.turno,s.zona,s.entrega_programada_en)
    FROM public.solicitudes_cobertura_items i JOIN public.solicitudes_cobertura s ON s.id=i.solicitud_id
    WHERE i.fecha_servicio=p_fecha AND s.fecha_servicio=p_fecha AND s.estado<>'cancelada'
      AND i.entregado_en IS NULL AND i.no_surtido_en IS NULL AND i.entrega_conciliada_en IS NULL
  )
  SELECT jsonb_build_object('fecha',p_fecha,'items',coalesce(jsonb_agg(jsonb_build_object(
    'tipo',tipo,'id',id,'version',public.version_entregas_admin(comida,contexto,horario),
    'nombre',nombre,'numero_empleado',numero_empleado,'platillo',platillo,
    'zona',zona,'turno',turno,'horario',to_char(timezone('America/Mexico_City',horario),'HH24:MI'),'folio',folio
  ) ORDER BY tipo,id) FILTER (WHERE horario<=v_ahora),'[]'::jsonb),
    'total',count(*) FILTER (WHERE horario<=v_ahora),
    'futuras',count(*) FILTER (WHERE horario>v_ahora),
    'sin_horario',count(*) FILTER (WHERE horario IS NULL)) INTO v_resultado FROM candidatos;
  RETURN v_resultado;
END;
$$;

CREATE FUNCTION public.confirmar_entregas_admin(
  p_fecha date,p_items jsonb,p_motivo text,p_confirmado boolean,p_idempotencia uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET timezone = 'UTC' SET lock_timeout = '3s' AS $$
DECLARE
  v_items jsonb; v_huella text; v_operacion public.entregas_admin_operaciones%ROWTYPE;
  v_seleccion record; v_regular public.pedidos%ROWTYPE;
  v_item public.solicitudes_cobertura_items%ROWTYPE; v_padre public.solicitudes_cobertura%ROWTYPE;
  v_padres bigint[]; v_contexto jsonb; v_comida jsonb; v_horario timestamptz;
  v_ahora timestamptz; v_resultado jsonb; v_regulares integer; v_coberturas integer;
BEGIN
  IF p_fecha IS NULL OR NOT isfinite(p_fecha) OR p_confirmado IS DISTINCT FROM true OR p_idempotencia IS NULL
    OR p_motivo IS NULL OR length(btrim(p_motivo)) NOT BETWEEN 10 AND 500 OR p_motivo ~ '[[:cntrl:]]'
    OR p_items IS NULL OR jsonb_typeof(p_items)<>'array' THEN RAISE EXCEPTION 'entrada_entregas_invalida'; END IF;
  IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'entrada_entregas_invalida'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE jsonb_typeof(x)<>'object'
    OR coalesce(x->>'tipo','') NOT IN ('regular','cobertura')
    OR coalesce(x->>'id','') !~ '^[1-9][0-9]{0,15}$'
    OR coalesce(x->>'version','') !~ '^[0-9a-f]{64}$') THEN RAISE EXCEPTION 'entrada_entregas_invalida'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE (x->>'id')::bigint>9007199254740991)
    OR (SELECT count(DISTINCT (x->>'tipo',(x->>'id')::bigint)) FROM jsonb_array_elements(p_items) x)<>jsonb_array_length(p_items)
    THEN RAISE EXCEPTION 'entrada_entregas_invalida'; END IF;
  SELECT jsonb_agg(jsonb_build_object('tipo',x->>'tipo','id',(x->>'id')::bigint,'version',x->>'version')
    ORDER BY x->>'tipo',(x->>'id')::bigint) INTO v_items FROM jsonb_array_elements(p_items) x;
  v_huella:=encode(sha256(convert_to(jsonb_build_object('fecha',p_fecha,'items',v_items,
    'motivo',btrim(p_motivo),'confirmado',true,'autor','Administrador')::text,'UTF8')),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended('entregas-admin:'||p_idempotencia::text,0));
  SELECT * INTO v_operacion FROM public.entregas_admin_operaciones WHERE idempotencia=p_idempotencia;
  IF FOUND THEN
    IF v_operacion.huella<>v_huella THEN RAISE EXCEPTION 'idempotencia_entrega_invalida'; END IF;
    RETURN v_operacion.resultado || jsonb_build_object('reintentada',true);
  END IF;
  -- Comparte el candado de altas/cambios/cancelaciones de lotes de cobertura.
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_items) x WHERE x->>'tipo'='cobertura') THEN
    PERFORM pg_advisory_xact_lock(hashtext('cobertura:'||p_fecha::text));
  END IF;
  -- Orden estable: empleados (identidad/cascadas), padres por id, todos sus
  -- recipientes por padre/id (incluidos no seleccionados) y regulares por id.
  PERFORM e.telefono FROM public.empleados e WHERE e.telefono IN (
    SELECT p.empleado_telefono FROM public.pedidos p JOIN jsonb_to_recordset(v_items) x(tipo text,id bigint,version text)
      ON x.tipo='regular' AND p.id=x.id) ORDER BY e.telefono FOR SHARE;
  SELECT array_agg(DISTINCT i.solicitud_id ORDER BY i.solicitud_id) INTO v_padres
    FROM public.solicitudes_cobertura_items i JOIN jsonb_to_recordset(v_items) x(tipo text,id bigint,version text)
      ON x.tipo='cobertura' AND i.id=x.id;
  PERFORM s.id FROM public.solicitudes_cobertura s WHERE s.id=ANY(v_padres) ORDER BY s.id FOR UPDATE;
  PERFORM i.id FROM public.solicitudes_cobertura_items i WHERE i.solicitud_id=ANY(v_padres)
    ORDER BY i.solicitud_id,i.id FOR UPDATE;
  PERFORM p.id FROM public.pedidos p JOIN jsonb_to_recordset(v_items) x(tipo text,id bigint,version text)
    ON x.tipo='regular' AND p.id=x.id ORDER BY p.id FOR UPDATE OF p;
  v_ahora:=clock_timestamp();
  IF p_fecha>timezone('America/Mexico_City',v_ahora)::date THEN RAISE EXCEPTION 'servicio_futuro'; END IF;
  -- Primero validar TODO. Cualquier excepción revierte el lote completo.
  FOR v_seleccion IN SELECT * FROM jsonb_to_recordset(v_items) x(tipo text,id bigint,version text) LOOP
    IF v_seleccion.tipo='regular' THEN
      SELECT * INTO v_regular FROM public.pedidos WHERE id=v_seleccion.id;
      IF NOT FOUND THEN RAISE EXCEPTION 'comida_no_encontrada'; END IF;
      IF v_regular.fecha_menu<>p_fecha THEN RAISE EXCEPTION 'fecha_servicio_actualizada'; END IF;
      SELECT jsonb_build_object('nombre',e.nombre,'numero_empleado',e.numero_empleado) INTO v_contexto
        FROM public.empleados e WHERE e.telefono=v_regular.empleado_telefono;
      v_comida:=to_jsonb(v_regular);
      v_horario:=public.horario_entregas_admin(v_regular.fecha_menu,v_regular.turno,v_regular.zona);
    ELSE
      SELECT * INTO v_item FROM public.solicitudes_cobertura_items WHERE id=v_seleccion.id;
      IF NOT FOUND THEN RAISE EXCEPTION 'comida_no_encontrada'; END IF;
      IF NOT coalesce(v_item.solicitud_id=ANY(v_padres),false) THEN RAISE EXCEPTION 'version_entrega_actualizada'; END IF;
      SELECT * INTO v_padre FROM public.solicitudes_cobertura WHERE id=v_item.solicitud_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'comida_no_encontrada'; END IF;
      IF v_padre.estado='cancelada' THEN RAISE EXCEPTION 'solicitud_cancelada'; END IF;
      IF v_item.fecha_servicio<>p_fecha OR v_padre.fecha_servicio<>p_fecha THEN RAISE EXCEPTION 'fecha_servicio_actualizada'; END IF;
      v_comida:=to_jsonb(v_item); v_contexto:=to_jsonb(v_padre);
      v_horario:=public.horario_entregas_admin(v_padre.fecha_servicio,v_padre.turno,v_padre.zona,v_padre.entrega_programada_en);
    END IF;
    IF v_horario IS NULL THEN RAISE EXCEPTION 'horario_invalido'; END IF;
    IF v_horario>v_ahora THEN RAISE EXCEPTION 'servicio_futuro'; END IF;
    IF v_comida->>'no_surtido_en' IS NOT NULL OR v_comida->>'entregado_en' IS NOT NULL
      OR v_comida->>'entrega_conciliada_en' IS NOT NULL THEN RAISE EXCEPTION 'comida_no_pendiente'; END IF;
    IF public.version_entregas_admin(v_comida,v_contexto,v_horario) IS DISTINCT FROM v_seleccion.version THEN
      RAISE EXCEPTION 'version_entrega_actualizada';
    END IF;
  END LOOP;
  UPDATE public.pedidos p SET entrega_conciliada_en=v_ahora,entrega_conciliada_por='Administrador',entrega_conciliacion_motivo=btrim(p_motivo)
    FROM jsonb_to_recordset(v_items) x(tipo text,id bigint,version text) WHERE x.tipo='regular' AND p.id=x.id;
  GET DIAGNOSTICS v_regulares = ROW_COUNT;
  UPDATE public.solicitudes_cobertura_items i SET entrega_conciliada_en=v_ahora,entrega_conciliada_por='Administrador',entrega_conciliacion_motivo=btrim(p_motivo)
    FROM jsonb_to_recordset(v_items) x(tipo text,id bigint,version text) WHERE x.tipo='cobertura' AND i.id=x.id;
  GET DIAGNOSTICS v_coberturas = ROW_COUNT;
  UPDATE public.solicitudes_cobertura s SET estado='entregada',actualizado_en=v_ahora WHERE s.id=ANY(v_padres) AND s.estado='confirmada'
    AND EXISTS(SELECT 1 FROM public.solicitudes_cobertura_items i WHERE i.solicitud_id=s.id AND i.no_surtido_en IS NULL
      AND (i.entregado_en IS NOT NULL OR i.entrega_conciliada_en IS NOT NULL))
    AND NOT EXISTS(SELECT 1 FROM public.solicitudes_cobertura_items i WHERE i.solicitud_id=s.id
      AND (i.no_surtido_en IS NOT NULL OR (i.entregado_en IS NULL AND i.entrega_conciliada_en IS NULL)));
  v_resultado:=jsonb_build_object('ok',true,'registradas',v_regulares+v_coberturas,'regulares',v_regulares,'coberturas',v_coberturas);
  INSERT INTO public.entregas_admin_operaciones(idempotencia,huella,resultado,confirmado_en)
    VALUES(p_idempotencia,v_huella,v_resultado,v_ahora);
  RETURN v_resultado;
END;
$$;
REVOKE ALL ON FUNCTION public.horario_entregas_admin(date,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.version_entregas_admin(jsonb,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.preview_entregas_admin(date) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.confirmar_entregas_admin(date,jsonb,text,boolean,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.horario_entregas_admin(date,text,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.version_entregas_admin(jsonb,jsonb,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.preview_entregas_admin(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirmar_entregas_admin(date,jsonb,text,boolean,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
