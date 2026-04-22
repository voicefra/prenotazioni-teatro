-- =============================================================================
-- COPIA TUTTO QUESTO FILE nel SQL Editor di Supabase (Dashboard → SQL → New query)
-- e premi RUN. È idempotente dove possibile (IF NOT EXISTS, ADD COLUMN IF NOT EXISTS).
--
-- Nomi verificati dal codice dell’app (Teatro_app):
--   spettacoli: nome_spettacolo, locandina_url, id
--   repliche: id, spettacolo_id (FK verso spettacoli)
--   posti: id, numero_posto, spettacolo_id, replica_id, stato
--   prenotazioni: replica_id, ...
-- Nuovi nomi introdotti qui (come da richiesta precedente):
--   teatri: id, nome_teatro, numero_file, posti_per_fila
--   spettacoli.teatro_id → teatri(id)
-- =============================================================================

-- 0) Verifica che le tabelle base esistano
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'spettacoli'
  ) THEN
    RAISE EXCEPTION 'Manca la tabella public.spettacoli. Creala prima o ripristina il backup.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'repliche'
  ) THEN
    RAISE EXCEPTION 'Manca la tabella public.repliche.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'posti'
  ) THEN
    RAISE EXCEPTION 'Manca la tabella public.posti.';
  END IF;
END $$;

-- 1) Colonna stato su posti se manca (valori usati nell’app: libero / occupato / bloccato)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'posti' AND column_name = 'stato'
  ) THEN
    ALTER TABLE public.posti ADD COLUMN stato text NOT NULL DEFAULT 'libero';
  END IF;
END $$;

-- 2) Tabella teatri (se non esiste)
CREATE TABLE IF NOT EXISTS public.teatri (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_teatro text NOT NULL,
  numero_file integer NOT NULL CHECK (numero_file > 0 AND numero_file <= 26),
  posti_per_fila integer NOT NULL CHECK (posti_per_fila > 0)
);

COMMENT ON TABLE public.teatri IS 'Sala: file A..Z (max 26), posti_per_fila = posti numerati per fila';

-- 3) Colonna teatro_id su spettacoli (FK verso teatri)
ALTER TABLE public.spettacoli
  ADD COLUMN IF NOT EXISTS teatro_id uuid REFERENCES public.teatri (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS spettacoli_teatro_id_idx ON public.spettacoli (teatro_id);

-- 4) Funzione + trigger: griglia posti dopo INSERT su repliche
CREATE OR REPLACE FUNCTION public.genera_griglia_posti_per_replica()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_teatro_id uuid;
  v_num_file integer;
  v_posti_fila integer;
  v_fila integer;
  v_posto integer;
  v_lettera text;
  v_codice text;
BEGIN
  SELECT s.teatro_id INTO v_teatro_id
  FROM public.spettacoli s
  WHERE s.id = NEW.spettacolo_id;

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

DROP TRIGGER IF EXISTS tr_genera_posti_dopo_replica ON public.repliche;
CREATE TRIGGER tr_genera_posti_dopo_replica
  AFTER INSERT ON public.repliche
  FOR EACH ROW
  EXECUTE FUNCTION public.genera_griglia_posti_per_replica();

-- 5) Opzionale: griglia a livello spettacolo (replica_id NULL)
CREATE OR REPLACE FUNCTION public.genera_griglia_posti_per_spettacolo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_num_file integer;
  v_posti_fila integer;
  v_fila integer;
  v_posto integer;
  v_lettera text;
  v_codice text;
BEGIN
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

DROP TRIGGER IF EXISTS tr_genera_posti_dopo_spettacolo ON public.spettacoli;
CREATE TRIGGER tr_genera_posti_dopo_spettacolo
  AFTER INSERT ON public.spettacoli
  FOR EACH ROW
  EXECUTE FUNCTION public.genera_griglia_posti_per_spettacolo();

-- 6) Verifica finale (nessun dato sensibile)
SELECT 'teatri' AS tabella, count(*)::text AS righe FROM public.teatri
UNION ALL
SELECT 'spettacoli con teatro_id', count(*)::text FROM public.spettacoli WHERE teatro_id IS NOT NULL;
