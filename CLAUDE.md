# Prenotazioni Teatro

Web app per la prenotazione online di spettacoli teatrali. Interfaccia e testi in **italiano**.
Il titolare non è uno sviluppatore: le spiegazioni all'utente vanno date in italiano, in modo semplice.

## Stack
- **Next.js 16** (App Router, Turbopack), React 19, TypeScript, Tailwind 4, componenti shadcn/ui (`components/ui`)
- **Supabase** (Postgres) per il database: client in `lib/supabase.ts` (anon key, lato browser);
  le route API e le server action usano `SUPABASE_SERVICE_ROLE_KEY`
- **Stripe** Checkout per i pagamenti online (`app/api/checkout`, `app/api/webhook`)
- **Resend** per le email; PDF dei biglietti con `@react-pdf/renderer` (`lib/tickets/ticket-pdf.tsx`)
- **Vercel** per l'hosting: ogni push su `main` va in produzione automaticamente
- Repository GitHub: `voicefra/prenotazioni-teatro`

## Comandi
- `npm run dev`: server locale (http://localhost:3000)
- `npm run build`: build di produzione. Va eseguito prima di ogni push
- `npx tsc --noEmit -p .`: controllo tipi. `next.config.mjs` ha `ignoreBuildErrors: true`, quindi il build
  non segnala errori TypeScript. Ci sono 2 errori preesistenti in `app/spettacoli/page.tsx`: non aggiungerne altri

## Struttura
- `app/spettacoli`: elenco spettacoli e repliche
- `app/page.tsx` + `components/theater/theater-booking.tsx`: mappa posti, carrello, checkout o prenotazione
- `app/admin`: pannello admin (protetto da Basic Auth in `middleware.ts`, utente `admin`, password `ADMIN_PASSWORD`)
- `app/scan`: verifica QR all'ingresso (`lib/tickets/process-scan.ts`). Riservata agli operatori: password
  `SCAN_PASSWORD` (se manca, `ADMIN_PASSWORD`), ricordata per 30 giorni con cookie (`lib/tickets/scan-auth.ts`).
  Un biglietto vale per un solo ingresso: dalla seconda scansione mostra "Biglietto già scansionato".
  La scansione non conferma le prenotazioni: la conferma la fa l'operatore in admin dopo il pagamento SIAE
- L'indirizzo nel QR viene da `NEXT_PUBLIC_TICKET_SCAN_ORIGIN` (impostata su Vercel, tipo Config)
- `app/api/prenota`: prenotazione senza pagamento online
- `app/api/cleanup`: elimina prenotazioni `pending` e `riservato` scadute
- `lib/booking/prenotazioni-utils.ts`: regole di disponibilità dei posti (unica fonte di verità)
- `lib/tickets/deliver-booking-receipt.ts`: email di ricevuta con PDF e QR

## Regole di dominio
- `spettacoli.modalita_prenotazione`: `posti_assegnati` (mappa posti) | `posto_unico` (solo quantità)
- `spettacoli.modalita_pagamento`: `pagamento_online` (Stripe) | `solo_prenotazione`
- `prenotazioni.stato_pagamento`:
  - `pending`: checkout Stripe avviato, occupa il posto per 7 minuti
  - `paid`: pagato con Stripe
  - `riservato`: prenotazione senza pagamento, occupa il posto per 48 ore. Il cliente deve ritirare e pagare
    il biglietto fiscale SIAE presso l'organizzazione entro 48 ore, poi l'admin conferma
  - `confermato`: confermato dall'admin, occupa il posto in modo definitivo
- Il portale non emette titoli fiscali: il biglietto SIAE viene emesso dall'organizzazione (testi in `lib/fiscal-disclaimer.ts`: versione per pagamento online e per "solo prenotazione")
- Una riga di `prenotazioni` per ogni posto

## Database e migrazioni
- Le migrazioni stanno in `supabase/migrations/`, ma **non** vengono applicate con la Supabase CLI:
  l'utente le esegue a mano nel SQL Editor della dashboard Supabase
- Il server MCP `supabase` (`.mcp.json`) è in **sola lettura** (`read_only=true`): serve per leggere schema e dati,
  non per modificarli. Non togliere `read_only` senza richiesta esplicita dell'utente
- Le migrazioni devono essere idempotenti (`IF NOT EXISTS`, blocchi `DO $$`)
- **Ordine obbligatorio:** se il codice legge una colonna nuova, la migrazione va applicata su Supabase
  **prima** del push su `main`, altrimenti la produzione si rompe

## Modo di lavorare
- Prima del push: `npm run build` deve passare
- Dopo un build, non committare `next-env.d.ts` e `tsconfig.tsbuildinfo` (si rigenerano)
- Messaggi di commit in italiano, stile `feat: ...` / `fix: ...`
- Non stampare mai i valori di `.env.local` (chiavi Stripe, Supabase, Resend, password admin)
