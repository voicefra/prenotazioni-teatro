-- Ticket delivery metadata for post-payment email sending.
-- Safe/idempotent: adds columns only if missing.

ALTER TABLE public.prenotazioni
  ADD COLUMN IF NOT EXISTS tickets_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS tickets_email_message_id text;

CREATE INDEX IF NOT EXISTS prenotazioni_stripe_session_id_idx
  ON public.prenotazioni (stripe_session_id);

