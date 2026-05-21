import { NextResponse } from "next/server"
import Stripe from "stripe"
import { createClient } from "@supabase/supabase-js"
import { deliverBookingReceiptForStripeSession } from "@/lib/tickets/deliver-booking-receipt"

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
  if (!url || !key) {
    throw new Error("Supabase server config missing (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).")
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

type Body = {
  session_id: string
}

export async function POST(request: Request) {
  try {
    let body: Partial<Body>
    try {
      body = (await request.json()) as Partial<Body>
    } catch {
      return jsonError(400, "Corpo richiesta non valido (JSON atteso).", "BAD_JSON")
    }

    const sessionId = String(body.session_id ?? "").trim()
    if (!sessionId) {
      return jsonError(400, "session_id obbligatorio.", "BAD_PAYLOAD")
    }

    let supabase: ReturnType<typeof getSupabaseService>
    try {
      supabase = getSupabaseService()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Errore configurazione Supabase"
      return jsonError(500, msg, "SUPABASE_CONFIG")
    }

    const result = await deliverBookingReceiptForStripeSession(stripe, supabase, sessionId, {
      requireStripePaidCheck: true,
    })

    if (!result.ok) {
      return jsonError(400, result.error, result.code)
    }

    return NextResponse.json({
      ok: true,
      alreadySent: result.alreadySent ?? false,
      ticketIds: result.ticketIds,
      messageId: result.messageId ?? null,
      ...(result.warning ? { warning: result.warning } : {}),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Errore sconosciuto"
    console.error("[send-ticket] unhandled:", err)
    return jsonError(500, message, "INTERNAL")
  }
}
