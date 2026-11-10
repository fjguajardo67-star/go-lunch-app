SET LOCAL lock_timeout = '3s';

CREATE TABLE public.propuestas_puntos_entrega (
  id uuid PRIMARY KEY,
  zona text NOT NULL CHECK (zona IN ('zona_vdc', 'zona_refris')),
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon double precision NOT NULL CHECK (lon BETWEEN -180 AND 180),
  precision_m double precision NOT NULL CHECK (precision_m > 0 AND precision_m <= 25),
  capturado_en timestamptz NOT NULL CHECK (isfinite(capturado_en)),
  creado_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor text NOT NULL CHECK (actor IN ('repartidor', 'legado', 'admin', 'gerente')),
  repartidor_id bigint,
  repartidor_nombre text NOT NULL CHECK (length(btrim(repartidor_nombre)) BETWEEN 1 AND 120),
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobada', 'rechazada')),
  resuelto_por text CHECK (resuelto_por IN ('admin', 'gerente')),
  resuelto_en timestamptz,
  motivo text,
  CONSTRAINT propuesta_actor_valido CHECK (
    (actor = 'repartidor' AND repartidor_id IS NOT NULL AND repartidor_id > 0) OR
    (actor IN ('legado', 'admin', 'gerente') AND repartidor_id IS NULL)),
  CONSTRAINT propuesta_resolucion_completa CHECK (
    (estado = 'pendiente' AND resuelto_por IS NULL AND resuelto_en IS NULL AND motivo IS NULL) OR
    (estado IN ('aprobada', 'rechazada') AND resuelto_por IS NOT NULL AND resuelto_en IS NOT NULL AND isfinite(resuelto_en) AND
      ((estado = 'aprobada' AND motivo IS NULL) OR
       (estado = 'rechazada' AND motivo IS NOT NULL AND length(btrim(motivo)) BETWEEN 5 AND 300))))
);

CREATE UNIQUE INDEX propuesta_punto_zona_pendiente
  ON public.propuestas_puntos_entrega(zona) WHERE estado = 'pendiente';

ALTER TABLE public.propuestas_puntos_entrega ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.propuestas_puntos_entrega FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.propuestas_puntos_entrega TO service_role;
CREATE POLICY propuestas_puntos_solo_servidor ON public.propuestas_puntos_entrega
  TO service_role USING (true) WITH CHECK (true);

