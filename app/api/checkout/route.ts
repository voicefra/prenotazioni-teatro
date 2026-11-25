import { NextResponse } from "next/server"
import Stripe from "stripe"
import { createClient } from "@supabase/supabase-js"
import { POSTI_NON_DISPONIBILI, PG_UNIQUE_VIOLATION, purgeExpiredForReplica } from "@/lib/booking/prenotazioni-server"
import {
  capienzaFromTeatro,
  collectOccupiedSeatCodes,
  countBookedTicketsFromPrenotazioni,
  pendingHoldCutoffIso,
  prenotazioniAvailabilityOrFilter,
} from "@/lib/booking/prenotazioni-utils"

export const runtime = "nodejs"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2026-03-25.dahlia",
})

const DEFAULT_PREZZO_EUR = 15
const DEFAULT_DIRITTI_EUR = 2

type Prezzi = { prezzo_biglietto: number; diritti_prevendita: number }

function getSupabaseService() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY richiesta per il checkout.")
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

function applyPrezziFromRow(
  row: { prezzo_biglietto?: number | null; diritti_prevendita?: number | null } | null,
  current: Prezzi,
): Prezzi {
  if (!row) return current
  const pb = Number(row.prezzo_biglietto)
  const dp = Number(row.diritti_prevendita)
  let next = { ...current }
  if (Number.isFinite(pb) && pb >= 0) next = { ...next, prezzo_biglietto: pb }
  if (Number.isFinite(dp) && dp >= 0) next = { ...next, diritti_prevendita: dp }
  return next
}

async function fetchPrezziFromSupabase(replicaId: string, spettacoloId: string): Promise<Prezzi> {
  let prezzi: Prezzi = {
    prezzo_biglietto: DEFAULT_PREZZO_EUR,
    diritti_prevendita: DEFAULT_DIRITTI_EUR,
  }

  const supabase = getSupabaseService()

  if (replicaId) {
    const { data: replicaRow, error: replicaErr } = await supabase
      .from("repliche")
      .select("id, spettacolo_id, spettacoli ( prezzo_biglietto, diritti_prevendita )")
      .eq("id", replicaId)
      .maybeSingle()

    if (!replicaErr && replicaRow) {
      const nested = replicaRow.spettacoli as
        | { prezzo_biglietto?: number | null; diritti_prevendita?: number | null }
        | { prezzo_biglietto?: number | null; diritti_prevendita?: number | null }[]
        | null

      const spettacolo = Array.isArray(nested) ? nested[0] : nested
      prezzi = applyPrezziFromRow(spettacolo, prezzi)
      return prezzi
    }
  }

  if (spettacoloId) {
    const { data: spRow, error: spErr } = await supabase
      .from("spettacoli")
      .select("prezzo_biglietto, diritti_prevendita")
      .eq("id", spettacoloId)
      .maybeSingle()

    if (!spErr && spRow) {
      prezzi = applyPrezziFromRow(spRow, prezzi)
    }
  }

  return prezzi
}

