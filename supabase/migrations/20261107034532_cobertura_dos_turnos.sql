-- Conserva las solicitudes previas como turno_b. Menú único por fecha para ambos servicios.
ALTER TABLE public.solicitudes_cobertura DROP CONSTRAINT solicitud_cobertura_unica_por_supervisor;
ALTER TABLE public.solicitudes_cobertura DROP CONSTRAINT solicitudes_cobertura_turno_b;
ALTER TABLE public.solicitudes_cobertura ADD CONSTRAINT solicitud_cobertura_unica_por_turno UNIQUE(fecha_servicio, supervisor_id, turno);
ALTER TABLE public.solicitudes_cobertura ADD CONSTRAINT solicitudes_cobertura_turno_valido CHECK(turno IN ('turno_a','turno_b'));
CREATE OR REPLACE FUNCTION guardar_solicitud_cobertura(
  p_fecha DATE,
  p_supervisor_id BIGINT,
  p_folio TEXT,
  p_responsable_numero TEXT,
  p_zona VARCHAR,
  p_items JSONB,
  p_turno VARCHAR
)
RETURNS TABLE (solicitud_id BIGINT, solicitud_folio TEXT, total INTEGER)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
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
   WHERE fecha_servicio = p_fecha AND supervisor_id = p_supervisor_id AND turno = p_turno
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
$$;

-- Compatibilidad con el servidor anterior durante el despliegue: B también cierra a las 14:00.
CREATE OR REPLACE FUNCTION public.guardar_solicitud_cobertura(
 p_fecha date,p_supervisor_id bigint,p_folio text,p_responsable_numero text,p_zona varchar,p_items jsonb
) RETURNS TABLE(solicitud_id bigint,solicitud_folio text,total integer)
LANGUAGE sql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
 SELECT * FROM public.guardar_solicitud_cobertura(p_fecha,p_supervisor_id,p_folio,p_responsable_numero,p_zona,p_items,'turno_b'::varchar);
$$;
CREATE OR REPLACE FUNCTION public.cancelar_solicitud_cobertura(p_supervisor_id bigint,p_fecha date,p_turno varchar)
RETURNS SETOF public.solicitudes_cobertura LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE v_ahora timestamp;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('cobertura:' || p_fecha::text));
 v_ahora := timezone('America/Mexico_City',clock_timestamp());
 IF p_turno IS NULL OR p_turno NOT IN ('turno_a','turno_b') THEN RAISE EXCEPTION 'turno_cobertura_invalido'; END IF;
 IF v_ahora::date <> p_fecha THEN RAISE EXCEPTION 'fecha_cobertura_invalida'; END IF;
 IF v_ahora::time >= (CASE WHEN p_turno='turno_a' THEN TIME '07:00' ELSE TIME '14:00' END) THEN RAISE EXCEPTION 'cobertura_cerrada'; END IF;
 RETURN QUERY UPDATE public.solicitudes_cobertura SET estado='cancelada',cancelado_en=now(),actualizado_en=now()
 WHERE supervisor_id=p_supervisor_id AND fecha_servicio=p_fecha AND turno=p_turno AND estado='confirmada' RETURNING *;
END;
$$;
REVOKE ALL ON FUNCTION public.guardar_solicitud_cobertura(date,bigint,text,text,varchar,jsonb,varchar) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guardar_solicitud_cobertura(date,bigint,text,text,varchar,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancelar_solicitud_cobertura(bigint,date,varchar) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guardar_solicitud_cobertura(date,bigint,text,text,varchar,jsonb,varchar) TO service_role;
GRANT EXECUTE ON FUNCTION public.guardar_solicitud_cobertura(date,bigint,text,text,varchar,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancelar_solicitud_cobertura(bigint,date,varchar) TO service_role;
NOTIFY pgrst, 'reload schema';
