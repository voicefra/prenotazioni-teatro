/**
 * Base URL per i QR di ingresso.
 * - In locale (localhost / 127.0.0.1) si usa sempre **http://** (mai https forzato).
 * - In produzione imposta `NEXT_PUBLIC_TICKET_SCAN_ORIGIN` con l’URL pubblico (di solito https).
 */

function isLocalHostname(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase()
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".localhost")
}

function normalizeProtocolForScanBase(parsed: URL): void {
  if (isLocalHostname(parsed.hostname) && parsed.protocol === "https:") {
    parsed.protocol = "http:"
  }
}

/**
 * Origine senza slash finale, es. `http://localhost:3000` o `https://miosito.it`
 */
export function getTicketScanOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_TICKET_SCAN_ORIGIN?.trim()
  const fallback = "http://localhost:3000"

  if (!raw) {
    return fallback.replace(/\/$/, "")
  }

  let parsed: URL
  try {
    const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    parsed = new URL(withProto)
  } catch {
    return fallback.replace(/\/$/, "")
  }

  normalizeProtocolForScanBase(parsed)

  const origin = parsed.origin.replace(/\/$/, "")
  return origin
}

/** URL completo nel QR: `{origine}/scan?ticket_id=<uuid prenotazioni>` */
export function buildTicketScanUrl(ticketId: string): string {
  const id = String(ticketId ?? "").trim()
  const base = getTicketScanOrigin()
  const baseForUrl = base.endsWith("/") ? base.slice(0, -1) : base
  const url = new URL("/scan", `${baseForUrl}/`)
  url.searchParams.set("ticket_id", id)
  return url.toString()
}
