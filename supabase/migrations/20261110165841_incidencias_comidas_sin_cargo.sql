SET LOCAL lock_timeout = '3s';

-- Conserva el pedido y la evidencia original de entrega. La incidencia tiene
-- prioridad al conciliar, sin borrar la marca que se está rectificando.
ALTER TABLE public.pedidos
  ADD COLUMN no_surtido_en timestamptz,
  ADD COLUMN no_surtido_motivo text,
  ADD COLUMN no_surtido_por text,
  ADD CONSTRAINT pedido_no_surtido_completo CHECK (
    (no_surtido_en IS NULL AND no_surtido_motivo IS NULL AND no_surtido_por IS NULL) OR
    (no_surtido_en IS NOT NULL AND no_surtido_motivo IS NOT NULL AND no_surtido_por IS NOT NULL AND length(btrim(no_surtido_motivo)) BETWEEN 5 AND 500
      AND no_surtido_por IN ('admin','gerente')));
ALTER TABLE public.solicitudes_cobertura_items
  ADD COLUMN no_surtido_en timestamptz,
  ADD COLUMN no_surtido_motivo text,
  ADD COLUMN no_surtido_por text,
  ADD CONSTRAINT cobertura_item_no_surtido_completo CHECK (
    (no_surtido_en IS NULL AND no_surtido_motivo IS NULL AND no_surtido_por IS NULL) OR
    (no_surtido_en IS NOT NULL AND no_surtido_motivo IS NOT NULL AND no_surtido_por IS NOT NULL AND length(btrim(no_surtido_motivo)) BETWEEN 5 AND 500
      AND no_surtido_por IN ('admin','gerente')));

CREATE FUNCTION public.proteger_comida_no_surtida() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.no_surtido_en IS NOT NULL THEN RAISE EXCEPTION 'incidencia_no_surtido_inmutable'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.no_surtido_en IS NOT NULL AND
    (NEW.no_surtido_en IS DISTINCT FROM OLD.no_surtido_en OR
     NEW.no_surtido_motivo IS DISTINCT FROM OLD.no_surtido_motivo OR
     NEW.no_surtido_por IS DISTINCT FROM OLD.no_surtido_por OR
     NEW.opcion_id IS DISTINCT FROM OLD.opcion_id OR NEW.opcion_texto IS DISTINCT FROM OLD.opcion_texto OR
     to_jsonb(NEW)->'zona' IS DISTINCT FROM to_jsonb(OLD)->'zona' OR
     to_jsonb(NEW)->'turno' IS DISTINCT FROM to_jsonb(OLD)->'turno' OR
     to_jsonb(NEW)->'fecha_menu' IS DISTINCT FROM to_jsonb(OLD)->'fecha_menu' OR
     to_jsonb(NEW)->'fecha_servicio' IS DISTINCT FROM to_jsonb(OLD)->'fecha_servicio') THEN
    RAISE EXCEPTION 'incidencia_no_surtido_inmutable';
  END IF;
  IF NEW.no_surtido_en IS NOT NULL AND NEW.entregado_en IS DISTINCT FROM OLD.entregado_en THEN
    RAISE EXCEPTION 'comida_no_surtida';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER proteger_pedido_no_surtido BEFORE UPDATE OR DELETE ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.proteger_comida_no_surtida();
CREATE TRIGGER proteger_cobertura_item_no_surtido BEFORE UPDATE OR DELETE ON public.solicitudes_cobertura_items
  FOR EACH ROW EXECUTE FUNCTION public.proteger_comida_no_surtida();

-- Un folio con una incidencia tampoco se cancela ni se reasigna desde un
-- formulario antiguo: eso ocultaría del PDF la aclaración para RRHH.
CREATE FUNCTION public.proteger_folio_con_incidencia() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD AND
     EXISTS(SELECT 1 FROM public.solicitudes_cobertura_items WHERE solicitud_id=OLD.id AND no_surtido_en IS NOT NULL) THEN
    RAISE EXCEPTION 'folio_con_incidencia_no_surtido';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER proteger_folio_con_incidencia BEFORE UPDATE ON public.solicitudes_cobertura
  FOR EACH ROW EXECUTE FUNCTION public.proteger_folio_con_incidencia();

CREATE FUNCTION public.registrar_comida_no_surtida(
  p_tipo text, p_id bigint, p_motivo text, p_rol text, p_entregado_esperado timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE r record; padre bigint; estado_padre text; fecha date; instante timestamptz := clock_timestamp();
BEGIN
  IF p_tipo NOT IN ('regular','cobertura') OR p_tipo IS NULL OR p_id IS NULL OR p_id <= 0 THEN
    RAISE EXCEPTION 'comida_invalida';
  END IF;
  IF p_rol NOT IN ('admin','gerente') OR p_rol IS NULL THEN RAISE EXCEPTION 'autor_no_autorizado'; END IF;
  IF p_motivo IS NULL OR length(btrim(p_motivo)) NOT BETWEEN 5 AND 500 OR
     p_motivo ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'motivo_invalido'; END IF;
  IF p_tipo='regular' THEN
    SELECT * INTO r FROM public.pedidos WHERE id=p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'comida_no_encontrada'; END IF;
    fecha := r.fecha_menu;
  ELSE
    SELECT solicitud_id INTO padre FROM public.solicitudes_cobertura_items WHERE id=p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'comida_no_encontrada'; END IF;
    SELECT estado INTO estado_padre FROM public.solicitudes_cobertura WHERE id=padre FOR UPDATE;
    IF estado_padre IS NULL OR estado_padre='cancelada' THEN RAISE EXCEPTION 'solicitud_cancelada'; END IF;
    SELECT * INTO r FROM public.solicitudes_cobertura_items WHERE id=p_id AND solicitud_id=padre FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'comida_no_encontrada'; END IF;
    fecha := r.fecha_servicio;
  END IF;
  -- Un doble clic o una respuesta perdida recupera la misma autorización.
  IF r.no_surtido_en IS NOT NULL THEN RETURN to_jsonb(r); END IF;
  IF fecha > (instante AT TIME ZONE 'America/Mexico_City')::date THEN RAISE EXCEPTION 'servicio_futuro'; END IF;
  IF r.entregado_en IS DISTINCT FROM p_entregado_esperado THEN RAISE EXCEPTION 'estado_entrega_actualizado'; END IF;
  IF p_tipo='regular' THEN
    UPDATE public.pedidos SET no_surtido_en=instante, no_surtido_motivo=btrim(p_motivo), no_surtido_por=p_rol
      WHERE id=p_id RETURNING * INTO r;
  ELSE
    UPDATE public.solicitudes_cobertura_items SET no_surtido_en=instante, no_surtido_motivo=btrim(p_motivo), no_surtido_por=p_rol
      WHERE id=p_id RETURNING * INTO r;
  END IF;
  RETURN to_jsonb(r);
END;
$$;
REVOKE ALL ON FUNCTION public.registrar_comida_no_surtida(text,bigint,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_comida_no_surtida(text,bigint,text,text,timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.proteger_comida_no_surtida() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.proteger_folio_con_incidencia() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
