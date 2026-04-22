-- Tracciamento ingressi da QR (ticket_id = public.prenotazioni.id)

CREATE TABLE IF NOT EXISTS public.scansioni (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.prenotazioni (id) ON DELETE CASCADE,
  orario_scansione timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scansioni_ticket_id_idx ON public.scansioni (ticket_id);
CREATE INDEX IF NOT EXISTS scansioni_orario_idx ON public.scansioni (orario_scansione DESC);

COMMENT ON TABLE public.scansioni IS 'Scansioni QR in ingresso; ticket_id = id prenotazione.';
