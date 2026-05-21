import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { pendingHoldCutoffIso } from "@/lib/booking/prenotazioni-utils"

export const runtime = "nodejs"

function getSupabaseService() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY richiesta per la pulizia prenotazioni.")
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

/** DELETE fisico: pending con created_at oltre 7 minuti fa. */
export async function GET() {
  try {
    const supabase = getSupabaseService()
    const timeLimit = pendingHoldCutoffIso()

    const { data, error } = await supabase
      .from("prenotazioni")
      .delete()
      .eq("stato_pagamento", "pending")
      .lt("created_at", timeLimit)
      .select("id")

    if (error) {
      console.error("[cleanup] delete fallito:", error.message)
      return NextResponse.json({ deleted: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      deleted: true,
      removedCount: (data ?? []).length,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Errore sconosciuto"
    console.error("[cleanup] unhandled:", err)
    return NextResponse.json({ deleted: false, error: message }, { status: 500 })
  }
}
