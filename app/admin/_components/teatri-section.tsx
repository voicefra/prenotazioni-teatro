"use client"

import { useCallback, useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { logSupabaseDev } from "./admin-shared"

const TEATRI_SELECT = "id, nome_teatro, indirizzo, comune, telefono, numero_file, posti_per_fila" as const

export interface TeatroRow {
  id: string
  nome_teatro: string
  indirizzo: string | null
  comune: string | null
  telefono: string | null
  numero_file: number
  posti_per_fila: number
}

export function TeatriSection() {
  const [rows, setRows] = useState<TeatroRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const [nome, setNome] = useState("")
  const [indirizzo, setIndirizzo] = useState("")
  const [comune, setComune] = useState("")
  const [telefono, setTelefono] = useState("")
  const [numeroFile, setNumeroFile] = useState("10")
  const [postiPerFila, setPostiPerFila] = useState("12")

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: qErr } = await supabase.from("teatri").select(TEATRI_SELECT).order("nome_teatro", { ascending: true })
    if (qErr) {
      logSupabaseDev("teatri load", qErr)
      setError(qErr.message)
      setRows([])
    } else {
      setRows((data ?? []) as TeatroRow[])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const resetForm = () => {
    setEditingId(null)
    setNome("")
    setIndirizzo("")
    setComune("")
    setTelefono("")
    setNumeroFile("10")
    setPostiPerFila("12")
  }

  const startEdit = (row: TeatroRow) => {
    setEditingId(row.id)
    setNome(row.nome_teatro)
    setIndirizzo(row.indirizzo ?? "")
    setComune(row.comune ?? "")
    setTelefono(row.telefono ?? "")
    setNumeroFile(String(row.numero_file))
    setPostiPerFila(String(row.posti_per_fila))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)

    const nf = Number.parseInt(numeroFile, 10)
    const pp = Number.parseInt(postiPerFila, 10)

    if (!nome.trim()) {
      setError("Inserisci il nome del teatro.")
      setSaving(false)
      return
    }
    if (!Number.isFinite(nf) || nf < 1 || nf > 26) {
      setError("Numero file: tra 1 e 26.")
      setSaving(false)
      return
    }
    if (!Number.isFinite(pp) || pp < 1) {
      setError("Posti per fila: numero positivo.")
      setSaving(false)
      return
    }

    const payload = {
      nome_teatro: nome.trim(),
      indirizzo: indirizzo.trim() || null,
      comune: comune.trim() || null,
      telefono: telefono.trim() || null,
      numero_file: nf,
      posti_per_fila: pp,
    }

    if (editingId) {
      const { error: upErr } = await supabase.from("teatri").update(payload).eq("id", editingId)
      if (upErr) {
        logSupabaseDev("teatri update", upErr)
        setError(upErr.message)
        setSaving(false)
        return
      }
    } else {
      const { error: insErr } = await supabase.from("teatri").insert(payload)
      if (insErr) {
        logSupabaseDev("teatri insert", insErr)
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
    if (!window.confirm("Eliminare questo teatro? Potrebbe essere ancora collegato a spettacoli.")) return
    setError(null)
    const { error: delErr } = await supabase.from("teatri").delete().eq("id", id)
    if (delErr) {
      logSupabaseDev("teatri delete", delErr)
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
          <CardTitle>{editingId ? "Modifica teatro" : "Nuovo teatro"}</CardTitle>
          <CardDescription>
            Tabella <code className="text-xs">teatri</code>: nome_teatro, indirizzo, comune, telefono, numero_file,
            posti_per_fila.
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
                <label htmlFor="t-nome" className="mb-1 block text-sm font-medium">
                  Nome teatro
                </label>
                <input
                  id="t-nome"
                  type="text"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  required
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="t-indirizzo" className="mb-1 block text-sm font-medium">
                    Indirizzo
                  </label>
                  <input
                    id="t-indirizzo"
                    type="text"
                    value={indirizzo}
                    onChange={(e) => setIndirizzo(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    placeholder="Via Roma 10"
                  />
                </div>
                <div>
                  <label htmlFor="t-comune" className="mb-1 block text-sm font-medium">
                    Comune
                  </label>
                  <input
                    id="t-comune"
                    type="text"
                    value={comune}
                    onChange={(e) => setComune(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    placeholder="Milano"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="t-telefono" className="mb-1 block text-sm font-medium">
                  Telefono
                </label>
                <input
                  id="t-telefono"
                  type="text"
                  value={telefono}
                  onChange={(e) => setTelefono(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  placeholder="+39 02 1234567"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="t-file" className="mb-1 block text-sm font-medium">
                    Numero file (1–26)
                  </label>
                  <input
                    id="t-file"
                    type="number"
                    min={1}
                    max={26}
                    value={numeroFile}
                    onChange={(e) => setNumeroFile(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="t-posti" className="mb-1 block text-sm font-medium">
                    Posti per fila
                  </label>
                  <input
                    id="t-posti"
                    type="number"
                    min={1}
                    value={postiPerFila}
                    onChange={(e) => setPostiPerFila(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    required
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={saving}>
                  {saving ? "Salvataggio…" : editingId ? "Aggiorna teatro" : "Crea teatro"}
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
          <CardTitle>Elenco teatri</CardTitle>
          <CardDescription>Gestisci le sale registrate.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 && !loading ? (
            <p className="text-sm text-muted-foreground">Nessun teatro.</p>
          ) : (
            <ul className="space-y-2">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-col gap-2 rounded-lg border border-border/80 bg-muted/15 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <span className="font-medium text-foreground">{row.nome_teatro}</span>
                    <span className="ml-2 text-sm text-muted-foreground">
                      {row.numero_file} file × {row.posti_per_fila} posti
                    </span>
                    <p className="text-sm text-muted-foreground">
                      {row.indirizzo && row.comune ? `${row.indirizzo}, ${row.comune}` : "Dati non disponibili"}
                    </p>
                    <p className="text-sm text-muted-foreground">Tel: {row.telefono?.trim() ? row.telefono : "Dati non disponibili"}</p>
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
