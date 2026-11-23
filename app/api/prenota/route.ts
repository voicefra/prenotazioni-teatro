import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import {
  capienzaFromTeatro,
  collectOccupiedSeatCodes,
  countBookedTicketsFromPrenotazioni,
  pendingHoldCutoffIso,
  prenotazioniAvailabilityOrFilter,
} from "@/lib/booking/prenotazioni-utils"
import { deliverBookingReceiptForReservation } from "@/lib/tickets/deliver-booking-receipt"

export const runtime = "nodejs"

function getSupabaseService() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY richiesta per la prenotazione.")
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

/** Prenotazione senza pagamento online. Il posto resta `riservato` per 48 ore. */
export async function POST(request: Request) {
  const supabase = getSupabaseService()
  let insertedIds: string[] = []

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
      return NextResponse.json({ error: "Dati prenotazione non validi." }, { status: 400 })
    }

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
      .select("modalita_prenotazione, modalita_pagamento, teatro_id")
      .eq("id", spettacoloId)
      .maybeSingle()

    if (spettacoloErr || !spettacoloRow) {
      return NextResponse.json({ error: "Spettacolo non trovato." }, { status: 400 })
    }

    if (String(spettacoloRow.modalita_pagamento ?? "pagamento_online").trim() !== "solo_prenotazione") {
      return NextResponse.json(
        { error: "Questo spettacolo richiede il pagamento online." },
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

    const { data: statusRows, error: statusError } = await supabase
      .from("prenotazioni")
      .select("posti_prenotati, stato_pagamento, created_at")
      .eq("replica_id", safeReplicaId)
      .or(prenotazioniAvailabilityOrFilter(pendingHoldCutoffIso()))

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

    const rowsToInsert = safeSeats.map((seatCode) => ({
      replica_id: safeReplicaId,
      nome,
      cognome,
      email,
      telefono: telefono || null,
      posti_prenotati: [seatCode],
      stato_pagamento: "riservato",
    }))

    const { data: inserted, error: insertErr } = await supabase
      .from("prenotazioni")
      .insert(rowsToInsert)
      .select("id")

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    insertedIds = (inserted ?? []).map((row) => String((row as { id: unknown }).id)).filter(Boolean)
    const receipt = await deliverBookingReceiptForReservation(supabase, insertedIds)
    if (!receipt.ok) {
      if (insertedIds.length > 0) {
        await supabase.from("prenotazioni").delete().in("id", insertedIds)
      }
      return NextResponse.json({ error: receipt.error }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      ...(receipt.warning ? { warning: receipt.warning } : {}),
    })
  } catch (err: unknown) {
    if (insertedIds.length > 0) {
      await supabase.from("prenotazioni").delete().in("id", insertedIds).then(() => undefined, () => undefined)
    }
    const message = err instanceof Error ? err.message : "Errore sconosciuto"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
