import type { SupabaseClient } from "@supabase/supabase-js"
import { pendingHoldCutoffIso, reservationHoldCutoffIso } from "@/lib/booking/prenotazioni-utils"

/** Codice errore Postgres per violazione di vincolo UNIQUE. */
export const PG_UNIQUE_VIOLATION = "23505"

export const POSTI_NON_DISPONIBILI = "Uno o più posti non sono più disponibili."

/**
 * Elimina per una replica le prenotazioni scadute (pending > 7 minuti, riservato > 48 ore).
 * Va chiamata prima di inserire nuove prenotazioni: l'indice UNIQUE sui posti attivi
 * altrimenti considererebbe ancora occupati i posti scaduti.
 */
export async function purgeExpiredForReplica(supabase: SupabaseClient, replicaId: string): Promise<void> {
  const nowMs = Date.now()
  await supabase
    .from("prenotazioni")
    .delete()
    .eq("replica_id", replicaId)
    .eq("stato_pagamento", "pending")
    .lt("created_at", pendingHoldCutoffIso(nowMs))
  await supabase
    .from("prenotazioni")
    .delete()
    .eq("replica_id", replicaId)
    .eq("stato_pagamento", "riservato")
    .lt("created_at", reservationHoldCutoffIso(nowMs))
}
