import { createHash, timingSafeEqual } from "crypto"

/** Cookie che ricorda sullo smartphone dell'operatore che la password è stata inserita. */
export const SCAN_AUTH_COOKIE = "scan_operatore"
export const SCAN_AUTH_MAX_AGE_S = 60 * 60 * 24 * 30 // 30 giorni

/**
 * Password degli operatori per la scansione all'ingresso.
 * Usa SCAN_PASSWORD; se manca, ADMIN_PASSWORD (così funziona anche prima di configurarla).
 */
export function getScanPassword(): string {
  return (process.env.SCAN_PASSWORD?.trim() || process.env.ADMIN_PASSWORD?.trim() || "").trim()
}

/** Valore del cookie: impronta della password. Se la password cambia, gli accessi salvati decadono. */
export function scanAuthToken(password: string): string {
  return createHash("sha256").update(`scan-operatore:${password}`).digest("hex")
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export function isValidScanPassword(input: string): boolean {
  const expected = getScanPassword()
  if (!expected) return false
  return safeEqual(String(input ?? "").trim(), expected)
}

export function isValidScanCookie(cookieValue: string | undefined): boolean {
  const expected = getScanPassword()
  if (!expected || !cookieValue) return false
  return safeEqual(cookieValue, scanAuthToken(expected))
}
