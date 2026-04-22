"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { supabase } from "@/lib/supabase"
import { buildPostiGridForSpettacolo } from "@/lib/posti-grid"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  MAX_LOCANDINA_BYTES,
  POSTI_CHUNK,
  logSupabaseDev,
  parseEuroInput,
  uploadLocandinaFileToBucket,
} from "./admin-shared"
import type { TeatroRow } from "./teatri-section"

const SPETTACOLI_SELECT =
  "id, nome_spettacolo, ente_organizzatore, teatro_id, locandina_url, prezzo_biglietto, diritti_prevendita" as const
const TEATRI_SELECT = "id, nome_teatro, numero_file, posti_per_fila" as const

interface SpettacoloRow {
  id: string
  nome_spettacolo: string
  ente_organizzatore: string | null
  teatro_id: string | null
  locandina_url: string | null
  prezzo_biglietto: number | null
  diritti_prevendita: number | null
}

export function SpettacoliSection() {
  const [teatri, setTeatri] = useState<TeatroRow[]>([])
  const [spettacoli, setSpettacoli] = useState<SpettacoloRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const [teatroId, setTeatroId] = useState("")
  const [nome, setNome] = useState("")
  const [enteOrganizzatore, setEnteOrganizzatore] = useState("")
  const [prezzo, setPrezzo] = useState("15")
  const [diritti, setDiritti] = useState("2")
  const [locandinaUrl, setLocandinaUrl] = useState<string | null>(null)
  const [locandinaUploading, setLocandinaUploading] = useState(false)
  const [locandinaPath, setLocandinaPath] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    const [tRes, sRes] = await Promise.all([
      supabase.from("teatri").select(TEATRI_SELECT).order("nome_teatro", { ascending: true }),
      supabase.from("spettacoli").select(SPETTACOLI_SELECT).order("nome_spettacolo", { ascending: true }),
    ])

    const errs: string[] = []
    if (tRes.error) {
      logSupabaseDev("teatri load (spettacoli tab)", tRes.error)
      errs.push(tRes.error.message)
    } else {
      setTeatri((tRes.data ?? []) as TeatroRow[])
    }

    if (sRes.error) {
      logSupabaseDev("spettacoli load", sRes.error)
      errs.push(sRes.error.message)
      setSpettacoli([])
    } else {
      setSpettacoli((sRes.data ?? []) as SpettacoloRow[])
    }

    setError(errs.length ? errs.join(" · ") : null)

    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const resetForm = () => {
    setEditingId(null)
    setTeatroId("")
    setNome("")
    setEnteOrganizzatore("")
    setPrezzo("15")
    setDiritti("2")
    setLocandinaUrl(null)
    setLocandinaPath(null)
    if (fileRef.current) fileRef.current.value = ""
  }

  const startEdit = (row: SpettacoloRow) => {
    setEditingId(row.id)
    setTeatroId(row.teatro_id ?? "")
    setNome(row.nome_spettacolo)
    setEnteOrganizzatore(row.ente_organizzatore ?? "")
    setPrezzo(String(row.prezzo_biglietto ?? 15))
    setDiritti(String(row.diritti_prevendita ?? 2))
    setLocandinaUrl(row.locandina_url)
    setLocandinaPath(null)
    if (fileRef.current) fileRef.current.value = ""
  }

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    setError(null)
    setLocandinaUrl(null)
    setLocandinaPath(null)
    if (!file) return

    if (file.size > MAX_LOCANDINA_BYTES) {
      setError("Immagine troppo grande: massimo 2 MB.")
      e.target.value = ""
      return
    }
    if (!file.type.startsWith("image/")) {
      setError("Seleziona un file immagine.")
      e.target.value = ""
      return
    }

    setLocandinaUploading(true)
    const result = await uploadLocandinaFileToBucket(file)
    if ("error" in result) {
      setError(result.error)
      setLocandinaUploading(false)
      e.target.value = ""
      return
    }
    setLocandinaUrl(result.publicUrl)
    setLocandinaPath(result.path)
    setLocandinaUploading(false)
  }

  const clearLocandina = () => {
    setLocandinaUrl(null)
    setLocandinaPath(null)
    if (fileRef.current) fileRef.current.value = ""
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (locandinaUploading) {
      setError("Attendi il termine del caricamento della locandina.")
      return
    }

    setSaving(true)
    setError(null)

    if (!teatroId) {
      setError("Seleziona un teatro.")
      setSaving(false)
      return
    }
    if (!nome.trim()) {
      setError("Inserisci il nome dello spettacolo.")
      setSaving(false)
      return
    }

    const p = parseEuroInput(prezzo)
    const d = parseEuroInput(diritti)
    if (p == null || p < 0) {
      setError("Prezzo biglietto non valido.")
      setSaving(false)
      return
    }
    if (d == null || d < 0) {
      setError("Diritti di prevendita non validi.")
      setSaving(false)
      return
    }

    const teatro = teatri.find((t) => t.id === teatroId)
    if (!teatro) {
      setError("Teatro non trovato.")
      setSaving(false)
      return
    }

    const basePayload = {
      nome_spettacolo: nome.trim(),
      ente_organizzatore: enteOrganizzatore.trim() || null,
      teatro_id: teatroId,
      locandina_url: locandinaUrl,
      prezzo_biglietto: p,
      diritti_prevendita: d,
    }

    if (editingId) {
      const { error: upErr } = await supabase.from("spettacoli").update(basePayload).eq("id", editingId)
      if (upErr) {
        logSupabaseDev("spettacoli update", upErr)
        setError(upErr.message)
        setSaving(false)
        return
      }
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from("spettacoli")
        .insert(basePayload)
        .select("id")
        .single()

      if (insErr || !inserted?.id) {
        logSupabaseDev("spettacoli insert", insErr)
        setError(insErr?.message ?? "Errore creazione.")
        setSaving(false)
        return
      }

      const sid = String(inserted.id)
      const { count, error: cErr } = await supabase
        .from("posti")
        .select("id", { count: "exact", head: true })
        .eq("spettacolo_id", sid)
        .filter("replica_id", "is", null)

      if (!cErr && (count ?? 0) === 0) {
        const postiRows = buildPostiGridForSpettacolo(sid, teatro.numero_file, teatro.posti_per_fila)
        for (let i = 0; i < postiRows.length; i += POSTI_CHUNK) {
          const chunk = postiRows.slice(i, i + POSTI_CHUNK)
          const { error: pe } = await supabase.from("posti").insert(chunk)
          if (pe) {
            logSupabaseDev("posti insert", pe)
            setError(`Spettacolo creato ma errore posti: ${pe.message}`)
            setSaving(false)
            await load()
            return
          }
        }
      }
    }

    resetForm()
    await load()
    setSaving(false)
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm("Eliminare questo spettacolo? Verranno rimosse anche repliche/posti collegati se consentito dal database."))
      return
    setError(null)
    const { error: delErr } = await supabase.from("spettacoli").delete().eq("id", id)
    if (delErr) {
      logSupabaseDev("spettacoli delete", delErr)
      setError(delErr.message)
      return
    }
    if (editingId === id) resetForm()
    await load()
  }

  const teatroLabel = (tid: string | null) => {
    const t = teatri.find((x) => x.id === tid)
    return t ? t.nome_teatro : "—"
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{editingId ? "Modifica spettacolo" : "Nuovo spettacolo"}</CardTitle>
          <CardDescription>
            Prezzi in euro; locandina su Storage. In creazione, generazione posti se assenti.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          {loading ? (
            <p className="text-sm text-muted-foreground">Caricamento…</p>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div>
                <label htmlFor="s-teatro" className="mb-1 block text-sm font-medium">
                  Teatro
                </label>
                <select
                  id="s-teatro"
                  value={teatroId}
                  onChange={(e) => setTeatroId(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  required
                  disabled={teatri.length === 0}
                >
                  <option value="">— Seleziona —</option>
                  {teatri.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nome_teatro}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="s-nome" className="mb-1 block text-sm font-medium">
                  Nome spettacolo
                </label>
                <input
                  id="s-nome"
                  type="text"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  required
                />
              </div>
              <div>
                <label htmlFor="s-ente" className="mb-1 block text-sm font-medium">
                  Ente Organizzatore
                </label>
                <input
                  id="s-ente"
                  type="text"
                  value={enteOrganizzatore}
                  onChange={(e) => setEnteOrganizzatore(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  placeholder="Es. Associazione Culturale Teatro Vivo"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="s-prezzo" className="mb-1 block text-sm font-medium">
                    Prezzo biglietto (€)
                  </label>
                  <input
                    id="s-prezzo"
                    type="text"
                    inputMode="decimal"
                    value={prezzo}
                    onChange={(e) => setPrezzo(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="s-diritti" className="mb-1 block text-sm font-medium">
                    Diritti prevendita (€)
                  </label>
                  <input
                    id="s-diritti"
                    type="text"
                    inputMode="decimal"
                    value={diritti}
                    onChange={(e) => setDiritti(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    required
                  />
                </div>
              </div>
              <div>
                <label htmlFor="s-file" className="mb-1 block text-sm font-medium">
                  Locandina (immagine)
                </label>
                <input
                  ref={fileRef}
                  id="s-file"
                  type="file"
                  accept="image/*"
                  onChange={handleFile}
                  disabled={locandinaUploading || saving}
                  className="w-full max-w-md text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5"
                />
                <p className="mt-1 text-xs text-muted-foreground">Max 2 MB. Opzionale se modifichi senza cambiare immagine.</p>
                {locandinaUploading && (
                  <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground" role="status">
                    <span className="inline-block size-3 animate-pulse rounded-full bg-primary/70" />
                    Caricamento in corso…
                  </div>
                )}
                {locandinaUrl && !locandinaUploading && (
                  <div className="mt-3 flex flex-wrap gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={locandinaUrl} alt="" className="h-24 max-w-[160px] rounded border object-contain" />
                    <div className="min-w-0">
                      <p className="break-all text-xs text-muted-foreground">{locandinaUrl}</p>
                      {locandinaPath && (
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          Path: <code>{locandinaPath}</code>
                        </p>
                      )}
                      <Button type="button" variant="outline" size="sm" className="mt-2" onClick={clearLocandina}>
                        Rimuovi immagine
                      </Button>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={saving || locandinaUploading || teatri.length === 0}>
                  {saving ? "Salvataggio…" : editingId ? "Aggiorna spettacolo" : "Crea spettacolo"}
                </Button>
                {editingId && (
                  <Button type="button" variant="outline" onClick={resetForm}>
                    Annulla modifica
                  </Button>
                )}
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Elenco spettacoli</CardTitle>
        </CardHeader>
        <CardContent>
          {spettacoli.length === 0 && !loading ? (
            <p className="text-sm text-muted-foreground">Nessuno spettacolo.</p>
          ) : (
            <ul className="space-y-3">
              {spettacoli.map((row) => (
                <li
                  key={row.id}
                  className="rounded-lg border border-border/80 bg-muted/15 px-3 py-3 text-sm"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-medium text-foreground">{row.nome_spettacolo}</p>
                      <p className="text-muted-foreground">
                        Teatro: {teatroLabel(row.teatro_id)} · €{Number(row.prezzo_biglietto ?? 0).toFixed(2)} + €
                        {Number(row.diritti_prevendita ?? 0).toFixed(2)} prev.
                      </p>
                      {row.ente_organizzatore && (
                        <p className="text-muted-foreground">Organizzato da: {row.ente_organizzatore}</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" variant="secondary" size="sm" onClick={() => startEdit(row)}>
                        Modifica
                      </Button>
                      <Button type="button" variant="destructive" size="sm" onClick={() => void handleDelete(row.id)}>
                        Elimina
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
