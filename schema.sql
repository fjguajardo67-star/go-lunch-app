-- ====================================================================
-- CICSA COMEDOR — Esquema de base de datos (Supabase / PostgreSQL)
-- Ejecutar en: Supabase Dashboard → SQL Editor → New Query → Run
-- ====================================================================

-- Empleados (acceso por número de empleado; teléfono opcional)
CREATE TABLE IF NOT EXISTS empleados (
    telefono        VARCHAR PRIMARY KEY,        -- Teléfono real o clave interna emp_<hex del número de empleado> para altas web sin teléfono.
    nombre          TEXT    NOT NULL,
    numero_empleado VARCHAR UNIQUE NOT NULL,
    activo          BOOLEAN DEFAULT true,
    -- Asignación que entrega RRHH. Sirve de valor por defecto al pedir:
    -- el empleado puede cubrir otro turno sin que esto cambie.
    zona_default    VARCHAR,                   -- zona_vdc | zona_refris
    turno_default   VARCHAR,                   -- turno_a | turno_b
    creado_en       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Si la tabla ya existía sin estas columnas, ejecutar:
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS zona_default  VARCHAR;
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS turno_default VARCHAR;
CREATE INDEX IF NOT EXISTS idx_empleados_numero ON empleados (numero_empleado);

-- Menús diarios (3 opciones fijas + 3 variables)
CREATE TABLE IF NOT EXISTS menus (
    fecha     DATE PRIMARY KEY,                 -- YYYY-MM-DD. Una fila por día.
    fija_a    TEXT NOT NULL,
    fija_b    TEXT NOT NULL,
    fija_c    TEXT NOT NULL,
    var_1     TEXT NOT NULL,
    var_2     TEXT NOT NULL,
    var_3     TEXT NOT NULL,
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Pedidos (un registro por empleado por día)
CREATE TABLE IF NOT EXISTS pedidos (
    id                BIGSERIAL PRIMARY KEY,
    fecha_menu        DATE    NOT NULL REFERENCES menus(fecha) ON DELETE CASCADE,
    empleado_telefono VARCHAR NOT NULL REFERENCES empleados(telefono) ON DELETE CASCADE,
    opcion_id         VARCHAR NOT NULL,          -- fija_a|fija_b|fija_c|var_1|var_2|var_3
    opcion_texto      TEXT    NOT NULL,          -- nombre del platillo (respaldo histórico)
    zona              VARCHAR,                   -- zona_vdc | zona_refris
    turno             VARCHAR,                   -- turno_a | turno_b
    creado_en         TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unico_pedido_por_dia UNIQUE (fecha_menu, empleado_telefono)
);

-- Si la tabla ya existía sin estas columnas, ejecutar:
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS zona  VARCHAR;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS turno VARCHAR;

-- El teléfono es la llave primaria del empleado y a veces hay que corregirlo
-- (dedo al capturar, cambio de número). Con ON UPDATE CASCADE los pedidos
-- siguen al empleado solos y se conserva su historial; sin esto la única
-- salida sería borrarlo y recrearlo, y el ON DELETE CASCADE se llevaría todos
-- sus pedidos. Idempotente: se puede volver a correr sin romper nada.
DO $$
DECLARE nombre_fk TEXT;
BEGIN
  FOR nombre_fk IN
    SELECT DISTINCT con.conname
      FROM pg_constraint con
      JOIN pg_attribute  att ON att.attrelid = con.conrelid
                            AND att.attnum   = ANY (con.conkey)
     WHERE con.conrelid = 'pedidos'::regclass
       AND con.contype  = 'f'
       AND att.attname  = 'empleado_telefono'
  LOOP
    EXECUTE format('ALTER TABLE pedidos DROP CONSTRAINT %I', nombre_fk);
  END LOOP;

  ALTER TABLE pedidos
    ADD CONSTRAINT pedidos_empleado_telefono_fkey
    FOREIGN KEY (empleado_telefono) REFERENCES empleados(telefono)
    ON DELETE CASCADE ON UPDATE CASCADE;
END $$;

-- Confirmación de entrega (se escanea el QR de la etiqueta al entregar).
-- entregado_en guarda la hora REAL del escaneo, no la de sincronización:
-- el reparto ocurre sin señal y los datos suben después.
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS entregado_en TIMESTAMP WITH TIME ZONE;
CREATE INDEX IF NOT EXISTS idx_pedidos_entrega ON pedidos (fecha_menu, entregado_en);

-- Motivo que elige el chofer cuando la entrega sale tardía (solo entonces).
-- Se guarda el id del catálogo MOTIVOS_TARDIA de services/menu.js.
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS motivo_tardia VARCHAR;

-- Calificación del platillo. La captura el empleado en la página de pedidos
-- cuando vuelve y su pedido anterior ya fue entregado: si | tal_vez | no
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS rating VARCHAR;

-- ════════════════════════════════════════════════════════════════════
-- EVIDENCIA DE ENTREGA
--
-- El contrato descuenta el 30% del costo de los box lunch "entregados de
-- forma extemporánea", y castiga aparte la cantidad no entregada. Las
-- columnas de aquí abajo existen para poder sostener las dos cosas con algo
-- más que la palabra del repartidor.
-- ════════════════════════════════════════════════════════════════════

-- Dónde se escaneó cada entrega. Es lo que rebate "lo escanearon en ruta":
-- veinte escaneos en un racimo de metros son un reparto en sitio; un rastro
-- que avanza por la carretera es otra cosa muy distinta.
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS entrega_lat         DOUBLE PRECISION;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS entrega_lon         DOUBLE PRECISION;
-- Precisión del fix en metros. Se guarda porque una coordenada de ±1500 m
-- parece evidencia y no prueba nada: sin este dato no hay forma de saberlo.
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS entrega_precision_m REAL;

-- A quién se le entregó. Sin esto, la comida que el empleado no recogió se
-- registraba como NO ENTREGADA — evidencia en contra del proveedor por algo
-- que sí cocinó y sí llevó. 'empleado' | 'supervisor'
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS entregado_a  VARCHAR;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS recibido_por TEXT;

-- Hora en que el registro llegó al SERVIDOR. No sustituye a entregado_en,
-- que es el momento real del escaneo y se captura sin señal; la acota. Es el
-- único dato de esta tabla que no viene del reloj del repartidor, así que es
-- lo que responde a "le movieron la hora a la tablet". Si la diferencia
-- saliera negativa, es imposible y delata manipulación.
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS entrega_recibido_en TIMESTAMP WITH TIME ZONE;

-- Quién abrió la app y consultó el menú de un día, haya pedido o no.
--
-- Sin esto, "no ordenó" tapa dos problemas opuestos: quien miró el menú y no
-- le gustó (problema de cocina) y quien nunca supo que la app existe (problema
-- de difusión). En el arranque del servicio, la segunda es casi siempre la
-- explicación, y no había forma de distinguirlas.
--
-- Se registra al identificarse con el número de empleado. Una fila por persona
-- y fecha de servicio: la primera vez que miró, la última, y cuántas veces.
CREATE TABLE IF NOT EXISTS accesos (
    fecha_menu        DATE    NOT NULL,
    empleado_telefono VARCHAR NOT NULL,
    visto_en          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),  -- la primera
    ultima_vez        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    veces             INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (fecha_menu, empleado_telefono)
);
-- Sin llave foránea a propósito: esta bitácora es de consulta, no de negocio.
-- Un empleado dado de baja no debe llevarse el registro de que sí miraba el
-- menú, y una consulta no puede fallar por integridad referencial.
CREATE INDEX IF NOT EXISTS idx_accesos_fecha ON accesos (fecha_menu);

-- ════════════════════════════════════════════════════════════════════
-- REPARTIDORES
--
-- Antes todos los equipos compartían una sola ENTREGA_KEY, así que una
-- entrega no se podía atribuir a nadie: solo "alguien con la clave". Con dos
-- repartidores trabajando a la vez y una penalización contractual de por
-- medio, eso ya no alcanza.
--
-- La clave la asigna el administrador; el repartidor no crea la suya.
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS repartidores (
    id             BIGSERIAL PRIMARY KEY,
    nombre         TEXT    NOT NULL,
    -- NUNCA la clave en claro. Formato scrypt$N$r$p$sal$hash (services/sesion.js),
    -- con los parámetros dentro para poder endurecerlos después sin invalidar
    -- las claves ya entregadas.
    clave_hash     TEXT    NOT NULL,
    -- Zonas autorizadas. Un arreglo y no dos banderas porque mañana puede
    -- haber un tercer comedor y la restricción de abajo lo absorbe sola.
    zonas          TEXT[]  NOT NULL DEFAULT '{}',
    activo         BOOLEAN NOT NULL DEFAULT true,
    -- Se sube al restablecer la clave o desactivar al repartidor: cualquier
    -- token emitido antes deja de valer, sin llevar lista de revocados.
    version_sesion INTEGER NOT NULL DEFAULT 1,
    creado_en      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    actualizado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Solo zonas del catálogo. Sin esto un error de captura deja a alguien con una
-- zona que no existe y sin poder entrar, o peor, entrando a donde no debe.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'repartidores_zonas_validas') THEN
    ALTER TABLE repartidores ADD CONSTRAINT repartidores_zonas_validas
      CHECK (zonas <@ ARRAY['zona_vdc','zona_refris']::TEXT[]);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_repartidores_activo ON repartidores (activo);

-- Quién confirmó cada entrega. El id sirve para cruzar; el nombre se guarda
-- como fotografía del momento porque un reporte de hace seis meses debe seguir
-- diciendo quién entregó aunque esa persona ya no esté en la plantilla.
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS entregado_por_id     BIGINT;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS entregado_por_nombre TEXT;

-- ON DELETE SET NULL y no CASCADE: borrar a un repartidor jamás debe borrar
-- entregas. Se pierde el vínculo, nunca la evidencia.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pedidos_entregado_por_fkey') THEN
    ALTER TABLE pedidos ADD CONSTRAINT pedidos_entregado_por_fkey
      FOREIGN KEY (entregado_por_id) REFERENCES repartidores(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pedidos_repartidor ON pedidos (entregado_por_id);

-- Llegada del repartidor al punto de entrega.
--
-- Es el evento que decide la puntualidad, y no el escaneo: repartir 30 box
-- lunch toma diez minutos o más, así que medir comida por comida garantiza
-- que la última siempre salga tarde aunque el vehículo haya llegado a tiempo.
-- El contrato coincide: penaliza "los box lunch entregados de forma
-- extemporánea" en bloque, no por unidad.
CREATE TABLE IF NOT EXISTS llegadas (
    id           BIGSERIAL PRIMARY KEY,
    fecha_menu   DATE    NOT NULL,
    zona         VARCHAR NOT NULL,               -- zona_vdc | zona_refris
    turno        VARCHAR NOT NULL,               -- turno_a | turno_b
    -- Vacío por defecto. El contrato nombra "REFIS 1, 2 y 3": si el reparto
    -- resulta ser tres paradas, cada una se distingue aquí sin migrar nada.
    punto        VARCHAR NOT NULL DEFAULT '',
    llegada_en   TIMESTAMP WITH TIME ZONE NOT NULL,      -- reloj del equipo
    recibido_en  TIMESTAMP WITH TIME ZONE DEFAULT NOW(), -- reloj del servidor
    lat          DOUBLE PRECISION,
    lon          DOUBLE PRECISION,
    precision_m  REAL,
    -- La primera llegada es la buena. Reenviar desde la cola no la mueve.
    CONSTRAINT unica_llegada UNIQUE (fecha_menu, zona, turno, punto)
);
CREATE INDEX IF NOT EXISTS idx_llegadas_fecha ON llegadas (fecha_menu, zona);

-- Puntos de entrega del contrato, contra los que se mide la distancia.
--   ASLA (LZCA): fuera del puerto; clave histórica zona_vdc.
--   REFIS (LZCR): dentro del puerto; clave histórica zona_refris.
-- Las coordenadas NO se ponen a mano desde un mapa: un pin a ojo se va 20 o
-- 30 metros y ese error entra directo en la cifra que se le presenta al
-- cliente. Se capturan paradas en el sitio, con la misma tablet y la misma
-- precisión con la que después se miden las entregas.
CREATE TABLE IF NOT EXISTS puntos_entrega (
    zona           VARCHAR NOT NULL,
    punto          VARCHAR NOT NULL DEFAULT '',
    nombre         TEXT,
    direccion      TEXT,
    lat            DOUBLE PRECISION,
    lon            DOUBLE PRECISION,
    radio_m        INTEGER DEFAULT 150,
    actualizado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (zona, punto)
);

-- Envíos del menú (registro de a quién se le mandó y su estado)
CREATE TABLE IF NOT EXISTS envios (
    id             BIGSERIAL PRIMARY KEY,
    fecha_menu     DATE    NOT NULL,
    telefono       VARCHAR NOT NULL,
    nombre         TEXT,
    estado         VARCHAR NOT NULL,             -- enviado|fallido|delivered|read|...
    message_id     VARCHAR,                      -- wamid de WhatsApp
    error          TEXT,
    actualizado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unico_envio_por_dia UNIQUE (fecha_menu, telefono)
);
CREATE INDEX IF NOT EXISTS idx_envios_msgid ON envios (message_id);

-- ════════════════════════════════════════════════════════════════════
-- COBERTURAS DEL SEGUNDO TURNO
--
-- Solicitudes grupales que hacen supervisores autorizados cuando personal
-- del primer turno cubre el segundo. Se piden el MISMO día hasta las 14:45,
-- se producen entre las 15:00 y las 16:30. Desde 7/nov/2026 se entregan
-- a las 17:00 en REFIS y a las 18:00 en ASLA.
-- Viven aparte de `pedidos`: una persona puede tener su comida regular y una
-- cobertura el mismo día sin que el UNIQUE de pedidos reemplace ninguna.
-- ════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS supervisores_cobertura (
    id                BIGSERIAL PRIMARY KEY,
    empleado_telefono VARCHAR NOT NULL,
    clave_hash        TEXT    NOT NULL,
    activo            BOOLEAN NOT NULL DEFAULT true,
    vigente_desde     DATE    NOT NULL DEFAULT CURRENT_DATE,
    vigente_hasta     DATE,
    version_sesion    INTEGER NOT NULL DEFAULT 1,
    creado_en         TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    actualizado_en    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT supervisores_cobertura_empleado_unico UNIQUE (empleado_telefono),
    CONSTRAINT supervisores_cobertura_empleado_fkey
      FOREIGN KEY (empleado_telefono) REFERENCES empleados(telefono)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT supervisores_cobertura_vigencia_valida
      CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)
);

CREATE INDEX IF NOT EXISTS idx_supervisores_cobertura_activo
  ON supervisores_cobertura (activo);

-- Tres opciones de preparación rápida. La fecha es la del MISMO día de
-- entrega; no se mezcla con `menus`, que gobierna los pedidos regulares del
-- próximo día publicado.
CREATE TABLE IF NOT EXISTS menus_cobertura (
    fecha        DATE PRIMARY KEY,
    opcion_1     TEXT NOT NULL,
    opcion_2     TEXT NOT NULL,
    opcion_3     TEXT NOT NULL,
    activo       BOOLEAN NOT NULL DEFAULT true,
    creado_en    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    actualizado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS solicitudes_cobertura (
    id                          BIGSERIAL PRIMARY KEY,
    folio                       TEXT NOT NULL UNIQUE,
    fecha_servicio              DATE NOT NULL REFERENCES menus_cobertura(fecha),
    supervisor_id               BIGINT NOT NULL REFERENCES supervisores_cobertura(id) ON DELETE RESTRICT,
    supervisor_numero_snapshot  TEXT NOT NULL,
    supervisor_nombre_snapshot  TEXT NOT NULL,
    responsable_telefono        VARCHAR NOT NULL,
    responsable_numero_snapshot TEXT NOT NULL,
    responsable_nombre_snapshot TEXT NOT NULL,
    zona                        VARCHAR NOT NULL,
    turno                       VARCHAR NOT NULL DEFAULT 'turno_b',
    total_porciones             INTEGER NOT NULL DEFAULT 0,
    estado                      VARCHAR NOT NULL DEFAULT 'confirmada',
    entregado_en                TIMESTAMP WITH TIME ZONE,
    creado_en                   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    actualizado_en              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    cancelado_en                TIMESTAMP WITH TIME ZONE,
    CONSTRAINT solicitudes_cobertura_responsable_fkey
      FOREIGN KEY (responsable_telefono) REFERENCES empleados(telefono)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT solicitud_cobertura_unica_por_supervisor
      UNIQUE (fecha_servicio, supervisor_id),
    CONSTRAINT solicitudes_cobertura_zona_valida
      CHECK (zona IN ('zona_vdc','zona_refris')),
    CONSTRAINT solicitudes_cobertura_turno_b
      CHECK (turno = 'turno_b'),
    CONSTRAINT solicitudes_cobertura_estado_valido
      CHECK (estado IN ('confirmada','cancelada','entregada')),
    CONSTRAINT solicitudes_cobertura_total_valido
      CHECK (total_porciones >= 0)
);

CREATE INDEX IF NOT EXISTS idx_solicitudes_cobertura_fecha
  ON solicitudes_cobertura (fecha_servicio, zona, estado);

-- Una fila por recipiente. El QR usa `codigo_entrega`, no número+fecha:
-- el mismo empleado puede tener un pedido regular y una cobertura ese día.
CREATE TABLE IF NOT EXISTS solicitudes_cobertura_items (
    id                       BIGSERIAL PRIMARY KEY,
    solicitud_id             BIGINT NOT NULL REFERENCES solicitudes_cobertura(id) ON DELETE CASCADE,
    fecha_servicio           DATE NOT NULL,
    empleado_telefono        VARCHAR NOT NULL,
    empleado_numero_snapshot TEXT NOT NULL,
    empleado_nombre_snapshot TEXT NOT NULL,
    opcion_id                VARCHAR NOT NULL,
    opcion_texto             TEXT NOT NULL,
    codigo_entrega           UUID NOT NULL DEFAULT gen_random_uuid(),
    entregado_en             TIMESTAMP WITH TIME ZONE,
    entrega_recibido_en      TIMESTAMP WITH TIME ZONE,
    entrega_lat              DOUBLE PRECISION,
    entrega_lon              DOUBLE PRECISION,
    entrega_precision_m      REAL,
    entregado_por_id         BIGINT,
    entregado_por_nombre     TEXT,
    receptor_numero          TEXT,
    receptor_nombre          TEXT,
    receptor_discrepante     BOOLEAN NOT NULL DEFAULT false,
    receptor_verificado      BOOLEAN,
    motivo_tardia            VARCHAR,
    creado_en                TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT solicitudes_cobertura_item_empleado_fkey
      FOREIGN KEY (empleado_telefono) REFERENCES empleados(telefono)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT solicitudes_cobertura_item_repartidor_fkey
      FOREIGN KEY (entregado_por_id) REFERENCES repartidores(id) ON DELETE SET NULL,
    CONSTRAINT solicitudes_cobertura_item_unico
      UNIQUE (solicitud_id, empleado_telefono),
    CONSTRAINT solicitudes_cobertura_codigo_unico UNIQUE (codigo_entrega),
    CONSTRAINT solicitudes_cobertura_opcion_valida
      CHECK (opcion_id IN ('especial_1','especial_2','especial_3'))
);

CREATE INDEX IF NOT EXISTS idx_cobertura_items_fecha
  ON solicitudes_cobertura_items (fecha_servicio, entregado_en);

-- Guarda o reemplaza la única solicitud consolidada del supervisor para hoy.
-- La función es transaccional: si un empleado no existe, está repetido o ya
-- pertenece a otra cobertura, no queda media solicitud guardada.
CREATE OR REPLACE FUNCTION guardar_solicitud_cobertura(
  p_fecha DATE,
  p_supervisor_id BIGINT,
  p_folio TEXT,
  p_responsable_numero TEXT,
  p_zona VARCHAR,
  p_items JSONB
)
RETURNS TABLE (solicitud_id BIGINT, solicitud_folio TEXT, total INTEGER)
LANGUAGE plpgsql
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

  v_ahora := timezone('America/Mexico_City', NOW());
  IF v_ahora::DATE <> p_fecha THEN
    RAISE EXCEPTION 'fecha_cobertura_invalida';
  END IF;
  IF v_ahora::TIME >= TIME '14:45' THEN
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
     WHERE x->>'opcion_id' NOT IN ('especial_1','especial_2','especial_3')
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
   WHERE fecha_servicio = p_fecha AND supervisor_id = p_supervisor_id
   FOR UPDATE;

  SELECT string_agg(e.numero_empleado, ', ')
    INTO v_error
    FROM jsonb_array_elements(p_items) x
    JOIN empleados e ON e.numero_empleado = trim(x->>'numero_empleado')
    JOIN solicitudes_cobertura_items i
      ON i.fecha_servicio = p_fecha AND i.empleado_telefono = e.telefono
    JOIN solicitudes_cobertura s ON s.id = i.solicitud_id
   WHERE s.estado <> 'cancelada'
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
      v_responsable_nombre, p_zona, 'turno_b', 'confirmada'
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

-- Índices para acelerar consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_pedidos_fecha ON pedidos (fecha_menu);
CREATE INDEX IF NOT EXISTS idx_empleados_activo ON empleados (activo);

-- ====================================================================
-- DATOS DE PRUEBA (opcional — descomenta para insertar)
-- ====================================================================
-- INSERT INTO empleados (telefono, nombre, numero_empleado) VALUES
--   ('5215512345678', 'Empleado de Prueba', 'EMP001');
--
-- INSERT INTO menus (fecha, fija_a, fija_b, fija_c, var_1, var_2, var_3) VALUES
--   (CURRENT_DATE + 1,
--    'Pechuga a la plancha con arroz',
--    'Ensalada César con pollo',
--    'Bajo en calorías: verduras al vapor',
--    'Enchiladas verdes',
--    'Milanesa de res',
--    'Caldo de pollo');

-- Vigencia del menú especial (publicación atómica por periodo)
-- El menú sigue materializado por día para conservar las referencias de las
-- solicitudes existentes. Estas columnas identifican la publicación por periodo.
ALTER TABLE public.menus_cobertura
  ADD COLUMN IF NOT EXISTS vigencia_desde date,
  ADD COLUMN IF NOT EXISTS vigencia_hasta date,
  ADD COLUMN IF NOT EXISTS periodo_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menus_cobertura_vigencia_valida' AND conrelid = 'public.menus_cobertura'::regclass) THEN
    ALTER TABLE public.menus_cobertura ADD CONSTRAINT menus_cobertura_vigencia_valida CHECK (
      (vigencia_desde IS NULL AND vigencia_hasta IS NULL AND periodo_id IS NULL)
      OR (vigencia_desde IS NOT NULL AND vigencia_hasta IS NOT NULL AND periodo_id IS NOT NULL
          AND vigencia_hasta >= vigencia_desde AND fecha BETWEEN vigencia_desde AND vigencia_hasta)
    );
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_menus_cobertura_periodo ON public.menus_cobertura(periodo_id) WHERE periodo_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.publicar_menu_cobertura_periodo(
  p_desde date, p_hasta date, p_opcion_1 text, p_opcion_2 text, p_opcion_3 text,
  p_activo boolean DEFAULT true, p_periodo_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id uuid := coalesce(p_periodo_id, gen_random_uuid());
  v_fecha date;
  v_conflicto date;
BEGIN
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde OR p_hasta-p_desde > 365 THEN
    RAISE EXCEPTION 'vigencia_invalida';
  END IF;
  IF coalesce(trim(p_opcion_1),'')='' OR coalesce(trim(p_opcion_2),'')='' OR coalesce(trim(p_opcion_3),'')='' THEN
    RAISE EXCEPTION 'opciones_incompletas';
  END IF;
  p_opcion_1 := trim(p_opcion_1); p_opcion_2 := trim(p_opcion_2); p_opcion_3 := trim(p_opcion_3);
  IF lower(p_opcion_1)=lower(p_opcion_2) OR lower(p_opcion_1)=lower(p_opcion_3) OR lower(p_opcion_2)=lower(p_opcion_3) THEN
    RAISE EXCEPTION 'opciones_repetidas';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('menus_cobertura_periodos'));
  IF p_periodo_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.menus_cobertura WHERE periodo_id=p_periodo_id) THEN
    RAISE EXCEPTION 'periodo_no_encontrado';
  END IF;
  -- Mismo cerrojo diario que guardar_solicitud_cobertura: publicar y solicitar
  -- no pueden cambiar simultáneamente el menú que confirma un supervisor.
  FOR v_fecha IN
    SELECT dia::date FROM generate_series(p_desde::timestamp,p_hasta::timestamp,interval '1 day') dia
    UNION SELECT fecha FROM public.menus_cobertura WHERE periodo_id=v_id
    ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext('cobertura:' || v_fecha::text));
  END LOOP;

  IF EXISTS (SELECT 1 FROM public.menus_cobertura
      WHERE fecha BETWEEN p_desde AND p_hasta AND activo
        AND periodo_id IS NOT NULL AND periodo_id<>v_id) THEN
    RAISE EXCEPTION 'vigencia_solapada';
  END IF;

  SELECT m.fecha INTO v_conflicto
    FROM public.menus_cobertura m
   WHERE EXISTS (SELECT 1 FROM public.solicitudes_cobertura s
                 WHERE s.fecha_servicio=m.fecha AND s.estado<>'cancelada')
     AND (
       (m.fecha BETWEEN p_desde AND p_hasta AND
        (m.opcion_1 IS DISTINCT FROM p_opcion_1 OR m.opcion_2 IS DISTINCT FROM p_opcion_2
         OR m.opcion_3 IS DISTINCT FROM p_opcion_3 OR NOT coalesce(p_activo,true)))
       OR (m.periodo_id=v_id AND m.fecha NOT BETWEEN p_desde AND p_hasta)
     ) ORDER BY m.fecha LIMIT 1;
  IF v_conflicto IS NOT NULL THEN
    RAISE EXCEPTION 'menu_con_solicitudes:%',v_conflicto;
  END IF;

  -- Acortar una vigencia retira solo los días del mismo periodo y nunca borra
  -- referencias ni menús históricos que ya respaldan solicitudes.
  UPDATE public.menus_cobertura
     SET activo=false, periodo_id=NULL, vigencia_desde=NULL, vigencia_hasta=NULL, actualizado_en=now()
   WHERE periodo_id=v_id AND fecha NOT BETWEEN p_desde AND p_hasta;

  INSERT INTO public.menus_cobertura(fecha,opcion_1,opcion_2,opcion_3,activo,vigencia_desde,vigencia_hasta,periodo_id,actualizado_en)
  SELECT dia::date,p_opcion_1,p_opcion_2,p_opcion_3,coalesce(p_activo,true),p_desde,p_hasta,v_id,now()
    FROM generate_series(p_desde::timestamp,p_hasta::timestamp,interval '1 day') dia
  ON CONFLICT(fecha) DO UPDATE SET
    opcion_1=excluded.opcion_1,opcion_2=excluded.opcion_2,opcion_3=excluded.opcion_3,
    activo=excluded.activo,vigencia_desde=excluded.vigencia_desde,vigencia_hasta=excluded.vigencia_hasta,
    periodo_id=excluded.periodo_id,actualizado_en=excluded.actualizado_en;

  RETURN jsonb_build_object('periodo_id',v_id,'fecha_inicio',p_desde,'fecha_final',p_hasta,'dias',p_hasta-p_desde+1,
    'menu',(SELECT to_jsonb(m) FROM public.menus_cobertura m WHERE fecha=p_desde));
