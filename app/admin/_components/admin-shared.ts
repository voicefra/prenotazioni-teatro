import { formatTimeHHmm } from "@/lib/datetime-format"
import { supabase } from "@/lib/supabase"

export const STORAGE_BUCKET_LOCANDINE = "locandine"
export const MAX_LOCANDINA_BYTES = 2 * 1024 * 1024
export const POSTI_CHUNK = 200

export function logSupabaseDev(context: string, err: unknown) {
  if (process.env.NODE_ENV === "development") {
    console.warn(`[admin] ${context}`, err)
  }
}

export function parseEuroInput(s: string): number | null {
  const t = s.trim().replace(",", ".")
  if (t === "") return null
  const n = Number.parseFloat(t)
  return Number.isFinite(n) ? n : null
}

export function formatOrarioFromDatetimeLocal(isoLocal: string): string {
  return formatTimeHHmm(isoLocal)
}

/** data_evento ISO → valore per input datetime-local (locale) */
export function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  const y = d.getFullYear()
  const m = pad(d.getMonth() + 1)
  const day = pad(d.getDate())
  const h = pad(d.getHours())
  const min = pad(d.getMinutes())
  return `${y}-${m}-${day}T${h}:${min}`
}

export async function uploadLocandinaFileToBucket(
  file: File,
): Promise<{ publicUrl: string; path: string } | { error: string }> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg"
  const safeExt = /^[a-z0-9]+$/.test(ext) ? ext : "jpg"
  const path = `spettacoli/${Date.now()}-${crypto.randomUUID()}.${safeExt}`

  const { data: uploadData, error: upErr } = await supabase.storage.from(STORAGE_BUCKET_LOCANDINE).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || `image/${safeExt}`,
  })

  if (upErr) return { error: upErr.message }

  const uploadedPath = uploadData?.path
  if (!uploadedPath) return { error: "Upload completato ma path mancante nella risposta." }

  const { data: pub } = supabase.storage.from(STORAGE_BUCKET_LOCANDINE).getPublicUrl(uploadedPath)
  const publicUrl = pub.publicUrl
  if (!publicUrl) return { error: "Impossibile calcolare l'URL pubblico." }

  return { publicUrl, path: uploadedPath }
}
