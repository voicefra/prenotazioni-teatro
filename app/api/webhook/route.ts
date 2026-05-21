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
    throw new Error("SUPABASE_SERVICE_ROLE_KEY richiesta per il webhook.")
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export async function POST(request: Request) {
  const body = await request.text()
  const sig = request.headers.get("stripe-signature")

  if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Webhook non configurato." }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Errore verifica firma"
    return NextResponse.json({ error: `Webhook Error: ${message}` }, { status: 400 })
  }

  const supabase = getSupabaseService()

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session
    const sessionId = String(session.id ?? "").trim()

    if (sessionId && session.payment_status === "paid") {
      const { error: updateErr } = await supabase
        .from("prenotazioni")
        .update({ stato_pagamento: "paid" })
        .eq("stripe_session_id", sessionId)
        .eq("stato_pagamento", "pending")

      if (updateErr) {
        console.error("[webhook] aggiornamento paid fallito:", updateErr.message)
        return NextResponse.json({ error: updateErr.message }, { status: 500 })
      }

      const delivery = await deliverBookingReceiptForStripeSession(stripe, supabase, sessionId, {
        requireStripePaidCheck: false,
      })

      if (!delivery.ok) {
        console.error("[webhook] invio ricevuta fallito:", delivery.error, delivery.code)
      }
    }
  }

  if (event.type === "checkout.session.expired") {
    const session = event.data.object as Stripe.Checkout.Session
    const sessionId = String(session.id ?? "").trim()

    if (sessionId) {
      const { error: deleteErr } = await supabase
        .from("prenotazioni")
        .delete()
        .eq("stripe_session_id", sessionId)
        .eq("stato_pagamento", "pending")

      if (deleteErr) {
        console.error("[webhook] rimozione pending fallita:", deleteErr.message)
        return NextResponse.json({ error: deleteErr.message }, { status: 500 })
      }
    }
  }

  return NextResponse.json({ received: true })
}
