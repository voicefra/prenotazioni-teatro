-- Modalità prenotazione per spettacolo: posti numerati (mappa) oppure posto unico (solo quantità, capienza = file × posti_per_fila).

ALTER TABLE public.spettacoli
  ADD COLUMN IF NOT EXISTS modalita_prenotazione text NOT NULL DEFAULT 'posti_assegnati';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'spettacoli'
      AND c.conname = 'spettacoli_modalita_prenotazione_check'
  ) THEN
    ALTER TABLE public.spettacoli
      ADD CONSTRAINT spettacoli_modalita_prenotazione_check
      CHECK (modalita_prenotazione IN ('posti_assegnati', 'posto_unico'));
  END IF;
END $$;

COMMENT ON COLUMN public.spettacoli.modalita_prenotazione IS
  'posti_assegnati: griglia posti e mappa; posto_unico: prenotazione per quantità senza mappa (capienza da teatro).';

CREATE OR REPLACE FUNCTION public.genera_griglia_posti_per_replica()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_teatro_id uuid;
  v_modalita text;
  v_num_file integer;
  v_posti_fila integer;
  v_fila integer;
  v_posto integer;
  v_lettera text;
  v_codice text;
BEGIN
  SELECT s.teatro_id, COALESCE(s.modalita_prenotazione, 'posti_assegnati')
  INTO v_teatro_id, v_modalita
  FROM public.spettacoli s
  WHERE s.id = NEW.spettacolo_id;

  IF v_modalita = 'posto_unico' THEN
    RETURN NEW;
  END IF;

  IF v_teatro_id IS NULL THEN
    RAISE WARNING 'genera_griglia_posti_per_replica: spettacolo % senza teatro_id, skip', NEW.spettacolo_id;
    RETURN NEW;
  END IF;

  SELECT t.numero_file, t.posti_per_fila
  INTO v_num_file, v_posti_fila
  FROM public.teatri t
  WHERE t.id = v_teatro_id;

  IF v_num_file IS NULL OR v_posti_fila IS NULL THEN
    RAISE EXCEPTION 'Teatro % non trovato o dimensioni invalide', v_teatro_id;
  END IF;

  IF EXISTS (SELECT 1 FROM public.posti p WHERE p.replica_id = NEW.id LIMIT 1) THEN
    RETURN NEW;
  END IF;

  FOR v_fila IN 1..v_num_file LOOP
    v_lettera := chr(64 + v_fila);
    FOR v_posto IN 1..v_posti_fila LOOP
      v_codice := v_lettera || v_posto::text;
      INSERT INTO public.posti (spettacolo_id, replica_id, numero_posto, stato)
      VALUES (NEW.spettacolo_id, NEW.id, v_codice, 'libero');
    END LOOP;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.genera_griglia_posti_per_spettacolo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_modalita text;
  v_num_file integer;
  v_posti_fila integer;
  v_fila integer;
  v_posto integer;
  v_lettera text;
  v_codice text;
BEGIN
  v_modalita := COALESCE(NEW.modalita_prenotazione, 'posti_assegnati');
  IF v_modalita = 'posto_unico' THEN
    RETURN NEW;
  END IF;

  IF NEW.teatro_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT t.numero_file, t.posti_per_fila
  INTO v_num_file, v_posti_fila
  FROM public.teatri t
  WHERE t.id = NEW.teatro_id;

  IF v_num_file IS NULL OR v_posti_fila IS NULL THEN
    RAISE WARNING 'genera_griglia_posti_per_spettacolo: teatro % non trovato', NEW.teatro_id;
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.posti p
    WHERE p.spettacolo_id = NEW.id AND p.replica_id IS NULL
    LIMIT 1
  ) THEN
    RETURN NEW;
  END IF;

  FOR v_fila IN 1..v_num_file LOOP
    v_lettera := chr(64 + v_fila);
    FOR v_posto IN 1..v_posti_fila LOOP
      v_codice := v_lettera || v_posto::text;
      INSERT INTO public.posti (spettacolo_id, replica_id, numero_posto, stato)
      VALUES (NEW.id, NULL, v_codice, 'libero');
    END LOOP;
  END LOOP;

  RETURN NEW;
END;
$$;
