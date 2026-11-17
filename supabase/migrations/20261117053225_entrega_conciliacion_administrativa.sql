SET LOCAL lock_timeout = '3s';

-- Evidencia separada de la hora real de entrega. Sin defaults ni backfill.
ALTER TABLE public.pedidos
  ADD COLUMN entrega_conciliada_en timestamptz,
  ADD COLUMN entrega_conciliada_por text,
  ADD COLUMN entrega_conciliacion_motivo text,
  ADD CONSTRAINT pedido_conciliacion_completa CHECK (
    (entrega_conciliada_en IS NULL AND entrega_conciliada_por IS NULL AND entrega_conciliacion_motivo IS NULL)
    OR (entrega_conciliada_en IS NOT NULL AND isfinite(entrega_conciliada_en)
      AND entrega_conciliada_por IS NOT NULL AND length(btrim(entrega_conciliada_por)) BETWEEN 3 AND 120
      AND entrega_conciliacion_motivo IS NOT NULL AND length(btrim(entrega_conciliacion_motivo)) BETWEEN 10 AND 500)
  );
ALTER TABLE public.solicitudes_cobertura_items
  ADD COLUMN entrega_conciliada_en timestamptz,
  ADD COLUMN entrega_conciliada_por text,
  ADD COLUMN entrega_conciliacion_motivo text,
  ADD CONSTRAINT cobertura_conciliacion_completa CHECK (
    (entrega_conciliada_en IS NULL AND entrega_conciliada_por IS NULL AND entrega_conciliacion_motivo IS NULL)
    OR (entrega_conciliada_en IS NOT NULL AND isfinite(entrega_conciliada_en)
      AND entrega_conciliada_por IS NOT NULL AND length(btrim(entrega_conciliada_por)) BETWEEN 3 AND 120
      AND entrega_conciliacion_motivo IS NOT NULL AND length(btrim(entrega_conciliacion_motivo)) BETWEEN 10 AND 500)
  );

CREATE FUNCTION public.proteger_conciliacion_entrega() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF OLD.entrega_conciliada_en IS NOT NULL AND
    ROW(NEW.entrega_conciliada_en,NEW.entrega_conciliada_por,NEW.entrega_conciliacion_motivo)
    IS DISTINCT FROM ROW(OLD.entrega_conciliada_en,OLD.entrega_conciliada_por,OLD.entrega_conciliacion_motivo) THEN
    RAISE EXCEPTION 'conciliacion_entrega_inmutable';
  END IF;
  IF OLD.entrega_conciliada_en IS NULL AND NEW.entrega_conciliada_en IS NOT NULL
    AND (OLD.entregado_en IS NOT NULL OR OLD.no_surtido_en IS NOT NULL OR NEW.entregado_en IS NOT NULL OR NEW.no_surtido_en IS NOT NULL) THEN
    RAISE EXCEPTION 'conciliacion_requiere_comida_sin_confirmacion';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER proteger_conciliacion_entrega BEFORE UPDATE ON public.pedidos
FOR EACH ROW EXECUTE FUNCTION public.proteger_conciliacion_entrega();
CREATE TRIGGER proteger_conciliacion_entrega BEFORE UPDATE ON public.solicitudes_cobertura_items
FOR EACH ROW EXECUTE FUNCTION public.proteger_conciliacion_entrega();
REVOKE ALL ON FUNCTION public.proteger_conciliacion_entrega() FROM PUBLIC,anon,authenticated;
COMMENT ON COLUMN public.pedidos.entrega_conciliada_en IS 'Hora de la confirmación administrativa, nunca hora real de entrega.';
COMMENT ON COLUMN public.solicitudes_cobertura_items.entrega_conciliada_en IS 'Hora de la confirmación administrativa, nunca hora real de entrega.';
