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

/** Righe in `public.scansioni` per questa prenotazione (ticket_id = prenotazioni.id) */
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
    }
  | {
      ok: false
      reason: "already_scanned"
      message: string
      nome: string
      cognome: string
      spettacolo: string
      /** Orario del primo (e unico valido) ingresso */
      primoIngresso: string
    }
  | { ok: false; reason: "invalid_id" | "not_found" | "not_paid" | "server" | "config"; message: string }

/**
 * Valida la prenotazione su `public.prenotazioni` (id UUID = ticket_id) e registra una riga in `public.scansioni`.
 * Solo lato server (service role).
 */
export async function processTicketScan(ticketIdRaw: string): Promise<ScanProcessResult> {
  const ticketId = String(ticketIdRaw ?? "").trim()
  if (!ticketId || !UUID_RE.test(ticketId)) {
    return { ok: false, reason: "invalid_id", message: "Codice prenotazione non valido." }
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
    return { ok: false, reason: "not_found", message: "Prenotazione non trovata." }
  }

  const stato = String(pren.stato_pagamento ?? "").toLowerCase()
  if (stato === "riservato") {
    return {
      ok: false,
      reason: "not_paid",
      message: "Prenotazione non ancora confermata dall'organizzatore.",
    }
  }
  if (stato !== "paid" && stato !== "confermato") {
    return { ok: false, reason: "not_paid", message: "Questa prenotazione non risulta confermata." }
  }

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

  const nome = String(pren.nome ?? "")
  const cognome = String(pren.cognome ?? "")

  // Biglietto già usato: non registra un nuovo ingresso.
  const { data: previousScans, error: prevErr } = await supabase
    .schema("public")
    .from("scansioni")
    .select("id, orario_scansione")
    .eq("ticket_id", ticketId)
    .order("orario_scansione", { ascending: true })

  if (prevErr) {
    return { ok: false, reason: "server", message: prevErr.message }
  }

  const previous: ScansioneRow[] = (previousScans ?? []).map((r) => ({
    id: String((r as { id: unknown }).id),
    orario_scansione: String((r as { orario_scansione: unknown }).orario_scansione ?? ""),
  }))

  if (previous.length > 0) {
    return {
      ok: false,
      reason: "already_scanned",
      message: "Biglietto già scansionato - Ingresso già avvenuto",
      nome,
      cognome,
      spettacolo,
      primoIngresso: previous[0].orario_scansione,
    }
  }

  const orarioScansione = new Date().toISOString()

  const { error: insErr } = await supabase
    .schema("public")
    .from("scansioni")
    .insert({
      ticket_id: ticketId,
      orario_scansione: orarioScansione,
    })

  if (insErr) {
    return { ok: false, reason: "server", message: insErr.message }
  }

  return {
    ok: true,
    nome,
    cognome,
    spettacolo,
    orarioScansione,
  }
}