export async function POST(request: Request) {
  let session: Stripe.Checkout.Session | null = null

  try {
    const body = await request.json()
    const seats = Array.isArray(body.seats) ? body.seats : []
    const safeSeats: string[] = Array.from(
      new Set(seats.map((s: unknown) => String(s).trim()).filter(Boolean)),
    ) as string[]
    const safeReplicaId = body.replicaId != null ? String(body.replicaId).trim() : ""
    const safeSpettacoloId = body.spettacoloId != null ? String(body.spettacoloId).trim() : ""
    const bookingModeRaw = String(body.bookingMode ?? "posti_assegnati").trim()
    const bookingMode = bookingModeRaw === "posto_unico" ? "posto_unico" : "posti_assegnati"

    const nome = String(body.customer?.nome ?? "").trim()
    const cognome = String(body.customer?.cognome ?? "").trim()
    const email = String(body.customer?.email ?? "").trim()
    const telefono = String(body.customer?.telefono ?? "").trim()

    if (!safeReplicaId || safeSeats.length === 0 || !nome || !cognome || !email) {
      return NextResponse.json({ error: "Payload checkout non valido." }, { status: 400 })
    }

    const supabase = getSupabaseService()

    const { data: replicaRow, error: replicaErr } = await supabase
      .from("repliche")
      .select("id, spettacolo_id")
      .eq("id", safeReplicaId)
      .maybeSingle()

    if (replicaErr || !replicaRow) {
      return NextResponse.json({ error: "Replica non trovata." }, { status: 400 })
    }

    const spettacoloId = String(replicaRow.spettacolo_id ?? safeSpettacoloId).trim()
    const { data: spettacoloRow, error: spettacoloErr } = await supabase
      .from("spettacoli")
      .select("modalita_prenotazione, modalita_pagamento, teatro_id, prezzo_biglietto, diritti_prevendita")
      .eq("id", spettacoloId)
      .maybeSingle()

    if (spettacoloErr || !spettacoloRow) {
      return NextResponse.json({ error: "Spettacolo non trovato." }, { status: 400 })
    }

    const modalitaPagamento = String(spettacoloRow.modalita_pagamento ?? "pagamento_online").trim()
    if (modalitaPagamento === "solo_prenotazione") {
      return NextResponse.json(
        { error: "Questo spettacolo accetta solo la prenotazione, senza pagamento online." },
        { status: 400 },
      )
    }

    const modalitaDb = String(spettacoloRow.modalita_prenotazione ?? "posti_assegnati").trim()
    const isPostoUnicoDb = modalitaDb === "posto_unico"
    if (bookingMode === "posto_unico" && !isPostoUnicoDb) {
      return NextResponse.json({ error: "Modalità prenotazione non valida per questo spettacolo." }, { status: 400 })
    }
    if (bookingMode === "posti_assegnati" && isPostoUnicoDb) {
      return NextResponse.json({ error: "Questo spettacolo usa posto unico." }, { status: 400 })
    }

    const fifteenMinutesAgo = pendingHoldCutoffIso()

    await purgeExpiredForReplica(supabase, safeReplicaId)

    const { data: statusRows, error: statusError } = await supabase
      .from("prenotazioni")
      .select("posti_prenotati, stato_pagamento, created_at")
      .eq("replica_id", safeReplicaId)
      .or(prenotazioniAvailabilityOrFilter(fifteenMinutesAgo))

    if (statusError) {
      return NextResponse.json({ error: statusError.message }, { status: 500 })
    }

    if (bookingMode === "posto_unico") {
      const teatroId = String(spettacoloRow.teatro_id ?? "").trim()
      if (!teatroId) {
        return NextResponse.json({ error: "Teatro non configurato." }, { status: 400 })
      }

      const { data: teatroRow, error: teatroErr } = await supabase
        .from("teatri")
        .select("numero_file, posti_per_fila")
        .eq("id", teatroId)
        .maybeSingle()

      if (teatroErr || !teatroRow) {
        return NextResponse.json({ error: "Impossibile leggere la capienza del teatro." }, { status: 500 })
      }

      const capienza = capienzaFromTeatro(Number(teatroRow.numero_file), Number(teatroRow.posti_per_fila))
      if (capienza <= 0) {
        return NextResponse.json({ error: "Capienza teatro non disponibile." }, { status: 400 })
      }

      const booked = countBookedTicketsFromPrenotazioni(statusRows ?? [])
      const rimanenti = capienza - booked
      if (safeSeats.length > rimanenti) {
        return NextResponse.json(
          { error: rimanenti <= 0 ? "Spettacolo sold out." : "Posti insufficienti per la quantità richiesta." },
          { status: 409 },
        )
      }
    } else {
      const occupied = collectOccupiedSeatCodes(statusRows ?? [])
      const taken = safeSeats.filter((code: string) => occupied.has(code.toUpperCase()))
      if (taken.length > 0) {
        return NextResponse.json({ error: "Uno o più posti non sono più disponibili." }, { status: 409 })
      }
    }

    const { prezzo_biglietto: prezzoBigliettoEur, diritti_prevendita: dirittiPrevenditaEur } =
      await fetchPrezziFromSupabase(safeReplicaId, spettacoloId)

    const unitAmountTicketCents = Math.round(prezzoBigliettoEur * 100)
    const unitAmountFeeCents = Math.round(dirittiPrevenditaEur * 100)

    const line_items = (safeSeats as string[]).map((seatString: string) => {
      const match = seatString.match(/([a-zA-Z]+)(\d+)/)
      let fila = ""
      let numero = ""
      if (match) {
        fila = match[1]
        numero = match[2]
      } else {
        fila = "Generale"
        numero = seatString
      }

      return {
        price_data: {
          currency: "eur",
          product_data: {
            name: "🎟️ Prenotazione Posto",
            description: `Prenotazione per spettacolo - Fila ${fila.toUpperCase()} - Posto ${numero}`,
          },
          unit_amount: unitAmountTicketCents,
        },
        quantity: 1,
      }
    })

    line_items.push({
      price_data: {
        currency: "eur",
        product_data: {
          name: "Diritti di prenotazione",
          description: "Costi di gestione per prenotazione",
        },
        unit_amount: unitAmountFeeCents,
      },
      quantity: safeSeats.length,
    })

    const origin = request.headers.get("origin") ?? ""
    const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL ?? origin).replace(/\/$/, "")
    const replicaPrefix = safeReplicaId ? `replica_id=${encodeURIComponent(safeReplicaId)}&` : ""

    session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items,
      metadata: {
        replica_id: safeReplicaId,
        modalita_prenotazione: bookingMode,
      },
      success_url: `${baseUrl}/?${replicaPrefix}success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/?replica_id=${encodeURIComponent(safeReplicaId)}&canceled=true&session_id={CHECKOUT_SESSION_ID}`,
    })

    const rowsToInsert = safeSeats.map((seatCode) => ({
      replica_id: safeReplicaId,
      nome,
      cognome,
      email,
      telefono: telefono || null,
      posti_prenotati: [seatCode],
      stripe_session_id: session!.id,
      stato_pagamento: "pending",
    }))

    const { error: insertErr } = await supabase.from("prenotazioni").insert(rowsToInsert)

    if (insertErr) {
      await stripe.checkout.sessions.expire(session.id).catch(() => undefined)
      if (insertErr.code === PG_UNIQUE_VIOLATION) {
        return NextResponse.json({ error: POSTI_NON_DISPONIBILI }, { status: 409 })
      }
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    return NextResponse.json({ url: session.url })
  } catch (err: unknown) {
    if (session?.id) {
      await stripe.checkout.sessions.expire(session.id).catch(() => undefined)
    }
    const message = err instanceof Error ? err.message : "Errore sconosciuto"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
