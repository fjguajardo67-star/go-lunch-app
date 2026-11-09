-- Varios folios por supervisor. La fecha sigue siendo hoy en México y cada
-- alta/cambio/cancelación necesita al menos 2 horas antes de la entrega.
SET LOCAL lock_timeout = '3s';
ALTER TABLE public.solicitudes_cobertura DROP CONSTRAINT solicitud_cobertura_unica_por_turno;
-- Compatibilidad con formularios anteriores, sin limitar los lotes nuevos.
CREATE UNIQUE INDEX cobertura_supervisor_legacy_unica
  ON public.solicitudes_cobertura(fecha_servicio,supervisor_id,turno)
  WHERE origen='supervisor' AND idempotencia IS NULL;
ALTER TABLE public.solicitudes_cobertura DROP CONSTRAINT cobertura_origen_autorizado;
ALTER TABLE public.solicitudes_cobertura ADD CONSTRAINT cobertura_origen_autorizado CHECK (
  (origen='supervisor' AND supervisor_id IS NOT NULL AND autorizado_por IS NULL AND motivo_autorizacion IS NULL
    AND ((entrega_programada_en IS NULL AND idempotencia IS NULL)
      OR (entrega_programada_en IS NOT NULL AND idempotencia IS NOT NULL)))
  OR
  (origen='extraordinaria' AND supervisor_id IS NULL AND autorizado_por IN ('admin','gerente')
    AND autorizado_por IS NOT NULL AND motivo_autorizacion IS NOT NULL
    AND length(trim(motivo_autorizacion)) BETWEEN 5 AND 500
    AND entrega_programada_en IS NOT NULL AND idempotencia IS NOT NULL)
);

