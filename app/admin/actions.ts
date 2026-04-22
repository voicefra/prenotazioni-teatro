"use server"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

const ALLOWED_TABLES = ["prenotazioni", "posti", "repliche", "spettacoli", "teatri"] as const
const ORDER: readonly string[] = ["prenotazioni", "posti", "repliche", "spettacoli", "teatri"]

export type AdminResetFilter = { spettacolo_id: string; replica_id: string }

export type AdminResetResult =
  | { ok: true; mode: "global"; truncated: string[] }
  | { ok: true; mode: "selective"; deleted: string[] }
  | { ok: false; error: string }

function getServiceClient():
  | { ok: false; error: string }
  | { ok: true; supabase: SupabaseClient<any> } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    return {
      ok: false,
      error:
        "Configurazione mancante: imposta NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nel file .env.local del server.",
    }
  }
  return {
    ok: true,
    supabase: createClient<any>(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  }
}

function assertConferma(confirmPhrase: string): string | null {
  if (confirmPhrase.trim() !== "CONFERMA") {
    return 'Digita esattamente CONFERMA (maiuscolo) per abilitare il reset.'
  }
  return null
}

/**
 * Reset database tramite RPC `admin_reset`:
 * - `filter` null → TRUNCATE sulle tabelle selezionate (ordine fisso lato SQL).
 * - `filter` presente → DELETE mirati (mai TRUNCATE); verifica replica ⊆ spettacolo lato SQL.
 */
export async function adminReset(
  selectedTables: string[],
  confirmPhrase: string,
  filter: AdminResetFilter | null,
): Promise<AdminResetResult> {
  const errMsg = assertConferma(confirmPhrase)
  if (errMsg) return { ok: false, error: errMsg }

  const allowed = new Set<string>(ALLOWED_TABLES)
  const picked = ORDER.filter((t) => selectedTables.includes(t) && allowed.has(t))

  if (picked.length === 0) {
    return { ok: false, error: "Seleziona almeno una tabella valida." }
  }

  if (filter !== null) {
    const sid = filter.spettacolo_id?.trim()
    const rid = filter.replica_id?.trim()
    if (!sid || !rid) {
      return { ok: false, error: "Reset selettivo: seleziona spettacolo e replica." }
    }
  }

  const client = getServiceClient()
  if (!client.ok) {
    return { ok: false, error: client.error }
  }
  const { supabase } = client

  // Reset selettivo sicuro per prenotazioni:
  // 1) trova ticket/prenotazioni della replica
  // 2) elimina prima scansioni (FK ticket_id -> prenotazioni.id)
  // 3) elimina poi prenotazioni
  if (filter !== null && picked.includes("prenotazioni")) {
    const rid = filter.replica_id.trim()

    const { data: repRow, error: repErr } = await supabase
      .from("repliche")
      .select("id, spettacolo_id")
      .eq("id", rid)
      .maybeSingle()

    if (repErr || !repRow) {
      console.error("[adminReset] verifica replica fallita:", repErr)
      return { ok: false, error: repErr?.message ?? "Replica non trovata." }
    }

    if (String(repRow.spettacolo_id ?? "") !== filter.spettacolo_id.trim()) {
      return { ok: false, error: "La replica selezionata non appartiene allo spettacolo indicato." }
    }

    const { data: bookingRows, error: bookingErr } = await supabase
      .from("prenotazioni")
      .select("id")
      .eq("replica_id", rid)

    if (bookingErr) {
      console.error("[adminReset] lettura prenotazioni fallita:", bookingErr)
      return { ok: false, error: bookingErr.message }
    }

    const ticketIds = (bookingRows ?? []).map((row) => String(row.id)).filter(Boolean)

    if (ticketIds.length > 0) {
      const { error: scansioniErr } = await supabase.from("scansioni").delete().in("ticket_id", ticketIds)
      if (scansioniErr) {
        console.error("[adminReset] delete scansioni fallita:", scansioniErr)
        return {
          ok: false,
          error: `Eliminazione scansioni fallita: ${scansioniErr.message}`,
        }
      }
    }

    const { error: delPrenErr } = await supabase.from("prenotazioni").delete().eq("replica_id", rid)
    if (delPrenErr) {
      console.error("[adminReset] delete prenotazioni fallita:", delPrenErr)
      return {
        ok: false,
        error: `Eliminazione prenotazioni fallita: ${delPrenErr.message}`,
      }
    }

    const pickedWithoutPrenotazioni = picked.filter((t) => t !== "prenotazioni")
    if (pickedWithoutPrenotazioni.length === 0) {
      return { ok: true, mode: "selective", deleted: ["prenotazioni", "scansioni"] }
    }

    const { data: restData, error: restErr } = await supabase.rpc("admin_reset", {
      p_tables: pickedWithoutPrenotazioni,
      p_filter: filter,
    })

    if (restErr) {
      console.error("[adminReset] admin_reset RPC (tabelle residue) fallita:", restErr)
      return { ok: false, error: restErr.message }
    }

    const restPayload = restData as { deleted?: unknown } | null
    const restDeleted = Array.isArray(restPayload?.deleted) ? restPayload.deleted.map((x) => String(x)) : []
    return {
      ok: true,
      mode: "selective",
      deleted: ["prenotazioni", "scansioni", ...restDeleted],
    }
  }

  const { data, error } = await supabase.rpc("admin_reset", {
    p_tables: picked,
    p_filter: filter,
  })

  if (error) {
    return { ok: false, error: error.message }
  }

  const payload = data as { mode?: string; truncated?: unknown; deleted?: unknown } | null
  const mode = payload?.mode === "selective" ? "selective" : "global"

  if (mode === "selective") {
    const raw = payload?.deleted
    const list = Array.isArray(raw) ? raw.map((x) => String(x)) : []
    return { ok: true, mode: "selective", deleted: list }
  }

  const rawT = payload?.truncated
  const listT = Array.isArray(rawT) ? rawT.map((x) => String(x)) : picked
  return { ok: true, mode: "global", truncated: listT }
}
