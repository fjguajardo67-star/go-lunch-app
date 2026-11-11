SET LOCAL lock_timeout = '3s';

CREATE TABLE public.marcas_ruta_reparto (
  fecha date NOT NULL,
  ruta text NOT NULL CHECK (ruta IN ('turno_a_asla', 'turno_a_refis', 'turno_b')),
  paso smallint NOT NULL CHECK (paso BETWEEN 0 AND 3 OR (ruta = 'turno_b' AND paso BETWEEN 4 AND 5)),
  repartidor_id bigint CHECK (repartidor_id > 0),
  repartidor_nombre text NOT NULL,
  ocurrido_en timestamptz NOT NULL CHECK (isfinite(ocurrido_en)),
  recibido_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  lat double precision,
  lon double precision,
  precision_m double precision,
  PRIMARY KEY (fecha, ruta, paso),
  CHECK (num_nonnulls(lat, lon, precision_m) = 0 OR
    (num_nonnulls(lat, lon, precision_m) = 3 AND lat BETWEEN -90 AND 90 AND
     lon BETWEEN -180 AND 180 AND precision_m BETWEEN 0 AND 100))
);

ALTER TABLE public.marcas_ruta_reparto ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.marcas_ruta_reparto FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.marcas_ruta_reparto TO service_role;
CREATE POLICY marcas_ruta_solo_servidor ON public.marcas_ruta_reparto
  TO service_role USING (true) WITH CHECK (true);

CREATE FUNCTION public.registrar_marca_ruta_reparto(
  p_fecha date, p_ruta text, p_paso smallint, p_repartidor_id bigint,
  p_repartidor_nombre text, p_ocurrido_en timestamptz,
  p_lat double precision, p_lon double precision, p_precision_m double precision
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $$
DECLARE
  inicio public.marcas_ruta_reparto;
  marca public.marcas_ruta_reparto;
  anterior timestamptz;
BEGIN
  -- Serializa solo el mismo itinerario y día, incluso antes de la primera marca.
  PERFORM pg_advisory_xact_lock(hashtextextended('golunch:ruta:' || p_fecha::text || ':' || p_ruta, 0));
  SELECT * INTO inicio FROM public.marcas_ruta_reparto
    WHERE fecha = p_fecha AND ruta = p_ruta AND paso = 0;
  IF FOUND AND inicio.repartidor_id IS DISTINCT FROM p_repartidor_id THEN
    RAISE EXCEPTION 'ruta_otro_repartidor';
  END IF;

  SELECT * INTO marca FROM public.marcas_ruta_reparto
    WHERE fecha = p_fecha AND ruta = p_ruta AND paso = p_paso;
  IF FOUND THEN RETURN to_jsonb(marca); END IF;

  IF p_paso = 0 THEN
    IF (p_ocurrido_en AT TIME ZONE 'America/Mexico_City')::date <> p_fecha THEN
      RAISE EXCEPTION 'fecha_marca_invalida';
    END IF;
  ELSE
    SELECT ocurrido_en INTO anterior FROM public.marcas_ruta_reparto
      WHERE fecha = p_fecha AND ruta = p_ruta AND paso = p_paso - 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'falta_marca_anterior'; END IF;
    IF p_ocurrido_en < anterior OR p_ocurrido_en > inicio.ocurrido_en + interval '24 hours' THEN
      RAISE EXCEPTION 'fecha_marca_invalida';
    END IF;
  END IF;

  INSERT INTO public.marcas_ruta_reparto
    (fecha, ruta, paso, repartidor_id, repartidor_nombre, ocurrido_en, lat, lon, precision_m)
  VALUES (p_fecha, p_ruta, p_paso, p_repartidor_id,
    coalesce(inicio.repartidor_nombre, p_repartidor_nombre), p_ocurrido_en, p_lat, p_lon, p_precision_m)
  RETURNING * INTO marca;
  RETURN to_jsonb(marca);
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_marca_ruta_reparto(date,text,smallint,bigint,text,timestamptz,double precision,double precision,double precision) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_marca_ruta_reparto(date,text,smallint,bigint,text,timestamptz,double precision,double precision,double precision) TO service_role;
