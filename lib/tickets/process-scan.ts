import { createClient, type SupabaseClient } from "@supabase/supabase-js"

function getServiceClient():
  | { ok: false; error: string }
  | { ok: true; supabase: SupabaseClient } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return { ok: false, error: "Configurazione server Supabase mancante." }
  }
  return {
    ok: true,
    supabase: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }),
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Righe in `public.scansioni` per questo biglietto (ticket_id = prenotazioni.id) */
export type ScansioneRow = {
  id: string
  orario_scansione: string
}

export type ScanProcessResult =
  | {
      ok: true
      nome: string
      cognome: string
      spettacolo: string
      orarioScansione: string
      /** Ultime scansioni da `public.scansioni` (stesso ticket_id) */
      scansioni: ScansioneRow[]
    }
  | { ok: false; reason: "invalid_id" | "not_found" | "not_paid" | "server" | "config"; message: string }

/**
 * Valida il biglietto su `public.prenotazioni` (id UUID = ticket_id) e registra una riga in `public.scansioni`.
 * Solo lato server (service role).
 */
export async function processTicketScan(ticketIdRaw: string): Promise<ScanProcessResult> {
  const ticketId = String(ticketIdRaw ?? "").trim()
  if (!ticketId || !UUID_RE.test(ticketId)) {
    return { ok: false, reason: "invalid_id", message: "Codice biglietto non valido." }
  }

  const client = getServiceClient()
  if (!client.ok) {
    return { ok: false, reason: "config", message: client.error }
  }
  const { supabase } = client

  // Verifica esistenza prenotazione: ticket_id deve coincidere con prenotazioni.id (UUID)
  const { data: pren, error: prenErr } = await supabase
    .schema("public")
    .from("prenotazioni")
    .select("id, nome, cognome, stato_pagamento, replica_id")
    .eq("id", ticketId)
    .maybeSingle()

  if (prenErr) {
    return { ok: false, reason: "server", message: prenErr.message }
  }
  if (!pren || String(pren.id) !== ticketId) {
    return { ok: false, reason: "not_found", message: "Biglietto non trovato." }
  }

  const stato = String(pren.stato_pagamento ?? "").toLowerCase()
  if (stato !== "paid") {
    return { ok: false, reason: "not_paid", message: "Questo biglietto non risulta pagato." }
  }

  const orarioScansione = new Date().toISOString()

  const { data: insertedScan, error: insErr } = await supabase
    .schema("public")
    .from("scansioni")
    .insert({
      ticket_id: ticketId,
      orario_scansione: orarioScansione,
    })
    .select("id, ticket_id, orario_scansione")
    .maybeSingle()

  if (insErr) {
    return { ok: false, reason: "server", message: insErr.message }
  }

  const { data: scansioniRows, error: listErr } = await supabase
    .schema("public")
    .from("scansioni")
    .select("id, orario_scansione")
    .eq("ticket_id", ticketId)
    .order("orario_scansione", { ascending: false })

  if (listErr) {
    console.error("[process-scan] lettura public.scansioni fallita:", listErr.message)
  }

  const scansioni: ScansioneRow[] = (scansioniRows ?? []).map((r) => ({
    id: String((r as { id: unknown }).id),
    orario_scansione: String((r as { orario_scansione: unknown }).orario_scansione ?? ""),
  }))

  let spettacolo = "Spettacolo"
  const rid = pren.replica_id != null ? String(pren.replica_id) : ""
  if (rid) {
    const { data: repRow } = await supabase
      .schema("public")
      .from("repliche")
      .select("spettacoli ( nome_spettacolo )")
      .eq("id", rid)
      .maybeSingle()
    const nested = repRow?.spettacoli as { nome_spettacolo?: string | null } | { nome_spettacolo?: string | null }[] | null
    const sp = Array.isArray(nested) ? nested[0] : nested
    if (sp?.nome_spettacolo) spettacolo = String(sp.nome_spettacolo)
  }

  const lastOrario =
    insertedScan && (insertedScan as { orario_scansione?: string }).orario_scansione
      ? String((insertedScan as { orario_scansione: string }).orario_scansione)
      : orarioScansione

  return {
    ok: true,
    nome: String(pren.nome ?? ""),
    cognome: String(pren.cognome ?? ""),
    spettacolo,
    orarioScansione: lastOrario,
    scansioni,
  }
}
