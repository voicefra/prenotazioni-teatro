/**
 * Orario sempre in HH:mm (nessun secondo), per uso in tutta l'app.
 */

export function formatTimeHHmm(value: unknown): string {
  if (value == null) return ""
  const s = String(value).trim()
  if (!s) return ""

  const timeOnly = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?(?:\.\d+)?$/)
  if (timeOnly) {
    const h = Number.parseInt(timeOnly[1], 10)
    const m = Number.parseInt(timeOnly[2], 10)
    if (Number.isFinite(h) && Number.isFinite(m)) {
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
    }
  }

  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", hour12: false })
}
