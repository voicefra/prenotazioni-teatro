-- Unifica reset globale (TRUNCATE) e reset selettivo (DELETE con filtro spettacolo/replica).
-- Sostituisce admin_reset_selected_tables.

DROP FUNCTION IF EXISTS public.admin_reset_selected_tables(text[]);

CREATE OR REPLACE FUNCTION public.admin_reset(
  p_tables text[],
  p_filter jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allowed constant text[] := ARRAY['prenotazioni', 'posti', 'repliche', 'spettacoli', 'teatri'];
  ord constant text[] := ARRAY['prenotazioni', 'posti', 'repliche', 'spettacoli', 'teatri'];
  t text;
  inp text;
  truncated text[] := ARRAY[]::text[];
  deleted text[] := ARRAY[]::text[];
  v_spett uuid;
  v_rep uuid;
BEGIN
  IF p_tables IS NULL OR array_length(p_tables, 1) IS NULL THEN
    RAISE EXCEPTION 'Nessuna tabella specificata';
  END IF;

  FOREACH inp IN ARRAY p_tables
  LOOP
    IF NOT (inp = ANY(allowed)) THEN
      RAISE EXCEPTION 'Tabella non consentita: %', inp;
    END IF;
  END LOOP;

  -- Modalità globale: TRUNCATE
  IF p_filter IS NULL THEN
    FOREACH t IN ARRAY ord
    LOOP
      IF t = ANY(p_tables) THEN
        EXECUTE format('TRUNCATE TABLE public.%I RESTART IDENTITY CASCADE', t);
        truncated := array_append(truncated, t);
      END IF;
    END LOOP;
    RETURN jsonb_build_object('mode', 'global', 'truncated', to_jsonb(truncated));
  END IF;

  -- Modalità selettiva: DELETE (mai TRUNCATE)
  IF p_filter->>'spettacolo_id' IS NULL OR p_filter->>'replica_id' IS NULL THEN
    RAISE EXCEPTION 'Reset selettivo: servono spettacolo_id e replica_id nel filtro JSON';
  END IF;

  v_spett := (p_filter->>'spettacolo_id')::uuid;
  v_rep := (p_filter->>'replica_id')::uuid;

  IF NOT EXISTS (
    SELECT 1 FROM public.repliche r
    WHERE r.id = v_rep AND r.spettacolo_id = v_spett
  ) THEN
    RAISE EXCEPTION 'Replica non valida per lo spettacolo indicato';
  END IF;

  -- Eliminare l''intero spettacolo: un solo DELETE (cascade verso repliche/posti/prenotazioni se definito nello schema)
  IF 'spettacoli' = ANY(p_tables) THEN
    DELETE FROM public.spettacoli WHERE id = v_spett;
    deleted := array_append(deleted, 'spettacoli');
  ELSE
    FOREACH t IN ARRAY ord
    LOOP
      IF NOT (t = ANY(p_tables)) THEN
        CONTINUE;
      END IF;

      IF t = 'teatri' THEN
        RAISE EXCEPTION 'La tabella teatri non è supportata nel reset selettivo (nessun filtro per replica). Rimuovila dall''elenco.';
      END IF;

      IF t = 'spettacoli' THEN
        CONTINUE;
      END IF;

      IF t = 'prenotazioni' THEN
        DELETE FROM public.prenotazioni WHERE replica_id = v_rep;
      ELSIF t = 'posti' THEN
        DELETE FROM public.posti WHERE replica_id = v_rep;
      ELSIF t = 'repliche' THEN
        DELETE FROM public.repliche WHERE id = v_rep AND spettacolo_id = v_spett;
      END IF;

      deleted := array_append(deleted, t);
    END LOOP;
  END IF;

  RETURN jsonb_build_object('mode', 'selective', 'deleted', to_jsonb(deleted), 'filter', p_filter);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reset(text[], jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reset(text[], jsonb) TO service_role;

COMMENT ON FUNCTION public.admin_reset(text[], jsonb) IS 'Reset DB: TRUNCATE se p_filter NULL; altrimenti DELETE per spettacolo/replica. Solo service_role.';
