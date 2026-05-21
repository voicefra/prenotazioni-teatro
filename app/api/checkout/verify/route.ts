import { NextResponse } from "next/server"
import Stripe from "stripe"
import { createClient } from "@supabase/supabase-js"
import { deliverBookingReceiptForStripeSession } from "@/lib/tickets/deliver-booking-receipt"

export const runtime = "nodejs"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2026-03-25.dahlia",
})

function getSupabaseService() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY richiesta per la verifica checkout.")
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("session_id")?.trim() ?? ""

  if (!sessionId) {
    return NextResponse.json(
      { ok: false, error: "Parametro session_id mancante.", code: "MISSING_SESSION_ID" },
      { status: 400 },
    )
  }

  try {
    let session: Stripe.Checkout.Session
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Errore Stripe"
      return NextResponse.json(
        { ok: false, error: `Impossibile verificare il pagamento: ${msg}`, code: "STRIPE_RETRIEVE" },
        { status: 400 },
      )
    }

    if (session.payment_status !== "paid") {
      return NextResponse.json(
        { ok: false, error: "Il pagamento non risulta ancora confermato su Stripe.", code: "STRIPE_NOT_PAID" },
        { status: 400 },
      )
    }

    const supabase = getSupabaseService()

    const { data: rows, error: fetchErr } = await supabase
      .from("prenotazioni")
      .select("id, stato_pagamento")
      .eq("stripe_session_id", sessionId)

    if (fetchErr) {
      return NextResponse.json({ ok: false, error: fetchErr.message, code: "BOOKING_LOOKUP" }, { status: 500 })
    }

    if (!rows || rows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Nessuna prenotazione trovata per questa sessione di pagamento.", code: "BOOKING_MISSING" },
        { status: 404 },
      )
    }

    const hasPending = rows.some((row) => String(row.stato_pagamento ?? "") === "pending")

    if (!hasPending) {
      return NextResponse.json({ ok: true, alreadyConfirmed: true })
    }

    const { error: updateErr } = await supabase
      .from("prenotazioni")
      .update({ stato_pagamento: "paid" })
      .eq("stripe_session_id", sessionId)
      .eq("stato_pagamento", "pending")

    if (updateErr) {
      return NextResponse.json({ ok: false, error: updateErr.message, code: "BOOKING_UPDATE" }, { status: 500 })
    }

    const delivery = await deliverBookingReceiptForStripeSession(stripe, supabase, sessionId, {
      requireStripePaidCheck: false,
    })

    if (!delivery.ok) {
      console.error("[checkout/verify] invio ricevuta fallito:", delivery.error, delivery.code)
      return NextResponse.json({
        ok: true,
        warning:
          "Pagamento confermato, ma l'invio della ricevuta via email ha riscontrato un problema. Controlla la posta o contatta l'assistenza.",
      })
    }

    return NextResponse.json({
      ok: true,
      alreadySent: delivery.alreadySent ?? false,
      ticketIds: delivery.ticketIds,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Errore sconosciuto"
    console.error("[checkout/verify] unhandled:", err)
    return NextResponse.json({ ok: false, error: message, code: "INTERNAL" }, { status: 500 })
  }
}
