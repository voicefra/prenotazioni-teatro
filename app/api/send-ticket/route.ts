import { NextResponse } from "next/server"
import Stripe from "stripe"
import { createClient } from "@supabase/supabase-js"
import { Resend } from "resend"
import { renderTicketsPdf, type TicketSeat } from "@/lib/tickets/ticket-pdf"
import { buildTicketScanUrl } from "@/lib/tickets/scan-url"
import { formatTimeHHmm } from "@/lib/datetime-format"

export const runtime = "nodejs"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2026-03-25.dahlia",
})

function jsonError(status: number, error: string, code?: string) {
  return NextResponse.json({ ok: false, error, ...(code ? { code } : {}) }, { status })
}

function getSupabaseService() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Supabase server config missing (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).")
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

function parseSeatCode(code: string): TicketSeat | null {
  const m = code.trim().match(/^([A-Za-z]+)[-\s]?(\d+)$/)
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

type Body = {
  session_id: string
  replica_id: string
  customer: { nome: string; cognome: string; email: string; telefono?: string }
  seats: string[]
}

type BookingSeatRow = {
  id: string | number
  tickets_sent_at?: string | null
  posti_prenotati?: string[] | string | null
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

export async function POST(request: Request) {
  try {
    const resendKey = process.env.RESEND_API_KEY
    const from = process.env.RESEND_FROM
    if (!resendKey || !from) {
      return jsonError(
        500,
        "Configurazione email mancante: imposta RESEND_API_KEY e RESEND_FROM.",
        "MISSING_RESEND",
      )
    }

    let body: Partial<Body>
    try {
      body = (await request.json()) as Partial<Body>
    } catch {
      return jsonError(400, "Corpo richiesta non valido (JSON atteso).", "BAD_JSON")
    }

    const sessionId = String(body.session_id ?? "").trim()
    const replicaId = String(body.replica_id ?? "").trim()
    const email = String(body.customer?.email ?? "").trim()
    const nome = String(body.customer?.nome ?? "").trim()
    const cognome = String(body.customer?.cognome ?? "").trim()
    const telefono = String(body.customer?.telefono ?? "").trim()
    const seats = Array.isArray(body.seats) ? body.seats.map((s) => String(s)) : []

    if (!sessionId || !replicaId || !email || !nome || !cognome || seats.length === 0) {
      return jsonError(400, "Payload non valido.", "BAD_PAYLOAD")
    }

    // 1) Verifica pagamento su Stripe (server-side)
    let session: Stripe.Checkout.Session
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Errore Stripe"
      return jsonError(400, `Impossibile verificare il pagamento: ${msg}`, "STRIPE_RETRIEVE")
    }
    if (session.status !== "complete" || session.payment_status !== "paid") {
      return jsonError(400, "Pagamento non confermato su Stripe.", "STRIPE_NOT_PAID")
    }

    // 2) Carica dettagli spettacolo/replica da Supabase
    let supabase: ReturnType<typeof getSupabaseService>
    try {
      supabase = getSupabaseService()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Errore configurazione Supabase"
      return jsonError(500, msg, "SUPABASE_CONFIG")
    }
    const { data: repRow, error: repErr } = await supabase
      .from("repliche")
      .select("id, spettacolo_id, data_evento, orario")
      .eq("id", replicaId)
      .maybeSingle()

    if (repErr || !repRow) {
      return jsonError(400, repErr?.message ?? "Replica non trovata.", "REPLICA_NOT_FOUND")
    }

    const { data: spettacoloData, error: spettacoloErr } = await supabase
      .from("spettacoli")
      .select("nome_spettacolo, ente_organizzatore, teatro_id, prezzo_biglietto, diritti_prevendita")
      .eq("id", String(repRow.spettacolo_id ?? ""))
      .maybeSingle()
    if (spettacoloErr) {
      return jsonError(500, spettacoloErr.message, "SHOW_LOOKUP")
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
        return jsonError(500, teatroErr.message, "THEATER_LOOKUP")
      }
      teatroInfo = (teatroData ?? null) as TeatroRow | null
    }

    const dataLabel = formatDataEventoItDateOnly(repRow.data_evento)
    const orarioLabel = formatTimeHHmm(repRow.orario ?? repRow.data_evento) || ""
    const orderDate = new Date((session.created ?? Date.now() / 1000) * 1000).toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    const orderId = String(session.id ?? sessionId)
    const totalEur = Number(session.amount_total ?? 0) / 100

    // 3) Carica prenotazioni già legate alla sessione Stripe
    const { data: existingBookings, error: bookErr } = await supabase
      .from("prenotazioni")
      .select("id, tickets_sent_at, posti_prenotati")
      .eq("stripe_session_id", sessionId)
      .order("created_at", { ascending: true })

    if (bookErr) {
      return jsonError(500, bookErr.message, "BOOKING_LOOKUP")
    }
    const existingRows = ((existingBookings ?? []) as BookingSeatRow[]).map((row) => {
      const raw = Array.isArray(row.posti_prenotati) ? row.posti_prenotati[0] : row.posti_prenotati
      const seat = String(raw ?? "").trim().toUpperCase()
      return {
        id: String(row.id),
        ticketsSentAt: row.tickets_sent_at ?? null,
        seat,
      }
    })

    const bookingsBySeat = new Map(existingRows.map((row) => [row.seat, row]))
    const normalizedRequestedSeats = seats.map((seat) => String(seat).trim().toUpperCase()).filter(Boolean)
    const uniqueRequestedSeats = [...new Set(normalizedRequestedSeats)]
    if (uniqueRequestedSeats.length === 0) {
      return jsonError(400, "Nessun posto valido per generare le ricevute di prenotazione.", "BAD_SEATS")
    }

    // 4) Garantisce una riga prenotazione per ogni singolo posto (1 ticket = 1 riga)
    const missingSeats = uniqueRequestedSeats.filter((seat) => !bookingsBySeat.has(seat))
    if (missingSeats.length > 0) {
      const rowsToInsert = missingSeats.map((seat) => ({
        replica_id: replicaId,
        nome,
        cognome,
        email,
        telefono: telefono || null,
        posti_prenotati: [seat],
        stripe_session_id: sessionId,
        stato_pagamento: "paid",
      }))

      const { data: insertedRows, error: insErr } = await supabase
        .from("prenotazioni")
        .insert(rowsToInsert)
        .select("id, tickets_sent_at, posti_prenotati")

      if (insErr) {
        return jsonError(500, insErr.message, "BOOKING_INSERT")
      }

      ;((insertedRows ?? []) as BookingSeatRow[]).forEach((row) => {
        const raw = Array.isArray(row.posti_prenotati) ? row.posti_prenotati[0] : row.posti_prenotati
        const seat = String(raw ?? "").trim().toUpperCase()
        bookingsBySeat.set(seat, {
          id: String(row.id),
          ticketsSentAt: row.tickets_sent_at ?? null,
          seat,
        })
      })
    }

    const bookedSeats = uniqueRequestedSeats
      .map((seat) => {
        const booking = bookingsBySeat.get(seat)
        if (!booking) return null
        return {
          seat,
          bookingId: booking.id,
          alreadySent: Boolean(booking.ticketsSentAt),
        }
      })
      .filter(Boolean) as { seat: string; bookingId: string; alreadySent: boolean }[]

    if (bookedSeats.length === 0) {
      return jsonError(500, "Nessuna prenotazione disponibile per i posti richiesti.", "BOOKING_MISSING")
    }

    // Idempotenza per posto: se tutte le ricevute sono già state inviate, non reinviare
    if (bookedSeats.every((item) => item.alreadySent)) {
      return NextResponse.json({
        ok: true,
        alreadySent: true,
        ticketIds: bookedSeats.map((item) => item.bookingId),
      })
    }

    const attachments: { filename: string; content: string }[] = []
    const sentBookingIds: string[] = []
    for (const item of bookedSeats) {
      if (item.alreadySent) continue
      const seatObj = parseSeatCode(item.seat)
      if (!seatObj) continue

      const ticketScanUrl = buildTicketScanUrl(item.bookingId)
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
          filename: `ricevuta-prenotazione-${seatObj.fila}${seatObj.posto}.pdf`,
          content: pdfBuffer.toString("base64"),
        })
        sentBookingIds.push(item.bookingId)
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Errore generazione PDF"
        console.error("[send-ticket] PDF render:", e)
        return jsonError(500, `Generazione PDF non riuscita: ${msg}`, "PDF_RENDER")
      }
    }

    if (attachments.length === 0) {
      return NextResponse.json({
        ok: true,
        alreadySent: true,
        ticketIds: bookedSeats.map((item) => item.bookingId),
      })
    }

    const resend = new Resend(resendKey)
    const senderFrom = formatSenderFromAddress(from)
    const seatRowsHtml = uniqueRequestedSeats
      .map((seatCode) => {
        const parsed = parseSeatCode(seatCode)
        const fila = parsed?.fila ?? "—"
        const posto = parsed?.posto ?? seatCode
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
      return jsonError(500, mail.error.message, "RESEND_SEND")
    }

    // 5) Marca come inviato ogni riga ticket effettivamente spedita
    const { error: markErr } = await supabase
      .from("prenotazioni")
      .update({
        tickets_sent_at: new Date().toISOString(),
        tickets_email_message_id: String((mail.data as { id?: string } | null)?.id ?? ""),
      })
      .in("id", sentBookingIds)

    if (markErr) {
      console.error("[send-ticket] update tickets_sent_at fallito (email già inviata):", markErr.message)
    }

    return NextResponse.json({
      ok: true,
      ticketIds: bookedSeats.map((item) => item.bookingId),
      messageId: (mail.data as { id?: string } | null)?.id ?? null,
      ...(markErr ? { warning: "Email inviata ma aggiornamento stato prenotazione non riuscito (verifica migration tickets_sent_at)." } : {}),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Errore sconosciuto"
    console.error("[send-ticket] unhandled:", err)
    return jsonError(500, message, "INTERNAL")
  }
}

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

