-- Menú por día. Cada folio conserva sus opciones, platos, QR y estados.
SET LOCAL lock_timeout = '3s';
ALTER TABLE public.solicitudes_cobertura ADD COLUMN menu_snapshot jsonb;
UPDATE public.solicitudes_cobertura s SET menu_snapshot=jsonb_build_object(
  'opcion_1',coalesce((SELECT i.opcion_texto FROM public.solicitudes_cobertura_items i WHERE i.solicitud_id=s.id AND i.opcion_id='especial_1' ORDER BY i.id LIMIT 1),m.opcion_1),
  'opcion_2',coalesce((SELECT i.opcion_texto FROM public.solicitudes_cobertura_items i WHERE i.solicitud_id=s.id AND i.opcion_id='especial_2' ORDER BY i.id LIMIT 1),m.opcion_2),
  'opcion_3',coalesce((SELECT i.opcion_texto FROM public.solicitudes_cobertura_items i WHERE i.solicitud_id=s.id AND i.opcion_id='especial_3' ORDER BY i.id LIMIT 1),m.opcion_3))
FROM public.menus_cobertura m WHERE m.fecha=s.fecha_servicio;
ALTER TABLE public.solicitudes_cobertura ALTER COLUMN menu_snapshot SET NOT NULL;
ALTER TABLE public.solicitudes_cobertura ADD CONSTRAINT menu_snapshot_completo CHECK (
  jsonb_typeof(menu_snapshot)='object' AND menu_snapshot ?& ARRAY['opcion_1','opcion_2','opcion_3']
  AND jsonb_typeof(menu_snapshot->'opcion_1')='string' AND length(trim(menu_snapshot->>'opcion_1'))>0
  AND jsonb_typeof(menu_snapshot->'opcion_2')='string' AND length(trim(menu_snapshot->>'opcion_2'))>0
  AND jsonb_typeof(menu_snapshot->'opcion_3')='string' AND length(trim(menu_snapshot->>'opcion_3'))>0);

CREATE FUNCTION public.fijar_menu_folio_cobertura() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE m public.menus_cobertura%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.menu_snapshot IS DISTINCT FROM OLD.menu_snapshot OR NEW.fecha_servicio IS DISTINCT FROM OLD.fecha_servicio THEN
      RAISE EXCEPTION 'menu_folio_inmutable';
    END IF;
  ELSE
    PERFORM pg_advisory_xact_lock(hashtext('cobertura:'||NEW.fecha_servicio::text));
    SELECT * INTO m FROM public.menus_cobertura WHERE fecha=NEW.fecha_servicio AND activo;
    IF NOT FOUND THEN RAISE EXCEPTION 'menu_cobertura_no_disponible'; END IF;
    NEW.menu_snapshot:=jsonb_build_object('opcion_1',m.opcion_1,'opcion_2',m.opcion_2,'opcion_3',m.opcion_3);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fijar_menu_folio_cobertura() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER fijar_menu_folio_cobertura BEFORE INSERT OR UPDATE ON public.solicitudes_cobertura
FOR EACH ROW EXECUTE FUNCTION public.fijar_menu_folio_cobertura();

