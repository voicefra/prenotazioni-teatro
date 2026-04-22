-- Prezzi per spettacolo (EUR). Usati da app/admin e da /api/checkout.
ALTER TABLE public.spettacoli
  ADD COLUMN IF NOT EXISTS prezzo_biglietto numeric(10, 2) NOT NULL DEFAULT 15.00,
  ADD COLUMN IF NOT EXISTS diritti_prevendita numeric(10, 2) NOT NULL DEFAULT 2.00;

COMMENT ON COLUMN public.spettacoli.prezzo_biglietto IS 'Prezzo biglietto in EUR (per posto)';
COMMENT ON COLUMN public.spettacoli.diritti_prevendita IS 'Diritti di prevendita in EUR (per posto; in checkout moltiplicati per il numero di posti)';
