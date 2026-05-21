/** Durata blocco posti in stato `pending` (checkout non completato). */
export const PENDING_HOLD_MS = 7 * 60 * 1000

export type PrenotazioneAvailabilityRow = {
  posti_prenotati: string[] | string | null
  stato_pagamento?: string | null
  created_at?: string | null
  replica_id?: string | number | null
}

export function normalizeBookedSeats(value: string[] | string | null | undefined): string[] {
  if (Array.isArray(value)) return value.map((seat) => String(seat).trim()).filter(Boolean)
  if (value == null) return []
  const seat = String(value).trim()
  return seat ? [seat] : []
}

export function pendingHoldCutoffIso(nowMs = Date.now()): string {
  return new Date(nowMs - PENDING_HOLD_MS).toISOString()
}

/**
 * Filtro PostgREST equivalente a:
 * (stato_pagamento = 'paid') OR (stato_pagamento = 'pending' AND created_at >= cutoff)
 */
export function prenotazioniAvailabilityOrFilter(cutoffIso?: string): string {
  const cutoff = cutoffIso ?? pendingHoldCutoffIso()
  return `stato_pagamento.eq.paid,and(stato_pagamento.eq.pending,created_at.gte."${cutoff}")`
}

/** `pending` conta come occupato solo entro i 7 minuti da `created_at`; `paid` sempre. */
export function rowCountsForAvailability(row: PrenotazioneAvailabilityRow, nowMs = Date.now()): boolean {
  const stato = String(row.stato_pagamento ?? "").toLowerCase()
  if (stato === "paid") return true
  if (stato !== "pending") return false

  const createdRaw = row.created_at
  if (!createdRaw) return false

  const createdMs = new Date(createdRaw).getTime()
  if (Number.isNaN(createdMs)) return false

  return nowMs - createdMs < PENDING_HOLD_MS
}

export function filterRowsForAvailability(rows: PrenotazioneAvailabilityRow[]): PrenotazioneAvailabilityRow[] {
  return rows.filter(rowCountsForAvailability)
}

export function countBookedTicketsFromPrenotazioni(rows: PrenotazioneAvailabilityRow[]): number {
  return filterRowsForAvailability(rows).reduce(
    (sum, row) => sum + normalizeBookedSeats(row.posti_prenotati).length,
    0,
  )
}

export function collectOccupiedSeatCodes(rows: PrenotazioneAvailabilityRow[]): Set<string> {
  const codes = new Set<string>()
  filterRowsForAvailability(rows).forEach((row) => {
    normalizeBookedSeats(row.posti_prenotati).forEach((seatCode) => {
      codes.add(String(seatCode).toUpperCase())
    })
  })
  return codes
}

export function countBookedTicketsByReplica(
  rows: PrenotazioneAvailabilityRow[],
): Map<string, number> {
  const map = new Map<string, number>()
  filterRowsForAvailability(rows).forEach((row) => {
    const rid = String(row.replica_id ?? "").trim()
    if (!rid) return
    const n = normalizeBookedSeats(row.posti_prenotati).length
    map.set(rid, (map.get(rid) ?? 0) + n)
  })
  return map
}

export function capienzaFromTeatro(numeroFile: number, postiPerFila: number): number {
  const nf = Math.floor(Number(numeroFile))
  const pp = Math.floor(Number(postiPerFila))
  if (!Number.isFinite(nf) || !Number.isFinite(pp) || nf < 1 || pp < 1) return 0
  return nf * pp
}