CREATE FUNCTION public.publicar_menu_cobertura_dia(
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
  IF p_fecha IS NULL OR p_fecha < timezone('America/Mexico_City', clock_timestamp())::date THEN
    RAISE EXCEPTION 'menu_fecha_pasada';
  END IF;
  IF coalesce(trim(p_opcion_1),'')='' OR coalesce(trim(p_opcion_2),'')='' OR coalesce(trim(p_opcion_3),'')='' THEN
    RAISE EXCEPTION 'opciones_incompletas';
  END IF;
  p_opcion_1:=trim(p_opcion_1); p_opcion_2:=trim(p_opcion_2); p_opcion_3:=trim(p_opcion_3);
  IF lower(p_opcion_1)=lower(p_opcion_2) OR lower(p_opcion_1)=lower(p_opcion_3) OR lower(p_opcion_2)=lower(p_opcion_3) THEN
    RAISE EXCEPTION 'opciones_repetidas';
  END IF;
  SELECT * INTO anterior FROM public.menus_cobertura WHERE fecha=p_fecha FOR UPDATE;
  IF NOT FOUND THEN
    IF p_version IS NOT NULL THEN RAISE EXCEPTION 'menu_fecha_version_obsoleta'; END IF;
    INSERT INTO public.menus_cobertura(fecha,opcion_1,opcion_2,opcion_3,activo,periodo_id,vigencia_desde,vigencia_hasta,actualizado_en)
      VALUES(p_fecha,trim(p_opcion_1),trim(p_opcion_2),trim(p_opcion_3),true,nuevo_id,p_fecha,p_fecha,clock_timestamp());
    RETURN jsonb_build_object('fecha',p_fecha,'menu',(SELECT to_jsonb(m) FROM public.menus_cobertura m WHERE fecha=p_fecha));
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
     SET activo=true, opcion_1=p_opcion_1, opcion_2=p_opcion_2, opcion_3=p_opcion_3,
         periodo_id=nuevo_id, vigencia_desde=p_fecha, vigencia_hasta=p_fecha,
         actualizado_en=clock_timestamp()
   WHERE fecha=p_fecha;
  RETURN jsonb_build_object('fecha',p_fecha,'menu',
    (SELECT to_jsonb(m) FROM public.menus_cobertura m WHERE fecha=p_fecha));
END;
$$;
REVOKE ALL ON FUNCTION public.publicar_menu_cobertura_dia(date,text,text,text,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publicar_menu_cobertura_dia(date,text,text,text,timestamptz) TO service_role;

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
    -- Serializa también contra el escaneo de las etiquetas del mismo folio.
    PERFORM id FROM public.solicitudes_cobertura_items WHERE solicitud_id=v_s.id FOR UPDATE;
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
  -- En altas p_version es la versión del menú; en edición es la del folio.
  IF v_s.id IS NULL THEN
    IF p_version IS NULL OR p_version IS DISTINCT FROM v_menu.actualizado_en THEN
      RAISE EXCEPTION 'menu_cobertura_desactualizado';
    END IF;
  ELSE
    v_menu.opcion_1:=v_s.menu_snapshot->>'opcion_1';
    v_menu.opcion_2:=v_s.menu_snapshot->>'opcion_2';
    v_menu.opcion_3:=v_s.menu_snapshot->>'opcion_3';
  END IF;
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


DROP FUNCTION public.autorizar_cobertura_extraordinaria(date,varchar,varchar,text,text,jsonb,varchar,text,timestamptz,uuid);
CREATE OR REPLACE FUNCTION public.autorizar_cobertura_extraordinaria(
  p_fecha date, p_turno varchar, p_zona varchar, p_folio text,
  p_responsable_numero text, p_items jsonb, p_autorizado_por varchar,
  p_motivo text, p_entrega_programada_en timestamptz, p_idempotencia uuid, p_menu_version timestamptz DEFAULT NULL
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
  IF p_menu_version IS NULL OR p_menu_version IS DISTINCT FROM v_menu.actualizado_en THEN
    RAISE EXCEPTION 'menu_cobertura_desactualizado';
  END IF;
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
REVOKE ALL ON FUNCTION public.autorizar_cobertura_extraordinaria(date,varchar,varchar,text,text,jsonb,varchar,text,timestamptz,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.autorizar_cobertura_extraordinaria(date,varchar,varchar,text,text,jsonb,varchar,text,timestamptz,uuid,timestamptz) TO service_role;

-- El formulario legado no conoce versiones. Se conserva la firma para avisar que debe actualizarse.
CREATE OR REPLACE FUNCTION public.guardar_solicitud_cobertura(
  p_fecha date,p_supervisor_id bigint,p_folio text,p_responsable_numero text,p_zona varchar,p_items jsonb,p_turno varchar
) RETURNS TABLE(solicitud_id bigint,solicitud_folio text,total integer) LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'menu_cobertura_desactualizado'; END;
$$;
REVOKE ALL ON FUNCTION public.guardar_solicitud_cobertura(date,bigint,text,text,varchar,jsonb,varchar) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guardar_solicitud_cobertura(date,bigint,text,text,varchar,jsonb,varchar) TO service_role;

NOTIFY pgrst,'reload schema';
