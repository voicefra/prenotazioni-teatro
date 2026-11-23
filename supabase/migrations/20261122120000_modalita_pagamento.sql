-- Pagamento online oppure sola prenotazione (posto bloccato 48 ore fino a conferma admin).

ALTER TABLE public.spettacoli
  ADD COLUMN IF NOT EXISTS modalita_pagamento text NOT NULL DEFAULT 'pagamento_online';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'spettacoli'
      AND c.conname = 'spettacoli_modalita_pagamento_check'
  ) THEN
    ALTER TABLE public.spettacoli
      ADD CONSTRAINT spettacoli_modalita_pagamento_check
      CHECK (modalita_pagamento IN ('pagamento_online', 'solo_prenotazione'));
  END IF;
END $$;

COMMENT ON COLUMN public.spettacoli.modalita_pagamento IS
  'pagamento_online: Stripe. solo_prenotazione: niente pagamento; stato riservato per 48 ore, poi confermato dall''admin oppure il posto torna libero.';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'prenotazioni'
      AND column_name = 'stripe_session_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.prenotazioni ALTER COLUMN stripe_session_id DROP NOT NULL;
  END IF;
END $$;

-- Nuovi stati prenotazione: 'riservato' (senza pagamento, 48 ore) e 'confermato' (confermata dall'admin).
-- Se stato_pagamento ha un vincolo CHECK creato a mano, lo sostituisce includendo i nuovi stati.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'prenotazioni'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%stato_pagamento%'
  LOOP
    EXECUTE format('ALTER TABLE public.prenotazioni DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- Se stato_pagamento fosse un tipo ENUM, aggiunge i nuovi valori.
DO $$
DECLARE
  enum_type text;
BEGIN
  SELECT c.udt_name INTO enum_type
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'prenotazioni'
    AND c.column_name = 'stato_pagamento'
    AND c.data_type = 'USER-DEFINED';
  IF enum_type IS NOT NULL THEN
    EXECUTE format('ALTER TYPE public.%I ADD VALUE IF NOT EXISTS %L', enum_type, 'riservato');
    EXECUTE format('ALTER TYPE public.%I ADD VALUE IF NOT EXISTS %L', enum_type, 'confermato');
  END IF;
END $$;
