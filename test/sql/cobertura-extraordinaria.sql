-- Ejecutar exclusivamente en una base local desechable con schema.sql cargado.
-- Todos los datos son ficticios y la transacción termina en ROLLBACK.
BEGIN;
DO $$
DECLARE
  v_fecha date := timezone('America/Mexico_City',clock_timestamp())::date;
  v_hora timestamptz := least(clock_timestamp()+interval '1 hour', (timezone('America/Mexico_City',clock_timestamp())::date+time '23:59:59') at time zone 'America/Mexico_City');
  v_super bigint;
  v_entregada bigint;
  v_uuid uuid := gen_random_uuid();
  v_primero public.solicitudes_cobertura%ROWTYPE;
  v_reintento public.solicitudes_cobertura%ROWTYPE;
  v_items jsonb := '[{"numero_empleado":"QA-EX-002","opcion_id":"especial_1"}]';
  v_error text;
BEGIN
  INSERT INTO public.empleados(telefono,nombre,numero_empleado,activo) VALUES
    ('QA-EX-SUP','Supervisor ficticio QA','QA-EX-SUP',true),
    ('QA-EX-001','Empleado entregado QA','QA-EX-001',true),
    ('QA-EX-002','Empleado nuevo QA','QA-EX-002',true),
    ('QA-EX-003','Responsable ficticio QA','QA-EX-003',true);
  INSERT INTO public.supervisores_cobertura(empleado_telefono,clave_hash,vigente_desde)
    VALUES ('QA-EX-SUP','sin-credencial-usable',v_fecha) RETURNING id INTO v_super;
  INSERT INTO public.menus_cobertura(fecha,opcion_1,opcion_2,opcion_3) VALUES(v_fecha,'Opción QA 1','Opción QA 2','Opción QA 3') ON CONFLICT DO NOTHING;
  INSERT INTO public.solicitudes_cobertura(folio,fecha_servicio,supervisor_id,supervisor_numero_snapshot,supervisor_nombre_snapshot,responsable_telefono,responsable_numero_snapshot,responsable_nombre_snapshot,zona,turno,total_porciones,estado,entregado_en)
    VALUES('QA-EX-ENTREGADA',v_fecha,v_super,'QA-EX-SUP','Supervisor ficticio QA','QA-EX-003','QA-EX-003','Responsable ficticio QA','zona_refris','turno_b',1,'entregada',clock_timestamp()) RETURNING id INTO v_entregada;
  INSERT INTO public.solicitudes_cobertura_items(solicitud_id,fecha_servicio,empleado_telefono,empleado_numero_snapshot,empleado_nombre_snapshot,opcion_id,opcion_texto,entregado_en)
    VALUES(v_entregada,v_fecha,'QA-EX-001','QA-EX-001','Empleado entregado QA','especial_1','Opción QA 1',clock_timestamp());
  SELECT * INTO v_primero FROM public.autorizar_cobertura_extraordinaria(v_fecha,'turno_b','zona_refris','QA-EX-NUEVA','QA-EX-003',v_items,'gerente','Ventana disponible para prueba',v_hora,v_uuid);
  ASSERT v_primero.origen='extraordinaria' AND v_primero.supervisor_id IS NULL AND v_primero.total_porciones=1;
  SELECT * INTO v_reintento FROM public.autorizar_cobertura_extraordinaria(v_fecha,'turno_b','zona_refris','QA-EX-OTRO-FOLIO','QA-EX-003',v_items,'gerente','Ventana disponible para prueba',v_hora,v_uuid);
  ASSERT v_reintento.id=v_primero.id,'el reintento duplicó el pedido';
  ASSERT (SELECT count(*)=1 FROM public.solicitudes_cobertura_items WHERE solicitud_id=v_primero.id);
  ASSERT (SELECT estado='entregada' AND total_porciones=1 FROM public.solicitudes_cobertura WHERE id=v_entregada),'modificó el folio entregado';
  FOR v_error IN SELECT unnest(ARRAY['fecha_cobertura_invalida','autorizacion_extraordinaria_invalida','entrega_extraordinaria_invalida','empleados_ya_asignados:QA-EX-002','empleados_no_encontrados:QA-EX-NOEXISTE','idempotencia_extraordinaria_invalida']) LOOP
    BEGIN
      PERFORM * FROM public.autorizar_cobertura_extraordinaria(
        CASE WHEN v_error='fecha_cobertura_invalida' THEN v_fecha+1 ELSE v_fecha END,
        'turno_b','zona_refris','QA-EX-RECHAZADA','QA-EX-003',
        CASE WHEN v_error LIKE 'empleados_no_encontrados:%' THEN '[{"numero_empleado":"QA-EX-NOEXISTE","opcion_id":"especial_1"}]'::jsonb ELSE v_items END,
        CASE WHEN v_error='autorizacion_extraordinaria_invalida' THEN 'supervisor' ELSE 'gerente' END,
        'Motivo diferente en el reintento',
        CASE WHEN v_error='entrega_extraordinaria_invalida' THEN clock_timestamp()-interval '1 minute' ELSE v_hora END,
        CASE WHEN v_error='idempotencia_extraordinaria_invalida' THEN v_uuid ELSE gen_random_uuid() END);
      RAISE EXCEPTION 'debió rechazar: %',v_error;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM<>v_error THEN RAISE; END IF;
    END;
  END LOOP;
  IF timezone('America/Mexico_City',clock_timestamp())::time >= time '14:00' THEN
  BEGIN
    PERFORM * FROM public.guardar_solicitud_cobertura(v_fecha,v_super,'QA-EX-NORMAL','QA-EX-003','zona_refris',v_items,'turno_b');
    RAISE EXCEPTION 'se abrió el corte del supervisor';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'cobertura_cerrada' THEN RAISE; END IF; END;
  END IF;
  ASSERT NOT has_function_privilege('anon','public.autorizar_cobertura_extraordinaria(date,character varying,character varying,text,text,jsonb,character varying,text,timestamp with time zone,uuid)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.autorizar_cobertura_extraordinaria(date,character varying,character varying,text,text,jsonb,character varying,text,timestamp with time zone,uuid)','EXECUTE');
  ASSERT has_function_privilege('service_role','public.autorizar_cobertura_extraordinaria(date,character varying,character varying,text,text,jsonb,character varying,text,timestamp with time zone,uuid)','EXECUTE');
END;
$$;

ROLLBACK;
