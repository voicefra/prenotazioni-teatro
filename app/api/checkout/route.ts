import { NextResponse } from "next/server"
import Stripe from "stripe"
import { createClient } from "@supabase/supabase-js"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2026-03-25.dahlia",
})

function getSupabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error("Variabili Supabase mancanti (NEXT_PUBLIC_SUPABASE_URL o chiave).")
  }
  return createClient(url, key)
}

const DEFAULT_PREZZO_EUR = 15
const DEFAULT_DIRITTI_EUR = 2

type Prezzi = { prezzo_biglietto: number; diritti_prevendita: number }

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

/**
 * Recupera prezzo_biglietto e diritti_prevendita da public.spettacoli:
 * 1) Se è presente replica_id: join repliche → spettacoli (stesso spettacolo della prenotazione).
 * 2) Altrimenti, se è presente spettacolo_id: lettura diretta su spettacoli.
 */
async function fetchPrezziFromSupabase(replicaId: string, spettacoloId: string): Promise<Prezzi> {
  let prezzi: Prezzi = {
    prezzo_biglietto: DEFAULT_PREZZO_EUR,
    diritti_prevendita: DEFAULT_DIRITTI_EUR,
  }

  const supabase = getSupabaseServer()

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
  try {
    const body = await request.json()
    const seats = Array.isArray(body.seats) ? body.seats : []
    const safeSeats = seats.map((s: unknown) => String(s))
    const safeReplicaId = body.replicaId != null ? String(body.replicaId) : ""
    const safeSpettacoloId = body.spettacoloId != null ? String(body.spettacoloId) : ""

    const { prezzo_biglietto: prezzoBigliettoEur, diritti_prevendita: dirittiPrevenditaEur } =
      await fetchPrezziFromSupabase(safeReplicaId, safeSpettacoloId)

    const unitAmountTicketCents = Math.round(prezzoBigliettoEur * 100)
    const unitAmountFeeCents = Math.round(dirittiPrevenditaEur * 100)

    const line_items = safeSeats.map((seatString: string) => {
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
            name: `🎟️ Ingresso Teatro`,
            description: `Fila ${fila.toUpperCase()} - Posto ${numero}`,
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
          name: "⚙️ Diritti di Prevendita",
          description: "Costi di gestione per biglietto",
        },
        unit_amount: unitAmountFeeCents,
      },
      quantity: safeSeats.length,
    })

    const origin = request.headers.get("origin")
    const replicaQuery = safeReplicaId ? `&replica_id=${encodeURIComponent(safeReplicaId)}` : ""

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: line_items,
      success_url: `${origin}/?success=true&session_id={CHECKOUT_SESSION_ID}${replicaQuery}`,
      cancel_url: `${origin}/?canceled=true${replicaQuery}`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Errore sconosciuto"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