CREATE OR REPLACE FUNCTION public.guardar_lote_cobertura_supervisor(
  p_supervisor_id bigint,p_fecha date,p_turno varchar,p_zona varchar,p_folio text,
  p_responsable_numero text,p_items jsonb,p_entrega_programada_en timestamptz,
  p_idempotencia uuid,p_solicitud_id bigint DEFAULT NULL,p_version timestamptz DEFAULT NULL
) RETURNS SETOF public.solicitudes_cobertura
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE
  v_ahora timestamptz;
  v_hoy date;
  v_super public.supervisores_cobertura%ROWTYPE;
  v_empleado public.empleados%ROWTYPE;
  v_responsable public.empleados%ROWTYPE;
  v_menu public.menus_cobertura%ROWTYPE;
  v_s public.solicitudes_cobertura%ROWTYPE;
  v_id bigint;
  v_items jsonb;
  v_guardados jsonb;
  v_limite timestamptz;
  v_error text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('cobertura:'||p_fecha::text));
  v_ahora:=clock_timestamp(); v_hoy:=timezone('America/Mexico_City',v_ahora)::date;
  IF p_fecha IS NULL OR p_fecha<>v_hoy THEN RAISE EXCEPTION 'fecha_cobertura_invalida'; END IF;
  SELECT * INTO v_super FROM public.supervisores_cobertura WHERE id=p_supervisor_id AND activo=true
    AND vigente_desde<=p_fecha AND (vigente_hasta IS NULL OR vigente_hasta>=p_fecha);
  IF NOT FOUND THEN RAISE EXCEPTION 'supervisor_no_autorizado'; END IF;
  SELECT * INTO v_empleado FROM public.empleados WHERE telefono=v_super.empleado_telefono AND activo=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'supervisor_no_autorizado'; END IF;
  IF p_turno IS NULL OR p_turno NOT IN ('turno_a','turno_b') THEN RAISE EXCEPTION 'turno_cobertura_invalido'; END IF;
  IF p_zona IS NULL OR p_zona NOT IN ('zona_vdc','zona_refris') THEN RAISE EXCEPTION 'zona_invalida'; END IF;
  IF p_idempotencia IS NULL THEN RAISE EXCEPTION 'idempotencia_cobertura_invalida'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'sin_alimentos'; END IF;
  SELECT jsonb_agg(jsonb_build_object('numero_empleado',trim(x->>'numero_empleado'),'opcion_id',x->>'opcion_id') ORDER BY trim(x->>'numero_empleado'))
    INTO v_items FROM jsonb_array_elements(p_items) x;
  IF p_solicitud_id IS NULL THEN
    SELECT * INTO v_s FROM public.solicitudes_cobertura WHERE idempotencia=p_idempotencia FOR UPDATE;
    IF FOUND AND (v_s.supervisor_id IS DISTINCT FROM p_supervisor_id OR v_s.origen<>'supervisor') THEN
      RAISE EXCEPTION 'idempotencia_cobertura_invalida';
    END IF;
  ELSE
    SELECT * INTO v_s FROM public.solicitudes_cobertura
      WHERE id=p_solicitud_id AND supervisor_id=p_supervisor_id AND origen='supervisor' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'solicitud_cobertura_no_encontrada'; END IF;
  END IF;
  IF v_s.id IS NOT NULL THEN
    IF v_s.fecha_servicio<>p_fecha THEN RAISE EXCEPTION 'fecha_cobertura_invalida'; END IF;
    SELECT jsonb_agg(jsonb_build_object('numero_empleado',empleado_numero_snapshot,'opcion_id',opcion_id) ORDER BY empleado_numero_snapshot)
      INTO v_guardados FROM public.solicitudes_cobertura_items WHERE solicitud_id=v_s.id;
    -- Un reintento tras perder la respuesta recupera el mismo folio, incluso
    -- si el reloj ya cruzó el límite; jamás vuelve a insertar ni cambia datos.
    IF v_s.estado<>'cancelada' AND v_s.turno=p_turno AND v_s.zona=p_zona
      AND v_s.entrega_programada_en IS NOT DISTINCT FROM p_entrega_programada_en
      AND v_s.responsable_numero_snapshot=trim(p_responsable_numero) AND v_guardados=v_items THEN
      RETURN NEXT v_s; RETURN;
    END IF;
    IF p_solicitud_id IS NULL THEN RAISE EXCEPTION 'idempotencia_cobertura_invalida'; END IF;
    IF v_s.estado<>'confirmada' OR EXISTS(SELECT 1 FROM public.solicitudes_cobertura_items WHERE solicitud_id=v_s.id AND entregado_en IS NOT NULL) THEN
      RAISE EXCEPTION 'solicitud_ya_entregada';
    END IF;
    IF v_s.actualizado_en IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'version_cobertura_desactualizada'; END IF;
    v_limite:=coalesce(v_s.entrega_programada_en,
      (p_fecha+CASE WHEN v_s.turno='turno_a' THEN time '10:00' WHEN v_s.zona='zona_vdc' THEN time '18:00' ELSE time '17:00' END) AT TIME ZONE 'America/Mexico_City');
    IF v_limite<v_ahora+interval '2 hours' THEN RAISE EXCEPTION 'anticipacion_cobertura_insuficiente'; END IF;
  END IF;
  IF p_entrega_programada_en IS NULL OR p_entrega_programada_en<v_ahora+interval '2 hours'
    OR timezone('America/Mexico_City',p_entrega_programada_en)::date<>p_fecha THEN
    RAISE EXCEPTION 'anticipacion_cobertura_insuficiente';
  END IF;
  SELECT * INTO v_menu FROM public.menus_cobertura WHERE fecha=p_fecha AND activo=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'menu_cobertura_no_disponible'; END IF;
  SELECT * INTO v_responsable FROM public.empleados WHERE numero_empleado=trim(p_responsable_numero) AND activo=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'responsable_no_encontrado'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE x->>'opcion_id' IS NULL OR x->>'opcion_id' NOT IN ('especial_1','especial_2','especial_3')) THEN
    RAISE EXCEPTION 'opcion_especial_invalida';
  END IF;
  SELECT string_agg(numero,', ') INTO v_error FROM (
    SELECT trim(x->>'numero_empleado') AS numero FROM jsonb_array_elements(p_items) x
    GROUP BY trim(x->>'numero_empleado') HAVING count(*)>1) r;
  IF v_error IS NOT NULL THEN RAISE EXCEPTION 'empleados_repetidos:%',v_error; END IF;
  SELECT string_agg(coalesce(x->>'numero_empleado','(sin número)'),', ') INTO v_error
    FROM jsonb_array_elements(p_items) x LEFT JOIN public.empleados e ON e.numero_empleado=trim(x->>'numero_empleado') AND e.activo=true
    WHERE e.telefono IS NULL;
  IF v_error IS NOT NULL THEN RAISE EXCEPTION 'empleados_no_encontrados:%',v_error; END IF;
  SELECT string_agg(e.numero_empleado,', ') INTO v_error FROM jsonb_array_elements(p_items) x
    JOIN public.empleados e ON e.numero_empleado=trim(x->>'numero_empleado')
    JOIN public.solicitudes_cobertura_items i ON i.empleado_telefono=e.telefono AND i.fecha_servicio=p_fecha
    JOIN public.solicitudes_cobertura s ON s.id=i.solicitud_id
    WHERE s.turno=p_turno AND s.estado<>'cancelada' AND (v_s.id IS NULL OR s.id<>v_s.id);
  IF v_error IS NOT NULL THEN RAISE EXCEPTION 'empleados_ya_asignados:%',v_error; END IF;
  IF v_s.id IS NULL THEN
    INSERT INTO public.solicitudes_cobertura(folio,fecha_servicio,supervisor_id,supervisor_numero_snapshot,supervisor_nombre_snapshot,
      responsable_telefono,responsable_numero_snapshot,responsable_nombre_snapshot,zona,turno,estado,entrega_programada_en,idempotencia,total_porciones)
    VALUES(p_folio,p_fecha,p_supervisor_id,v_empleado.numero_empleado,v_empleado.nombre,
      v_responsable.telefono,v_responsable.numero_empleado,v_responsable.nombre,p_zona,p_turno,'confirmada',p_entrega_programada_en,p_idempotencia,jsonb_array_length(p_items))
    RETURNING id INTO v_id;
  ELSE
    v_id:=v_s.id;
    UPDATE public.solicitudes_cobertura SET responsable_telefono=v_responsable.telefono,
      responsable_numero_snapshot=v_responsable.numero_empleado,responsable_nombre_snapshot=v_responsable.nombre,
      zona=p_zona,turno=p_turno,entrega_programada_en=p_entrega_programada_en,idempotencia=coalesce(idempotencia,p_idempotencia),
      total_porciones=jsonb_array_length(p_items),actualizado_en=clock_timestamp() WHERE id=v_id;
    DELETE FROM public.solicitudes_cobertura_items i WHERE i.solicitud_id=v_id AND NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements(p_items) x WHERE trim(x->>'numero_empleado')=i.empleado_numero_snapshot);
  END IF;
  INSERT INTO public.solicitudes_cobertura_items(solicitud_id,fecha_servicio,empleado_telefono,empleado_numero_snapshot,empleado_nombre_snapshot,opcion_id,opcion_texto)
    SELECT v_id,p_fecha,e.telefono,e.numero_empleado,e.nombre,x->>'opcion_id',
      CASE x->>'opcion_id' WHEN 'especial_1' THEN v_menu.opcion_1 WHEN 'especial_2' THEN v_menu.opcion_2 ELSE v_menu.opcion_3 END
    FROM jsonb_array_elements(p_items) x JOIN public.empleados e ON e.numero_empleado=trim(x->>'numero_empleado') AND e.activo=true
    ON CONFLICT(solicitud_id,empleado_telefono) DO UPDATE SET opcion_id=excluded.opcion_id,opcion_texto=excluded.opcion_texto;
  RETURN QUERY SELECT * FROM public.solicitudes_cobertura WHERE id=v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancelar_lote_cobertura_supervisor(p_supervisor_id bigint,p_solicitud_id bigint,p_version timestamptz)
