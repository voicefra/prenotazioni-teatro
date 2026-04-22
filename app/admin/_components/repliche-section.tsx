"use client"

import { useCallback, useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { formatTimeHHmm } from "@/lib/datetime-format"
import { formatOrarioFromDatetimeLocal, logSupabaseDev, toDatetimeLocalValue } from "./admin-shared"

interface SpettacoloOpt {
  id: string
  nome_spettacolo: string
}

interface ReplicaRow {
  id: string
  spettacolo_id: string
  data_evento: string
  orario: string | null
  spettacoli?: { nome_spettacolo?: string | null } | { nome_spettacolo?: string | null }[] | null
}

export function ReplicheSection() {
  const [spettacoli, setSpettacoli] = useState<SpettacoloOpt[]>([])
  const [repliche, setRepliche] = useState<ReplicaRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const [spettacoloId, setSpettacoloId] = useState("")
  const [dataOra, setDataOra] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    const [spRes, repRes] = await Promise.all([
      supabase.from("spettacoli").select("id, nome_spettacolo").order("nome_spettacolo", { ascending: true }),
      supabase
        .from("repliche")
        .select("id, spettacolo_id, data_evento, orario, spettacoli ( nome_spettacolo )")
        .order("id", { ascending: false }),
    ])

    const errs: string[] = []
    if (spRes.error) {
      logSupabaseDev("spettacoli opt repliche", spRes.error)
      errs.push(spRes.error.message)
    } else {
      setSpettacoli((spRes.data ?? []) as SpettacoloOpt[])
    }

    if (repRes.error) {
      logSupabaseDev("repliche load", repRes.error)
      errs.push(repRes.error.message)
      setRepliche([])
    } else {
      setRepliche((repRes.data ?? []) as ReplicaRow[])
    }

    setError(errs.length ? errs.join(" · ") : null)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const nomeSpettacolo = (row: ReplicaRow) => {
    const n = row.spettacoli
    const o = Array.isArray(n) ? n[0] : n
    return o?.nome_spettacolo ? String(o.nome_spettacolo) : "—"
  }

  const resetForm = () => {
    setEditingId(null)
    setSpettacoloId("")
    setDataOra("")
  }

  const startEdit = (row: ReplicaRow) => {
    setEditingId(row.id)
    setSpettacoloId(row.spettacolo_id)
    setDataOra(toDatetimeLocalValue(row.data_evento))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)

    if (!spettacoloId) {
      setError("Seleziona uno spettacolo.")
      setSaving(false)
      return
    }
    if (!dataOra.trim()) {
      setError("Seleziona data e ora.")
      setSaving(false)
      return
    }

    const local = dataOra.trim()
    const dataEventoIso = local.length === 16 ? `${local}:00` : local
    const orario = formatOrarioFromDatetimeLocal(dataEventoIso)
    if (!orario) {
      setError("Data/ora non valida.")
      setSaving(false)
      return
    }

    const payload = {
      spettacolo_id: spettacoloId,
      data_evento: dataEventoIso,
      orario,
    }

    if (editingId) {
      const { error: upErr } = await supabase.from("repliche").update(payload).eq("id", editingId)
      if (upErr) {
        logSupabaseDev("repliche update", upErr)
        setError(upErr.message)
        setSaving(false)
        return
      }
    } else {
      const { error: insErr } = await supabase.from("repliche").insert(payload)
      if (insErr) {
        logSupabaseDev("repliche insert", insErr)
        setError(insErr.message)
        setSaving(false)
        return
      }
    }

    resetForm()
    await load()
    setSaving(false)
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm("Eliminare questa replica?")) return
    setError(null)
    const { error: delErr } = await supabase.from("repliche").delete().eq("id", id)
    if (delErr) {
      logSupabaseDev("repliche delete", delErr)
      setError(delErr.message)
      return
    }
    if (editingId === id) resetForm()
    await load()
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{editingId ? "Modifica replica" : "Nuova replica"}</CardTitle>
          <CardDescription>
            Collega una data/ora a uno spettacolo (<code className="text-xs">repliche</code>).
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
                <label htmlFor="r-sp" className="mb-1 block text-sm font-medium">
                  Spettacolo
                </label>
                <select
                  id="r-sp"
                  value={spettacoloId}
                  onChange={(e) => setSpettacoloId(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  required
                  disabled={spettacoli.length === 0}
                >
                  <option value="">— Seleziona uno spettacolo —</option>
                  {spettacoli.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nome_spettacolo}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="r-dt" className="mb-1 block text-sm font-medium">
                  Data e ora
                </label>
                <input
                  id="r-dt"
                  type="datetime-local"
                  value={dataOra}
                  onChange={(e) => setDataOra(e.target.value)}
                  className="w-full max-w-md rounded-md border border-border bg-background px-3 py-2 text-sm"
                  required
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={saving || spettacoli.length === 0}>
                  {saving ? "Salvataggio…" : editingId ? "Aggiorna replica" : "Aggiungi replica"}
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
          <CardTitle>Elenco repliche</CardTitle>
        </CardHeader>
        <CardContent>
          {repliche.length === 0 && !loading ? (
            <p className="text-sm text-muted-foreground">Nessuna replica.</p>
          ) : (
            <ul className="space-y-2">
              {repliche.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-col gap-2 rounded-lg border border-border/80 bg-muted/15 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="text-sm">
                    <span className="font-medium text-foreground">{nomeSpettacolo(row)}</span>
                    <span className="mx-2 text-muted-foreground">·</span>
                    <span className="text-muted-foreground">
                      {String(row.data_evento ?? "").slice(0, 10)} · {formatTimeHHmm(row.orario ?? row.data_evento) || "—"}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="secondary" size="sm" onClick={() => startEdit(row)}>
                      Modifica
                    </Button>
                    <Button type="button" variant="destructive" size="sm" onClick={() => void handleDelete(row.id)}>
                      Elimina
                    </Button>
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
