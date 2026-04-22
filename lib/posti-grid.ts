/**
 * Genera le righe da inserire in `posti` per uno spettacolo (replica_id null).
 * Codici posto: A1, A2, ... B1, ... in base a numero_file (max 26 = A-Z) e posti_per_fila.
 * Nomi colonne allineati a Supabase: spettacolo_id, replica_id, numero_posto, stato
 */

export interface PostoInsertRow {
  spettacolo_id: string
  replica_id: null
  numero_posto: string
  stato: "libero"
}

export function buildPostiGridForSpettacolo(
  spettacoloId: string,
  numeroFile: number,
  postiPerFila: number
): PostoInsertRow[] {
  const nf = Math.min(Math.max(1, Math.floor(numeroFile)), 26)
  const np = Math.max(1, Math.floor(postiPerFila))
  const rows: PostoInsertRow[] = []

  for (let fila = 1; fila <= nf; fila++) {
    const lettera = String.fromCharCode(64 + fila)
    for (let n = 1; n <= np; n++) {
      rows.push({
        spettacolo_id: spettacoloId,
        replica_id: null,
        numero_posto: `${lettera}${n}`,
        stato: "libero",
      })
    }
  }

  return rows
}