RETURNS SETOF public.solicitudes_cobertura LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE v_s public.solicitudes_cobertura%ROWTYPE; v_hoy date; v_ahora timestamptz; v_entrega timestamptz;
BEGIN
  v_hoy:=timezone('America/Mexico_City',clock_timestamp())::date;
  PERFORM pg_advisory_xact_lock(hashtext('cobertura:'||v_hoy::text)); v_ahora:=clock_timestamp();
  IF NOT EXISTS(SELECT 1 FROM public.supervisores_cobertura s JOIN public.empleados e ON e.telefono=s.empleado_telefono
    WHERE s.id=p_supervisor_id AND s.activo=true AND e.activo=true AND s.vigente_desde<=v_hoy AND (s.vigente_hasta IS NULL OR s.vigente_hasta>=v_hoy)) THEN
    RAISE EXCEPTION 'supervisor_no_autorizado';
  END IF;
  SELECT * INTO v_s FROM public.solicitudes_cobertura WHERE id=p_solicitud_id AND supervisor_id=p_supervisor_id AND origen='supervisor' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'solicitud_cobertura_no_encontrada'; END IF;
  IF v_s.estado='cancelada' THEN RETURN NEXT v_s; RETURN; END IF;
  IF v_s.fecha_servicio<>v_hoy THEN RAISE EXCEPTION 'fecha_cobertura_invalida'; END IF;
  IF v_s.estado<>'confirmada' OR EXISTS(SELECT 1 FROM public.solicitudes_cobertura_items WHERE solicitud_id=v_s.id AND entregado_en IS NOT NULL) THEN RAISE EXCEPTION 'solicitud_ya_entregada'; END IF;
  IF v_s.actualizado_en IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'version_cobertura_desactualizada'; END IF;
  v_entrega:=coalesce(v_s.entrega_programada_en,
    (v_hoy+CASE WHEN v_s.turno='turno_a' THEN time '10:00' WHEN v_s.zona='zona_vdc' THEN time '18:00' ELSE time '17:00' END) AT TIME ZONE 'America/Mexico_City');
  IF v_entrega<v_ahora+interval '2 hours' THEN RAISE EXCEPTION 'anticipacion_cobertura_insuficiente'; END IF;
  RETURN QUERY UPDATE public.solicitudes_cobertura SET estado='cancelada',cancelado_en=v_ahora,actualizado_en=v_ahora WHERE id=v_s.id RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.guardar_lote_cobertura_supervisor(bigint,date,varchar,varchar,text,text,jsonb,timestamptz,uuid,bigint,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guardar_lote_cobertura_supervisor(bigint,date,varchar,varchar,text,text,jsonb,timestamptz,uuid,bigint,timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.cancelar_lote_cobertura_supervisor(bigint,bigint,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cancelar_lote_cobertura_supervisor(bigint,bigint,timestamptz) TO service_role;

-- Clientes anteriores solo consultan/modifican su folio legado, nunca un lote nuevo.
CREATE OR REPLACE FUNCTION public.cancelar_solicitud_cobertura(p_supervisor_id bigint, p_fecha date, p_turno character varying)
 RETURNS SETOF solicitudes_cobertura
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_ahora timestamp;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('cobertura:' || p_fecha::text));
 v_ahora := timezone('America/Mexico_City',clock_timestamp());
 IF p_turno IS NULL OR p_turno NOT IN ('turno_a','turno_b') THEN RAISE EXCEPTION 'turno_cobertura_invalido'; END IF;
 IF v_ahora::date <> p_fecha THEN RAISE EXCEPTION 'fecha_cobertura_invalida'; END IF;
 IF v_ahora::time >= (CASE WHEN p_turno='turno_a' THEN TIME '07:00' ELSE TIME '14:00' END) THEN RAISE EXCEPTION 'cobertura_cerrada'; END IF;
 RETURN QUERY UPDATE public.solicitudes_cobertura SET estado='cancelada',cancelado_en=now(),actualizado_en=now()
 WHERE supervisor_id=p_supervisor_id AND fecha_servicio=p_fecha AND turno=p_turno AND idempotencia IS NULL AND estado='confirmada' RETURNING *;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.guardar_solicitud_cobertura(p_fecha date, p_supervisor_id bigint, p_folio text, p_responsable_numero text, p_zona character varying, p_items jsonb, p_turno character varying)
 RETURNS TABLE(solicitud_id bigint, solicitud_folio text, total integer)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_ahora TIMESTAMP;
  v_solicitud_id BIGINT;
  v_supervisor_tel VARCHAR;
  v_supervisor_numero TEXT;
  v_supervisor_nombre TEXT;
  v_responsable_tel VARCHAR;
  v_responsable_numero TEXT;
  v_responsable_nombre TEXT;
  v_menu menus_cobertura%ROWTYPE;
  v_error TEXT;
  v_total INTEGER;
BEGIN
  -- Serializa las ediciones del mismo día para que dos supervisores no puedan
  -- asignar simultáneamente la misma comida a una persona.
  PERFORM pg_advisory_xact_lock(hashtext('cobertura:' || p_fecha::TEXT));

  v_ahora := timezone('America/Mexico_City', clock_timestamp());
  IF v_ahora::DATE <> p_fecha THEN
    RAISE EXCEPTION 'fecha_cobertura_invalida';
  END IF;
  IF p_turno IS NULL OR p_turno NOT IN ('turno_a','turno_b') THEN RAISE EXCEPTION 'turno_cobertura_invalido'; END IF;
  IF v_ahora::TIME >= (CASE WHEN p_turno = 'turno_a' THEN TIME '07:00' ELSE TIME '14:00' END) THEN
    RAISE EXCEPTION 'cobertura_cerrada';
  END IF;
  IF p_zona NOT IN ('zona_vdc','zona_refris') THEN
    RAISE EXCEPTION 'zona_invalida';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'sin_alimentos';
  END IF;

  SELECT s.empleado_telefono, e.numero_empleado, e.nombre
    INTO v_supervisor_tel, v_supervisor_numero, v_supervisor_nombre
    FROM supervisores_cobertura s
    JOIN empleados e ON e.telefono = s.empleado_telefono
   WHERE s.id = p_supervisor_id
     AND s.activo = true
     AND e.activo = true
     AND s.vigente_desde <= p_fecha
     AND (s.vigente_hasta IS NULL OR s.vigente_hasta >= p_fecha);
  IF NOT FOUND THEN RAISE EXCEPTION 'supervisor_no_autorizado'; END IF;

  SELECT telefono, numero_empleado, nombre
    INTO v_responsable_tel, v_responsable_numero, v_responsable_nombre
    FROM empleados
   WHERE numero_empleado = trim(p_responsable_numero) AND activo = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'responsable_no_encontrado'; END IF;

  SELECT * INTO v_menu
    FROM menus_cobertura
   WHERE fecha = p_fecha AND activo = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'menu_cobertura_no_disponible'; END IF;

  SELECT string_agg(numero, ', ')
    INTO v_error
    FROM (
      SELECT trim(x->>'numero_empleado') AS numero
        FROM jsonb_array_elements(p_items) x
       GROUP BY trim(x->>'numero_empleado')
      HAVING count(*) > 1
    ) repetidos;
  IF v_error IS NOT NULL THEN
    RAISE EXCEPTION 'empleados_repetidos:%', v_error;
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) x
     WHERE x->>'opcion_id' IS NULL OR x->>'opcion_id' NOT IN ('especial_1','especial_2','especial_3')
  ) THEN
    RAISE EXCEPTION 'opcion_especial_invalida';
  END IF;

  SELECT string_agg(trim(x->>'numero_empleado'), ', ')
    INTO v_error
    FROM jsonb_array_elements(p_items) x
    LEFT JOIN empleados e
      ON e.numero_empleado = trim(x->>'numero_empleado') AND e.activo = true
   WHERE e.telefono IS NULL;
  IF v_error IS NOT NULL THEN
    RAISE EXCEPTION 'empleados_no_encontrados:%', v_error;
  END IF;

  SELECT id INTO v_solicitud_id
    FROM solicitudes_cobertura
   WHERE fecha_servicio = p_fecha AND supervisor_id = p_supervisor_id AND turno = p_turno AND idempotencia IS NULL
   FOR UPDATE;

  SELECT string_agg(e.numero_empleado, ', ')
    INTO v_error
    FROM jsonb_array_elements(p_items) x
    JOIN empleados e ON e.numero_empleado = trim(x->>'numero_empleado')
    JOIN solicitudes_cobertura_items i
      ON i.fecha_servicio = p_fecha AND i.empleado_telefono = e.telefono
    JOIN solicitudes_cobertura s ON s.id = i.solicitud_id
   WHERE s.estado <> 'cancelada' AND s.turno = p_turno
     AND (v_solicitud_id IS NULL OR s.id <> v_solicitud_id);
  IF v_error IS NOT NULL THEN
    RAISE EXCEPTION 'empleados_ya_asignados:%', v_error;
  END IF;

  IF v_solicitud_id IS NULL THEN
    INSERT INTO solicitudes_cobertura (
      folio, fecha_servicio, supervisor_id,
      supervisor_numero_snapshot, supervisor_nombre_snapshot,
      responsable_telefono, responsable_numero_snapshot,
      responsable_nombre_snapshot, zona, turno, estado
    ) VALUES (
      p_folio, p_fecha, p_supervisor_id,
      v_supervisor_numero, v_supervisor_nombre,
      v_responsable_tel, v_responsable_numero,
      v_responsable_nombre, p_zona, p_turno, 'confirmada'
    ) RETURNING id INTO v_solicitud_id;
  ELSE
    IF EXISTS (SELECT 1 FROM solicitudes_cobertura WHERE id = v_solicitud_id AND estado = 'entregada') THEN
      RAISE EXCEPTION 'solicitud_ya_entregada';
    END IF;
    UPDATE solicitudes_cobertura
       SET responsable_telefono = v_responsable_tel,
           responsable_numero_snapshot = v_responsable_numero,
           responsable_nombre_snapshot = v_responsable_nombre,
           zona = p_zona,
           estado = 'confirmada', cancelado_en = NULL,
           actualizado_en = NOW()
     WHERE id = v_solicitud_id;
    DELETE FROM solicitudes_cobertura_items i
     WHERE i.solicitud_id = v_solicitud_id;
  END IF;

  INSERT INTO solicitudes_cobertura_items (
    solicitud_id, fecha_servicio, empleado_telefono,
    empleado_numero_snapshot, empleado_nombre_snapshot,
    opcion_id, opcion_texto
  )
  SELECT v_solicitud_id, p_fecha, e.telefono,
         e.numero_empleado, e.nombre,
         x->>'opcion_id',
         CASE x->>'opcion_id'
           WHEN 'especial_1' THEN v_menu.opcion_1
           WHEN 'especial_2' THEN v_menu.opcion_2
           WHEN 'especial_3' THEN v_menu.opcion_3
         END
    FROM jsonb_array_elements(p_items) x
    JOIN empleados e
      ON e.numero_empleado = trim(x->>'numero_empleado') AND e.activo = true;

  SELECT count(*) INTO v_total
    FROM solicitudes_cobertura_items i
   WHERE i.solicitud_id = v_solicitud_id;
  UPDATE solicitudes_cobertura
     SET total_porciones = v_total, actualizado_en = NOW()
   WHERE id = v_solicitud_id;

  RETURN QUERY
    SELECT s.id, s.folio, s.total_porciones
      FROM solicitudes_cobertura s WHERE s.id = v_solicitud_id;
END;
$function$
;
NOTIFY pgrst,'reload schema';

