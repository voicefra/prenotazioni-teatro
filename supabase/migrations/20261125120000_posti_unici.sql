-- Impedisce che lo stesso posto della stessa replica abbia due prenotazioni attive
-- (es. doppio tocco sul pulsante da smartphone: due richieste nello stesso istante).
-- Attive = pending, paid, riservato, confermato. Una riga di prenotazioni per ogni posto.
--
-- 1) Elimina i doppioni già presenti, tenendo la prenotazione più vecchia per ogni posto.
-- 2) Crea un indice UNIQUE parziale: da qui in poi il database rifiuta il secondo inserimento.

DO $$
DECLARE
  col_type text;
  seat_expr text;
BEGIN
  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'prenotazioni' AND column_name = 'posti_prenotati';

  IF col_type = 'ARRAY' THEN
    seat_expr := 'upper(trim(posti_prenotati[1]))';
  ELSIF col_type IN ('jsonb', 'json') THEN
    seat_expr := 'upper(trim(posti_prenotati->>0))';
  ELSE
    seat_expr := 'upper(trim(posti_prenotati::text))';
  END IF;

  EXECUTE format($q$
    DELETE FROM public.prenotazioni p
    USING (
      SELECT id,
             row_number() OVER (
               PARTITION BY replica_id, %1$s
               ORDER BY created_at ASC, id ASC
             ) AS rn
      FROM public.prenotazioni
      WHERE stato_pagamento IN ('pending', 'paid', 'riservato', 'confermato')
    ) d
    WHERE p.id = d.id AND d.rn > 1
  $q$, seat_expr);

  EXECUTE format($q$
    CREATE UNIQUE INDEX IF NOT EXISTS prenotazioni_posto_attivo_unico
    ON public.prenotazioni (replica_id, (%1$s))
    WHERE stato_pagamento IN ('pending', 'paid', 'riservato', 'confermato')
  $q$, seat_expr);
END $$;