CREATE FUNCTION public.proponer_punto_entrega(
  p_id uuid, p_zona text, p_lat double precision, p_lon double precision,
  p_precision_m double precision, p_capturado_en timestamptz,
  p_actor text, p_repartidor_id bigint, p_repartidor_nombre text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE r public.propuestas_puntos_entrega; repetida boolean := false;
BEGIN
  IF p_id IS NULL OR p_zona IS NULL OR p_zona NOT IN ('zona_vdc','zona_refris') OR
     p_lat IS NULL OR NOT (p_lat BETWEEN -90 AND 90) OR
     p_lon IS NULL OR NOT (p_lon BETWEEN -180 AND 180) OR
     p_precision_m IS NULL OR NOT (p_precision_m > 0 AND p_precision_m <= 25) OR
     p_capturado_en IS NULL OR NOT isfinite(p_capturado_en) OR
     p_actor IS NULL OR p_actor NOT IN ('repartidor','legado','admin','gerente') OR
     p_repartidor_nombre IS NULL OR length(btrim(p_repartidor_nombre)) NOT BETWEEN 1 AND 120 OR
     (p_actor = 'repartidor' AND (p_repartidor_id IS NULL OR p_repartidor_id <= 0)) OR
     (p_actor <> 'repartidor' AND p_repartidor_id IS NOT NULL) THEN
    RAISE EXCEPTION 'propuesta_invalida';
  END IF;

  -- Dos zonas y pocas capturas: serializar estos cambios también bloquea una
  -- captura oficial concurrente por /punto, sin depender de que use esta RPC.
  -- Ambas RPC toman los bloqueos en el mismo orden, hasta terminar transacción.
  LOCK TABLE public.puntos_entrega IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.propuestas_puntos_entrega IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO r FROM public.propuestas_puntos_entrega WHERE id = p_id;
  IF FOUND THEN
    IF r.zona IS DISTINCT FROM p_zona OR r.lat IS DISTINCT FROM p_lat OR r.lon IS DISTINCT FROM p_lon OR
       r.precision_m IS DISTINCT FROM p_precision_m OR r.capturado_en IS DISTINCT FROM p_capturado_en OR
       r.actor IS DISTINCT FROM p_actor OR r.repartidor_id IS DISTINCT FROM p_repartidor_id THEN
      RAISE EXCEPTION 'idempotencia_conflicto';
    END IF;
    RETURN jsonb_build_object('propuesta', jsonb_build_object('id',r.id,'zona',r.zona,'estado',r.estado), 'ya_existia',true);
  END IF;
  IF EXISTS (SELECT 1 FROM public.puntos_entrega WHERE zona = p_zona) THEN
    RAISE EXCEPTION 'punto_ya_fijado';
  END IF;
  SELECT * INTO r FROM public.propuestas_puntos_entrega WHERE zona = p_zona AND estado = 'pendiente';
  IF FOUND THEN
    repetida := true;
  ELSE
    INSERT INTO public.propuestas_puntos_entrega
      (id,zona,lat,lon,precision_m,capturado_en,actor,repartidor_id,repartidor_nombre)
      VALUES (p_id,p_zona,p_lat,p_lon,p_precision_m,p_capturado_en,p_actor,p_repartidor_id,p_repartidor_nombre)
      RETURNING * INTO r;
  END IF;
  RETURN jsonb_build_object('propuesta', jsonb_build_object('id',r.id,'zona',r.zona,'estado',r.estado), 'ya_existia',repetida);
END;
$$;

CREATE FUNCTION public.resolver_propuesta_punto_entrega(p_id uuid, p_accion text, p_motivo text, p_rol text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE r public.propuestas_puntos_entrega; insertados integer; instante timestamptz := clock_timestamp();
BEGIN
  IF p_rol IS NULL OR p_rol NOT IN ('admin','gerente') THEN RAISE EXCEPTION 'autor_no_autorizado'; END IF;
  IF p_id IS NULL OR p_accion IS NULL OR p_accion NOT IN ('aprobar','rechazar') THEN RAISE EXCEPTION 'resolucion_invalida'; END IF;
  IF p_accion = 'rechazar' AND (p_motivo IS NULL OR length(btrim(p_motivo)) NOT BETWEEN 5 AND 300) THEN
    RAISE EXCEPTION 'motivo_invalido';
  END IF;
  LOCK TABLE public.puntos_entrega IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.propuestas_puntos_entrega IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO r FROM public.propuestas_puntos_entrega WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'propuesta_no_encontrada'; END IF;
  IF r.estado <> 'pendiente' THEN
    IF (r.estado = 'aprobada' AND p_accion = 'aprobar') OR (r.estado = 'rechazada' AND p_accion = 'rechazar') THEN
      -- Reintentar una aprobación NO repone ni modifica una captura oficial
      -- posterior, aunque se haya eliminado el punto aprobado originalmente.
      RETURN jsonb_build_object('propuesta', jsonb_build_object('id',r.id,'zona',r.zona,'estado',r.estado), 'ya_resuelta',true);
    END IF;
    RAISE EXCEPTION 'propuesta_resuelta';
  END IF;
  IF p_accion = 'aprobar' THEN
    -- Cualquier punto de la zona impide aprobar, incluso con otra clave punto.
    IF EXISTS (SELECT 1 FROM public.puntos_entrega WHERE zona = r.zona) THEN RAISE EXCEPTION 'punto_ya_fijado'; END IF;
    INSERT INTO public.puntos_entrega(zona,punto,lat,lon,radio_m,actualizado_en)
      VALUES (r.zona,'',r.lat,r.lon,150,instante) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS insertados = ROW_COUNT;
    IF insertados <> 1 THEN RAISE EXCEPTION 'punto_ya_fijado'; END IF;
  END IF;
  UPDATE public.propuestas_puntos_entrega SET
    estado = CASE WHEN p_accion = 'aprobar' THEN 'aprobada' ELSE 'rechazada' END,
    motivo = CASE WHEN p_accion = 'rechazar' THEN btrim(p_motivo) ELSE NULL END,
    resuelto_por = p_rol, resuelto_en = instante
    WHERE id = r.id RETURNING * INTO r;
  RETURN jsonb_build_object('propuesta', jsonb_build_object('id',r.id,'zona',r.zona,'estado',r.estado), 'ya_resuelta',false);
END;
$$;

REVOKE ALL ON FUNCTION public.proponer_punto_entrega(uuid,text,double precision,double precision,double precision,timestamptz,text,bigint,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolver_propuesta_punto_entrega(uuid,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.proponer_punto_entrega(uuid,text,double precision,double precision,double precision,timestamptz,text,bigint,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolver_propuesta_punto_entrega(uuid,text,text,text) TO service_role;
