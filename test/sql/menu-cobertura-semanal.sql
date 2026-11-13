-- Solo en PostgreSQL local de QA. Requiere los dos folios ficticios del escenario
-- de migración (QA-ANTERIOR-2/3), reloj 13/nov/2026 y empleados 00001–00015.
DO $$
DECLARE
  anterior public.solicitudes_cobertura%ROWTYPE;
  nueva public.solicitudes_cobertura%ROWTYPE;
  m public.menus_cobertura%ROWTYPE;
  version_anterior timestamptz;
  qr uuid;
  resultado jsonb;
  dias_vecinos jsonb;
BEGIN
  SELECT * INTO STRICT anterior FROM public.solicitudes_cobertura WHERE folio='QA-ANTERIOR-2';
  SELECT codigo_entrega INTO qr FROM public.solicitudes_cobertura_items WHERE solicitud_id=anterior.id;
  SELECT * INTO STRICT m FROM public.menus_cobertura WHERE fecha='2026-11-13';
  version_anterior:=m.actualizado_en;
  SELECT jsonb_agg(jsonb_build_object('fecha',fecha,'opcion_1',opcion_1,'opcion_2',opcion_2,'opcion_3',opcion_3) ORDER BY fecha)
    INTO dias_vecinos FROM public.menus_cobertura WHERE fecha<>'2026-11-13';
  resultado:=public.publicar_menu_cobertura_dia('2026-11-13','Pechuga QA','Mixta QA','Enchiladas QA',m.actualizado_en);
  IF resultado->'menu'->>'opcion_1'<>'Pechuga QA' THEN RAISE EXCEPTION 'No publicó el menú de hoy'; END IF;
  IF dias_vecinos IS DISTINCT FROM (SELECT jsonb_agg(jsonb_build_object('fecha',fecha,'opcion_1',opcion_1,'opcion_2',opcion_2,'opcion_3',opcion_3) ORDER BY fecha) FROM public.menus_cobertura WHERE fecha<>'2026-11-13') THEN
    RAISE EXCEPTION 'Cambió opciones de días vecinos';
  END IF;
  IF (SELECT count(*) FROM public.solicitudes_cobertura_items WHERE opcion_texto='Pescado QA')<>2 THEN RAISE EXCEPTION 'Cambió platillos confirmados'; END IF;
  IF (SELECT menu_snapshot->>'opcion_3' FROM public.solicitudes_cobertura WHERE id=anterior.id)<>'Pescado QA' THEN RAISE EXCEPTION 'No conservó menú original'; END IF;
  -- Una pantalla anterior no puede convertir Pescado en Enchiladas al confirmar.
  BEGIN
    PERFORM public.guardar_lote_cobertura_supervisor(1,'2026-11-13','turno_b','zona_vdc','QA-OBSOLETO','00001','[{"numero_empleado":"00004","opcion_id":"especial_3"}]','2026-11-13T18:00:00-06:00',gen_random_uuid(),NULL,version_anterior);
    RAISE EXCEPTION 'Aceptó una pantalla con menú anterior';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'menu_cobertura_desactualizado' THEN RAISE; END IF; END;
  SELECT * INTO m FROM public.menus_cobertura WHERE fecha='2026-11-13';
  SELECT * INTO nueva FROM public.guardar_lote_cobertura_supervisor(1,'2026-11-13','turno_b','zona_vdc','QA-NUEVO','00001','[{"numero_empleado":"00004","opcion_id":"especial_3"}]','2026-11-13T18:00:00-06:00',gen_random_uuid(),NULL,m.actualizado_en);
  IF (SELECT opcion_texto FROM public.solicitudes_cobertura_items WHERE solicitud_id=nueva.id)<>'Enchiladas QA' THEN RAISE EXCEPTION 'No usó nuevo menú'; END IF;
  -- Cambiar horario y agregar otro empleado en un folio anterior conserva su menú y QR.
  PERFORM public.guardar_lote_cobertura_supervisor(1,'2026-11-13','turno_b','zona_vdc',anterior.folio,'00001','[{"numero_empleado":"00002","opcion_id":"especial_3"},{"numero_empleado":"00005","opcion_id":"especial_1"}]','2026-11-13T18:30:00-06:00',anterior.idempotencia,anterior.id,anterior.actualizado_en);
  IF NOT EXISTS(SELECT 1 FROM public.solicitudes_cobertura_items WHERE solicitud_id=anterior.id AND empleado_numero_snapshot='00002' AND opcion_texto='Pescado QA' AND codigo_entrega=qr) THEN RAISE EXCEPTION 'Cambió comida o QR al editar'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.solicitudes_cobertura_items WHERE solicitud_id=anterior.id AND empleado_numero_snapshot='00005' AND opcion_texto='Hamburguesa QA') THEN RAISE EXCEPTION 'Agregó persona con menú equivocado'; END IF;
  -- El reintento de la confirmación perdida devuelve el original tras publicar otra versión.
  PERFORM public.publicar_menu_cobertura_dia('2026-11-13','Versión tres A','Versión tres B','Versión tres C',m.actualizado_en);
  PERFORM public.guardar_lote_cobertura_supervisor(1,'2026-11-13','turno_b','zona_vdc',nueva.folio,'00001','[{"numero_empleado":"00004","opcion_id":"especial_3"}]','2026-11-13T18:00:00-06:00',nueva.idempotencia,NULL,m.actualizado_en);
  IF (SELECT count(*) FROM public.solicitudes_cobertura WHERE folio='QA-NUEVO')<>1 THEN RAISE EXCEPTION 'Duplicó reintento'; END IF;
  BEGIN
    PERFORM public.publicar_menu_cobertura_dia('2026-11-13','Obsoleta A','Obsoleta B','Obsoleta C',m.actualizado_en);
    RAISE EXCEPTION 'Aceptó publicación obsoleta';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'menu_fecha_version_obsoleta' THEN RAISE; END IF; END;
  BEGIN
    UPDATE public.solicitudes_cobertura SET menu_snapshot='{"opcion_1":"A","opcion_2":"B","opcion_3":"C"}' WHERE id=anterior.id;
    RAISE EXCEPTION 'Cambió menú original del folio';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'menu_folio_inmutable' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.publicar_menu_cobertura_dia('2026-11-12','Histórica A','Histórica B','Histórica C',NULL);
    RAISE EXCEPTION 'Cambió historia';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'menu_fecha_pasada' THEN RAISE; END IF; END;
  -- Publicación independiente: una fecha nueva no necesita completar la semana.
  PERFORM public.publicar_menu_cobertura_dia('2026-11-16','Lunes A','Lunes B','Lunes C',NULL);
  IF EXISTS(SELECT 1 FROM public.menus_cobertura WHERE fecha BETWEEN '2026-11-17' AND '2026-11-22') THEN RAISE EXCEPTION 'Publicó días no solicitados'; END IF;
  SELECT * INTO m FROM public.menus_cobertura WHERE fecha='2026-11-13';
  BEGIN
    PERFORM public.autorizar_cobertura_extraordinaria('2026-11-13','turno_b','zona_refris','QA-EXTRA-VIEJO','00001','[{"numero_empleado":"00006","opcion_id":"especial_1"}]','admin','Prueba de menú atrasado','2026-11-13T17:30:00-06:00',gen_random_uuid(),version_anterior);
    RAISE EXCEPTION 'Extraordinaria aceptó menú anterior';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'menu_cobertura_desactualizado' THEN RAISE; END IF; END;
  PERFORM public.autorizar_cobertura_extraordinaria('2026-11-13','turno_b','zona_refris','QA-EXTRA-NUEVO','00001','[{"numero_empleado":"00006","opcion_id":"especial_1"}]','admin','Prueba de menú vigente','2026-11-13T17:30:00-06:00',gen_random_uuid(),m.actualizado_en);
  IF NOT EXISTS(SELECT 1 FROM public.solicitudes_cobertura s JOIN public.solicitudes_cobertura_items i ON i.solicitud_id=s.id WHERE s.folio='QA-EXTRA-NUEVO' AND i.opcion_texto='Versión tres A') THEN RAISE EXCEPTION 'Extraordinaria no usó menú vigente'; END IF;
  IF has_function_privilege('anon','public.publicar_menu_cobertura_dia(date,text,text,text,timestamptz)','EXECUTE') OR has_function_privilege('authenticated','public.publicar_menu_cobertura_dia(date,text,text,text,timestamptz)','EXECUTE') THEN RAISE EXCEPTION 'Publicación accesible al público'; END IF;
END;
$$;
