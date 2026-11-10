SET LOCAL lock_timeout = '3s';

-- Sin default ni backfill: no se conoce el método de los registros antiguos.
ALTER TABLE public.pedidos
  ADD COLUMN metodo_entrega text,
  ADD CONSTRAINT pedidos_metodo_entrega_valido
    CHECK (metodo_entrega IN ('camara', 'lector', 'manual'));

ALTER TABLE public.solicitudes_cobertura_items
  ADD COLUMN metodo_entrega text,
  ADD CONSTRAINT cobertura_items_metodo_entrega_valido
    CHECK (metodo_entrega IN ('camara', 'lector', 'manual'));
