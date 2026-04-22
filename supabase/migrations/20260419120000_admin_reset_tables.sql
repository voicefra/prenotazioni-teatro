-- Funzione solo per reset da backend (service_role). Ordine: dipendenze prima.
CREATE OR REPLACE FUNCTION public.admin_reset_selected_tables(p_tables text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allowed constant text[] := ARRAY['prenotazioni', 'posti', 'repliche', 'spettacoli', 'teatri'];
  ord constant text[] := ARRAY['prenotazioni', 'posti', 'repliche', 'spettacoli', 'teatri'];
  t text;
  truncated text[] := ARRAY[]::text[];
  inp text;
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

  FOREACH t IN ARRAY ord
  LOOP
    IF t = ANY(p_tables) THEN
      EXECUTE format('TRUNCATE TABLE public.%I RESTART IDENTITY CASCADE', t);
      truncated := array_append(truncated, t);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'truncated', to_jsonb(truncated));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reset_selected_tables(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reset_selected_tables(text[]) TO service_role;

COMMENT ON FUNCTION public.admin_reset_selected_tables(text[]) IS 'Reset TRUNCATE solo da backend (chiave service_role).';
