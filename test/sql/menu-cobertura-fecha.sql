-- Verificación transaccional: nada de esta prueba se confirma.
-- Requiere un pedido existente únicamente para completar referencias válidas.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $$
DECLARE
  v timestamptz;
  original_id uuid;
  resultado jsonb;
  plantilla public.solicitudes_cobertura%ROWTYPE;
BEGIN
  IF EXISTS(SELECT 1 FROM public.menus_cobertura WHERE fecha BETWEEN '2099-06-01' AND '2099-06-05') THEN
    RAISE EXCEPTION 'Fechas de prueba ocupadas; no ejecutar';
  END IF;
  SELECT * INTO STRICT plantilla FROM public.solicitudes_cobertura ORDER BY id LIMIT 1;
  PERFORM public.publicar_menu_cobertura_periodo('2099-06-01','2099-06-05','Prueba A','Prueba B','Prueba C',true,NULL);
  SELECT actualizado_en,periodo_id INTO v,original_id FROM public.menus_cobertura WHERE fecha='2099-06-03';
  resultado:=public.cambiar_menu_cobertura_fecha('2099-06-03','Nueva A','Nueva B','Nueva C',v);
  IF resultado->'menu'->>'opcion_1'<>'Nueva A' THEN RAISE EXCEPTION 'No cambió el día'; END IF;
  IF (SELECT count(*) FROM public.menus_cobertura WHERE fecha BETWEEN '2099-06-01' AND '2099-06-05' AND fecha<>'2099-06-03' AND opcion_1='Prueba A' AND opcion_2='Prueba B' AND opcion_3='Prueba C' AND activo)<>4 THEN
    RAISE EXCEPTION 'Modificó opciones vecinas';
  END IF;
  IF (SELECT count(DISTINCT periodo_id) FROM public.menus_cobertura WHERE fecha BETWEEN '2099-06-01' AND '2099-06-05')<>3 THEN RAISE EXCEPTION 'No separó tres periodos'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.menus_cobertura WHERE fecha='2099-06-02' AND vigencia_desde='2099-06-01' AND vigencia_hasta='2099-06-02') OR NOT EXISTS(SELECT 1 FROM public.menus_cobertura WHERE fecha='2099-06-04' AND vigencia_desde='2099-06-04' AND vigencia_hasta='2099-06-05') THEN RAISE EXCEPTION 'Límites incorrectos'; END IF;
  BEGIN
    PERFORM public.cambiar_menu_cobertura_fecha('2099-06-03','Otra A','Otra B','Otra C',v);
    RAISE EXCEPTION 'Aceptó versión obsoleta';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'menu_fecha_version_obsoleta' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.publicar_menu_cobertura_periodo('2099-06-01','2099-06-05','Otra A','Otra B','Otra C',true,original_id);
    RAISE EXCEPTION 'Aceptó periodo obsoleto';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'periodo_no_encontrado' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.cambiar_menu_cobertura_fecha(timezone('America/Mexico_City',clock_timestamp())::date,'A','B','C',v);
    RAISE EXCEPTION 'Aceptó hoy';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'menu_fecha_no_futura' THEN RAISE; END IF;
  END;
  -- Pedido ficticio sin consumidores: permanece dentro de esta transacción.
  plantilla.id:=-62001112; plantilla.fecha_servicio:='2099-06-03';
  plantilla.folio:='PRUEBA-TRANSACCIONAL-MENU-FECHA'; plantilla.idempotencia:=gen_random_uuid();
  plantilla.entrega_programada_en:='2099-06-03T17:00:00-06:00';
  plantilla.estado:='confirmada'; plantilla.entregado_en:=NULL; plantilla.cancelado_en:=NULL;
  INSERT INTO public.solicitudes_cobertura SELECT (plantilla).*;
  SELECT actualizado_en INTO v FROM public.menus_cobertura WHERE fecha='2099-06-03';
  BEGIN
    PERFORM public.cambiar_menu_cobertura_fecha('2099-06-03','Bloqueada A','Bloqueada B','Bloqueada C',v);
    RAISE EXCEPTION 'Aceptó pedido activo';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'menu_fecha_con_pedidos' THEN RAISE; END IF;
  END;
  UPDATE public.solicitudes_cobertura SET estado='entregada' WHERE id=plantilla.id;
  BEGIN
    PERFORM public.cambiar_menu_cobertura_fecha('2099-06-03','Bloqueada A','Bloqueada B','Bloqueada C',v);
    RAISE EXCEPTION 'Aceptó pedido entregado';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'menu_fecha_con_pedidos' THEN RAISE; END IF;
  END;
  UPDATE public.solicitudes_cobertura SET estado='cancelada' WHERE id=plantilla.id;
  PERFORM public.cambiar_menu_cobertura_fecha('2099-06-03','Permitida A','Permitida B','Permitida C',v);
  IF (SELECT opcion_1 FROM public.menus_cobertura WHERE fecha='2099-06-03')<>'Permitida A' THEN RAISE EXCEPTION 'No permitió cancelados'; END IF;
  SELECT actualizado_en INTO v FROM public.menus_cobertura WHERE fecha='2099-06-01';
  PERFORM public.cambiar_menu_cobertura_fecha('2099-06-01','Primera A','Primera B','Primera C',v);
  SELECT actualizado_en INTO v FROM public.menus_cobertura WHERE fecha='2099-06-05';
  PERFORM public.cambiar_menu_cobertura_fecha('2099-06-05','Última A','Última B','Última C',v);
  IF (SELECT count(*) FROM public.menus_cobertura WHERE fecha IN ('2099-06-02','2099-06-04') AND opcion_1='Prueba A')<>2 THEN RAISE EXCEPTION 'Modificó vecinos al editar extremos'; END IF;
END $$;
ROLLBACK;
SELECT 'Pruebas SQL correctas; cambios de prueba revertidos' AS resultado;
