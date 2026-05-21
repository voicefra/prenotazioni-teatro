import type Stripe from "stripe"
import type { SupabaseClient } from "@supabase/supabase-js"
import { Resend } from "resend"
import { renderTicketsPdf, type TicketSeat } from "@/lib/tickets/ticket-pdf"
import { buildTicketScanUrl } from "@/lib/tickets/scan-url"
import { formatTimeHHmm } from "@/lib/datetime-format"
import { normalizeBookedSeats } from "@/lib/booking/prenotazioni-utils"

export type DeliverBookingReceiptResult =
  | { ok: true; alreadySent?: boolean; ticketIds: string[]; messageId?: string | null; warning?: string }
  | { ok: false; error: string; code: string }

function parseSeatCode(code: string): TicketSeat | null {
  const trimmed = code.trim()
  const upper = trimmed.toUpperCase()
  if (upper.startsWith("UNICO")) {
    const suffix = trimmed.replace(/^unico[-_]?/i, "").trim() || trimmed
    return { fila: "Posto unico", posto: suffix.slice(0, 24) }
  }
  const m = trimmed.match(/^([A-Za-z]+)[-\s]?(\d+)$/)
  if (!m) return null
  return { fila: m[1].toUpperCase(), posto: m[2] }
}

function formatDataEventoItDateOnly(raw: unknown): string {
  const s = String(raw ?? "").trim()
  if (!s) return ""
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  const formatted = d.toLocaleDateString("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })
  if (!formatted) return s
  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
}

type BookingSeatRow = {
  id: string | number
  tickets_sent_at?: string | null
  posti_prenotati?: string[] | string | null
  nome?: string | null
  cognome?: string | null
  email?: string | null
  telefono?: string | null
  replica_id?: string | null
}

type SpettacoloRow = {
  nome_spettacolo?: string | null
  ente_organizzatore?: string | null
  teatro_id?: string | number | null
  prezzo_biglietto?: number | null
  diritti_prevendita?: number | null
}

type TeatroRow = {
  nome_teatro?: string | null
  indirizzo?: string | null
  comune?: string | null
  telefono?: string | null
}

const FISCAL_DISCLAIMER =
  "Si tiene a precisare che il suddetto portale web che viene utilizzato non opera come Sistema di Biglietteria Automatizzata ai sensi del Provvedimento Agenzia Entrate del 23/07/2001, in quanto non emette alcun Titolo di Accesso fiscale. Il portale è un mero strumento di e-commerce per la prenotazione e il pagamento anticipato. L'assolvimento degli obblighi fiscali e del diritto d'autore per l'accesso allo spettacolo avverrà tramite l'emissione di regolari Titoli di Accesso fiscali premarcati SIAE, che avverrà direttamente in biglietteria, il giorno dello spettacolo, presentando al personale addetto, il voucher di prenotazione che verrà inviato sulla mail. Gli incassi verranno quindi regolarmente rendicontati tramite Modello C1."

function formatSenderFromAddress(rawFrom: string): string {
  const trimmed = rawFrom.trim()
  const m = trimmed.match(/<([^>]+)>/)
  const emailAddress = (m?.[1] ?? trimmed).trim()
  return `Prenotazioni Teatro <${emailAddress}>`
}

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

/**
 * Genera PDF + invia email per righe `prenotazioni` già `paid` con lo stesso `stripe_session_id`.
 */
export async function deliverBookingReceiptForStripeSession(
  stripe: Stripe,
  supabase: SupabaseClient,
  sessionId: string,
  options: { requireStripePaidCheck: boolean },
): Promise<DeliverBookingReceiptResult> {
  const resendKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM
  if (!resendKey || !from) {
    return { ok: false, error: "Configurazione email mancante: RESEND_API_KEY e RESEND_FROM.", code: "MISSING_RESEND" }
  }

  let sessionForTotals: Stripe.Checkout.Session | null = null

  if (options.requireStripePaidCheck) {
    try {
      sessionForTotals = await stripe.checkout.sessions.retrieve(sessionId)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Errore Stripe"
      return { ok: false, error: `Impossibile verificare il pagamento: ${msg}`, code: "STRIPE_RETRIEVE" }
    }
    if (sessionForTotals.status !== "complete" || sessionForTotals.payment_status !== "paid") {
      return { ok: false, error: "Pagamento non confermato su Stripe.", code: "STRIPE_NOT_PAID" }
    }
  } else {
    sessionForTotals = await stripe.checkout.sessions.retrieve(sessionId).catch(() => null)
  }

  const { data: paidRows, error: bookErr } = await supabase
    .from("prenotazioni")
    .select("id, tickets_sent_at, posti_prenotati, nome, cognome, email, telefono, replica_id")
    .eq("stripe_session_id", sessionId)
    .eq("stato_pagamento", "paid")
    .order("created_at", { ascending: true })

  if (bookErr) {
    return { ok: false, error: bookErr.message, code: "BOOKING_LOOKUP" }
  }

  const rows = (paidRows ?? []) as BookingSeatRow[]
  if (rows.length === 0) {
    return { ok: false, error: "Nessuna prenotazione pagata per questa sessione Stripe.", code: "BOOKING_MISSING" }
  }

  const first = rows[0]
  const replicaId = String(first.replica_id ?? "").trim()
  const nome = String(first.nome ?? "").trim()
  const cognome = String(first.cognome ?? "").trim()
  const email = String(first.email ?? "").trim()

  if (!replicaId || !email || !nome || !cognome) {
    return { ok: false, error: "Dati prenotazione incompleti (replica o anagrafica).", code: "BAD_BOOKING_ROW" }
  }

  const orderDate = sessionForTotals?.created
    ? new Date(sessionForTotals.created * 1000).toLocaleString("it-IT", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : new Date().toLocaleString("it-IT", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
  const orderId = String(sessionForTotals?.id ?? sessionId)
  const totalEur = sessionForTotals?.amount_total != null ? Number(sessionForTotals.amount_total) / 100 : 0

  const { data: repRow, error: repErr } = await supabase
    .from("repliche")
    .select("id, spettacolo_id, data_evento, orario")
    .eq("id", replicaId)
    .maybeSingle()

  if (repErr || !repRow) {
    return { ok: false, error: repErr?.message ?? "Replica non trovata.", code: "REPLICA_NOT_FOUND" }
  }

  const { data: spettacoloData, error: spettacoloErr } = await supabase
    .from("spettacoli")
    .select("nome_spettacolo, ente_organizzatore, teatro_id, prezzo_biglietto, diritti_prevendita")
    .eq("id", String(repRow.spettacolo_id ?? ""))
    .maybeSingle()

  if (spettacoloErr) {
    return { ok: false, error: spettacoloErr.message, code: "SHOW_LOOKUP" }
  }

  const spettacoloRow = (spettacoloData ?? null) as SpettacoloRow | null
  const spettacoloNome = String(spettacoloRow?.nome_spettacolo ?? "Spettacolo")
  const enteOrganizzatore = String(spettacoloRow?.ente_organizzatore ?? "").trim() || "Dati non disponibili"
  const prezzoPrenotazione = Number(spettacoloRow?.prezzo_biglietto ?? 0)
  const dirittiPrenotazione = Number(spettacoloRow?.diritti_prevendita ?? 0)

  let teatroInfo: TeatroRow | null = null
  const teatroId = String(spettacoloRow?.teatro_id ?? "").trim()
  if (teatroId) {
    const { data: teatroData, error: teatroErr } = await supabase
      .from("teatri")
      .select("nome_teatro, indirizzo, comune, telefono")
      .eq("id", teatroId)
      .maybeSingle()
    if (teatroErr) {
      return { ok: false, error: teatroErr.message, code: "THEATER_LOOKUP" }
    }
    teatroInfo = (teatroData ?? null) as TeatroRow | null
  }

  const dataLabel = formatDataEventoItDateOnly(repRow.data_evento)
  const orarioLabel = formatTimeHHmm(repRow.orario ?? repRow.data_evento) || ""

  const bookingsBySeat = new Map<string, { id: string; ticketsSentAt: string | null; seat: string }>()
  for (const row of rows) {
    const codes = normalizeBookedSeats(row.posti_prenotati)
    const seat = String(codes[0] ?? "").trim().toUpperCase()
    if (!seat) continue
    bookingsBySeat.set(seat, {
      id: String(row.id),
      ticketsSentAt: row.tickets_sent_at ?? null,
      seat,
    })
  }

  const uniqueRequestedSeats = [...bookingsBySeat.keys()]
  if (uniqueRequestedSeats.length === 0) {
    return { ok: false, error: "Nessun posto valido per generare le ricevute di prenotazione.", code: "BAD_SEATS" }
  }

  const bookedSeats = uniqueRequestedSeats.map((seat) => {
    const booking = bookingsBySeat.get(seat)!
    return {
      seat,
      bookingId: booking.id,
      alreadySent: Boolean(booking.ticketsSentAt),
    }
  })

  if (bookedSeats.every((item) => item.alreadySent)) {
    return { ok: true, alreadySent: true, ticketIds: bookedSeats.map((item) => item.bookingId) }
  }

  const attachments: { filename: string; content: string }[] = []
  const sentBookingIds: string[] = []
  for (const item of bookedSeats) {
    if (item.alreadySent) continue
    const seatObj = parseSeatCode(item.seat)
    if (!seatObj) continue

    const ticketScanUrl = buildTicketScanUrl(item.bookingId)
    const safeFileSlug = `${seatObj.fila}-${seatObj.posto}`.replace(/[^a-zA-Z0-9-_]+/g, "-").slice(0, 80)
    try {
      const pdfBuffer = await renderTicketsPdf({
        spettacolo: spettacoloNome,
        enteOrganizzatore,
        teatroNome: String(teatroInfo?.nome_teatro ?? "").trim() || "Dati non disponibili",
        teatroIndirizzo: String(teatroInfo?.indirizzo ?? "").trim() || "Dati non disponibili",
        teatroComune: String(teatroInfo?.comune ?? "").trim() || "Dati non disponibili",
        teatroTelefono: String(teatroInfo?.telefono ?? "").trim() || "Dati non disponibili",
        data: dataLabel || String(repRow.data_evento ?? ""),
        orario: orarioLabel || "—",
        seats: [seatObj],
        prezzoBiglietto: prezzoPrenotazione,
        dirittiPrevendita: dirittiPrenotazione,
        ticketScanUrl,
      } as never)
      attachments.push({
        filename: `ricevuta-prenotazione-${safeFileSlug}.pdf`,
        content: pdfBuffer.toString("base64"),
      })
      sentBookingIds.push(item.bookingId)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Errore generazione PDF"
      console.error("[deliver-booking-receipt] PDF render:", e)
      return { ok: false, error: `Generazione PDF non riuscita: ${msg}`, code: "PDF_RENDER" }
    }
  }

  if (attachments.length === 0) {
    return { ok: true, alreadySent: true, ticketIds: bookedSeats.map((item) => item.bookingId) }
  }

  const resend = new Resend(resendKey)
  const senderFrom = formatSenderFromAddress(from)
  const seatRowsHtml = uniqueRequestedSeats
    .map((seatCode) => {
      const parsed = parseSeatCode(seatCode)
      const fila = parsed?.fila ?? "—"
      return `
          <tr>
            <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(seatCode)}</td>
            <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(fila)}</td>
            <td style="padding:8px;border-bottom:1px solid #e5e7eb;">€ ${prezzoPrenotazione.toFixed(2)}</td>
          </tr>
        `
    })
    .join("")
  const dirittiPrenotazioneTot = dirittiPrenotazione * uniqueRequestedSeats.length

  const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#111827;background:#f9fafb;padding:24px;">
        <div style="max-width:760px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;">
          <h2 style="margin:0 0 10px 0;font-size:24px;color:#0f172a;">Conferma ordine e ricevuta di prenotazione</h2>
          <p style="margin:0 0 14px 0;">Gentile <strong>${escapeHtml(nome)} ${escapeHtml(cognome)}</strong>,</p>
          <p style="margin:0 0 18px 0;">Grazie per la tua prenotazione. In allegato trovi la ricevuta di prenotazione PDF con QR code individuale.</p>

          <div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px;background:#f8fafc;margin-bottom:14px;">
            <div style="font-size:18px;font-weight:700;margin-bottom:8px;">Spettacolo: <span style="color:#0b63f6;">${escapeHtml(spettacoloNome)}</span></div>
            <div><strong style="font-size:15px;">ID Ordine:</strong> <strong style="font-size:16px;">${escapeHtml(orderId)}</strong></div>
            <div><strong>Data Ordine:</strong> ${escapeHtml(orderDate)}</div>
            <div><strong style="font-size:15px;">Totale Pagato:</strong> <strong style="font-size:18px;color:#0b63f6;">€ ${totalEur.toFixed(2)}</strong></div>
          </div>

          <div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin-bottom:14px;">
            <div style="font-size:16px;font-weight:700;margin-bottom:10px;">Riepilogo dettagliato</div>
            <div><strong>Data spettacolo:</strong> ${escapeHtml(dataLabel || String(repRow.data_evento ?? ""))}</div>
            <div><strong>Orario:</strong> ${escapeHtml(orarioLabel || "—")}</div>
            <table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:14px;">
              <thead>
                <tr style="background:#f8fafc;text-align:left;">
                  <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Posto</th>
                  <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Fila</th>
                  <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Costo singolo</th>
                </tr>
              </thead>
              <tbody>${seatRowsHtml}</tbody>
            </table>
            <div style="margin-top:10px;"><strong>Diritti di prenotazione:</strong> € ${dirittiPrenotazione.toFixed(2)} x ${
              uniqueRequestedSeats.length
            } = <strong>€ ${dirittiPrenotazioneTot.toFixed(2)}</strong></div>
          </div>

          <div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin-bottom:14px;">
            <div style="font-size:16px;font-weight:700;margin-bottom:8px;">Dati Teatro</div>
            <div><strong>Nome:</strong> ${escapeHtml(String(teatroInfo?.nome_teatro ?? "Dati non disponibili"))}</div>
            <div><strong>Indirizzo:</strong> ${escapeHtml(String(teatroInfo?.indirizzo ?? "Dati non disponibili"))}</div>
            <div><strong>Comune:</strong> ${escapeHtml(String(teatroInfo?.comune ?? "Dati non disponibili"))}</div>
            <div><strong>Telefono:</strong> ${escapeHtml(String(teatroInfo?.telefono ?? "Dati non disponibili"))}</div>
          </div>

          <div style="margin-bottom:14px;"><strong>Organizzatore:</strong> ${escapeHtml(enteOrganizzatore)}</div>

          <div style="font-size:10px;color:#475569;border-top:1px solid #e5e7eb;padding-top:12px;line-height:1.45;">
            <p style="margin:0 0 8px 0;"><strong>DICHIARAZIONE FISCALE:</strong><br />
            ${escapeHtml(FISCAL_DISCLAIMER)}</p>
            <p style="margin:0 0 8px 0;"><strong>NOTE LEGALI:</strong><br />
            L'Organizzatore gestisce i Titoli di Accesso in nome e per conto di se stesso. Il contratto relativo alla prenotazione dei Titoli di Accesso si intende pertanto concluso direttamente tra il Cliente e l’Organizzatore. La nostra Associazione agisce esclusivamente come intermediario tecnologico per la gestione della piattaforma di prenotazione.</p>
            <p style="margin:0 0 8px 0;"><strong>TERMINI E CONDIZIONI:</strong><br />
            Si informa il gentile pubblico che, ai sensi dell’art. 59, lett. n) del D.Lgs. 206/2005 (Codice del Consumo), il diritto di recesso non si applica ai contratti riguardanti la fornitura di servizi relativi al tempo libero, qualora il contratto preveda una data o un periodo di esecuzione specifici. Pertanto, una volta confermata la prenotazione, il Titolo di Accesso non è rimborsabile. L'Organizzatore si riserva il diritto di apportare modifiche al programma per cause di forza maggiore.</p>
            <p style="margin:0;"><strong>TRATTAMENTO DATI PERSONALI (Informativa Privacy):</strong><br />
            I dati personali raccolti tramite questa piattaforma sono trattati dall'Organizzatore in qualità di Titolare del trattamento, nel pieno rispetto del Regolamento UE 2016/679 (GDPR). I dati sono raccolti esclusivamente per finalità legate alla gestione della prenotazione, all'invio del Titolo di Accesso e agli obblighi contabili/fiscali previsti dalla legge. I dati non saranno ceduti a terzi. L'interessato può esercitare in ogni momento i propri diritti (accesso, rettifica, cancellazione) contattando l'Organizzatore all'indirizzo email indicato in fattura o sul sito.</p>
          </div>
        </div>
      </div>
    `

  const mail = await resend.emails.send({
    from: senderFrom,
    to: email,
    subject: `Ricevuta di Prenotazione – ${spettacoloNome}`,
    html,
    attachments,
  })

  if (mail.error) {
    return { ok: false, error: mail.error.message, code: "RESEND_SEND" }
  }

  const { error: markErr } = await supabase
    .from("prenotazioni")
    .update({
      tickets_sent_at: new Date().toISOString(),
      tickets_email_message_id: String((mail.data as { id?: string } | null)?.id ?? ""),
    })
    .in("id", sentBookingIds)

  let warning: string | undefined
  if (markErr) {
    console.error("[deliver-booking-receipt] update tickets_sent_at fallito:", markErr.message)
    warning = "Email inviata ma aggiornamento stato prenotazione non riuscito."
  }

  return {
    ok: true,
    ticketIds: bookedSeats.map((item) => item.bookingId),
    messageId: (mail.data as { id?: string } | null)?.id ?? null,
    ...(warning ? { warning } : {}),
  }
}