END;
$$;
REVOKE ALL ON FUNCTION public.publicar_menu_cobertura_periodo(date,date,text,text,text,boolean,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publicar_menu_cobertura_periodo(date,date,text,text,text,boolean,uuid) TO service_role;

-- Coberturas por turno (2026-11-07)
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


-- Pedidos extraordinarios autorizados desde el panel (7/nov/2026)
-- Alta adicional desde el panel; las funciones de supervisores conservan sus cortes.
ALTER TABLE public.solicitudes_cobertura ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solicitudes_cobertura_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solicitudes_cobertura
  ALTER COLUMN supervisor_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS origen varchar NOT NULL DEFAULT 'supervisor',
  ADD COLUMN IF NOT EXISTS autorizado_por varchar,
  ADD COLUMN IF NOT EXISTS motivo_autorizacion text,
  ADD COLUMN IF NOT EXISTS entrega_programada_en timestamptz,
  ADD COLUMN IF NOT EXISTS idempotencia uuid UNIQUE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.solicitudes_cobertura'::regclass AND conname='cobertura_origen_autorizado') THEN
  ALTER TABLE public.solicitudes_cobertura ADD CONSTRAINT cobertura_origen_autorizado CHECK (
    (origen = 'supervisor' AND supervisor_id IS NOT NULL AND autorizado_por IS NULL
      AND motivo_autorizacion IS NULL AND entrega_programada_en IS NULL AND idempotencia IS NULL)
    OR
    (origen = 'extraordinaria' AND supervisor_id IS NULL AND autorizado_por IS NOT NULL
      AND autorizado_por IN ('admin','gerente') AND motivo_autorizacion IS NOT NULL
      AND length(trim(motivo_autorizacion)) BETWEEN 5 AND 500
      AND entrega_programada_en IS NOT NULL AND idempotencia IS NOT NULL)
  );
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.autorizar_cobertura_extraordinaria(
  p_fecha date, p_turno varchar, p_zona varchar, p_folio text,
  p_responsable_numero text, p_items jsonb, p_autorizado_por varchar,
  p_motivo text, p_entrega_programada_en timestamptz, p_idempotencia uuid
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
REVOKE ALL ON FUNCTION public.autorizar_cobertura_extraordinaria(date,varchar,varchar,text,text,jsonb,varchar,text,timestamptz,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.autorizar_cobertura_extraordinaria(date,varchar,varchar,text,text,jsonb,varchar,text,timestamptz,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
