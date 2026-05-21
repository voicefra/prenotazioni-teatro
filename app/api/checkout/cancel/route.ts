import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

function getSupabaseService() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY richiesta per l'annullamento checkout.")
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("session_id")?.trim() ?? ""

  if (!sessionId) {
    return NextResponse.json(
      { ok: false, error: "Parametro session_id obbligatorio.", code: "MISSING_SESSION_ID" },
      { status: 400 },
    )
  }

  try {
    const supabase = getSupabaseService()

    const { data, error: deleteErr } = await supabase
      .from("prenotazioni")
      .delete()
      .eq("stato_pagamento", "pending")
      .eq("stripe_session_id", sessionId)
      .select("id")

    if (deleteErr) {
      return NextResponse.json({ ok: false, error: deleteErr.message, code: "BOOKING_DELETE" }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      deleted: true,
      releasedCount: (data ?? []).length,
      sessionId,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Errore sconosciuto"
    console.error("[checkout/cancel] unhandled:", err)
    return NextResponse.json({ ok: false, deleted: false, error: message, code: "INTERNAL" }, { status: 500 })
  }
}
