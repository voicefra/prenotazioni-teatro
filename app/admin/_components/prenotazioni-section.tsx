"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { formatTimeHHmm } from "@/lib/datetime-format"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { logSupabaseDev } from "./admin-shared"

interface SpettacoloOpt {
  id: string
  nome_spettacolo: string
}

interface ReplicaOpt {
  id: string
  data_evento: string | null
  orario: string | null
}

interface PrenotazioneRow {
  id: string | number
  spettacolo_id: string | null
  replica_id: string | null
  nome: string | null
  cognome: string | null
  email: string | null
  telefono: string | null
  posti_prenotati: unknown
  stato_pagamento: string | null
  stato_ingresso: string | null
}

type SortKey = "nome" | "cognome" | "email" | "posti" | "stato_ingresso"
type SortDirection = "asc" | "desc"

function formatPosti(raw: unknown): string {
  if (raw == null) return "—"
  if (Array.isArray(raw)) return raw.join(", ")
  if (typeof raw === "string") return raw
  try {
    return JSON.stringify(raw)
  } catch {
    return String(raw)
  }
}

function escapeCsvCell(value: string): string {
  if (value.includes('"') || value.includes(";") || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export function PrenotazioniSection() {
  const [spettacoli, setSpettacoli] = useState<SpettacoloOpt[]>([])
  const [repliche, setRepliche] = useState<ReplicaOpt[]>([])
  const [prenotazioni, setPrenotazioni] = useState<PrenotazioneRow[]>([])

  const [loadingSpettacoli, setLoadingSpettacoli] = useState(true)
  const [loadingRepliche, setLoadingRepliche] = useState(false)
  const [loadingPrenotazioni, setLoadingPrenotazioni] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [spettacoloId, setSpettacoloId] = useState("")
  const [replicaId, setReplicaId] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("nome")
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc")

  const loadSpettacoli = useCallback(async () => {
    setLoadingSpettacoli(true)
    setError(null)
    const { data, error: qErr } = await supabase
      .from("spettacoli")
      .select("id, nome_spettacolo")
      .order("nome_spettacolo", { ascending: true })

    if (qErr) {
      logSupabaseDev("prenotazioni tab spettacoli", qErr)
      setError(qErr.message)
      setSpettacoli([])
    } else {
      setSpettacoli((data ?? []) as SpettacoloOpt[])
    }
    setLoadingSpettacoli(false)
  }, [])

  useEffect(() => {
    void loadSpettacoli()
  }, [loadSpettacoli])

  const loadRepliche = useCallback(async (sid: string) => {
    if (!sid) {
      setRepliche([])
      return
    }
    setLoadingRepliche(true)
    setError(null)
    const { data, error: qErr } = await supabase
      .from("repliche")
      .select("id, data_evento, orario")
      .eq("spettacolo_id", sid)
      .order("data_evento", { ascending: true })

    if (qErr) {
      logSupabaseDev("prenotazioni tab repliche", qErr)
      setError(qErr.message)
      setRepliche([])
    } else {
      setRepliche((data ?? []) as ReplicaOpt[])
    }
    setLoadingRepliche(false)
  }, [])

  const loadPrenotazioni = useCallback(async (rid: string) => {
    if (!rid) {
      setPrenotazioni([])
      return
    }
    setLoadingPrenotazioni(true)
    setError(null)
    const { data, error: qErr } = await supabase
      .from("vw_prenotazioni_con_ingresso")
      .select("*")
      .eq("replica_id", rid)
      .order("id", { ascending: true })

    if (qErr) {
      logSupabaseDev("prenotazioni tab lista", qErr)
      setError(qErr.message)
      setPrenotazioni([])
    } else {
      setPrenotazioni(
        (data ?? []).map((r) => {
          const row = r as Record<string, unknown>
          return {
            id: String(row.id ?? ""),
            spettacolo_id: row.spettacolo_id != null ? String(row.spettacolo_id) : null,
            replica_id: row.replica_id != null ? String(row.replica_id) : null,
            nome: row.nome != null ? String(row.nome) : null,
            cognome: row.cognome != null ? String(row.cognome) : null,
            email: row.email != null ? String(row.email) : null,
            telefono: row.telefono != null ? String(row.telefono) : null,
            posti_prenotati: row.posti_prenotati ?? null,
            stato_pagamento: row.stato_pagamento != null ? String(row.stato_pagamento) : null,
            stato_ingresso: row.stato_ingresso != null ? String(row.stato_ingresso) : null,
          } satisfies PrenotazioneRow
        }),
      )
    }
    setLoadingPrenotazioni(false)
  }, [])

  const onSpettacoloChange = (id: string) => {
    setSpettacoloId(id)
    setReplicaId("")
    setPrenotazioni([])
    void loadRepliche(id)
  }

  const onReplicaChange = (id: string) => {
    setReplicaId(id)
    void loadPrenotazioni(id)
  }

  const spettacoloNome = useMemo(
    () => spettacoli.find((s) => s.id === spettacoloId)?.nome_spettacolo ?? "",
    [spettacoli, spettacoloId],
  )

  const replicaLabel = useMemo(() => {
    const r = repliche.find((x) => x.id === replicaId)
    if (!r) return ""
    const de = r.data_evento ? String(r.data_evento).slice(0, 10) : ""
    const or = formatTimeHHmm(r.orario ?? r.data_evento)
    return [de, or].filter(Boolean).join(" · ")
  }, [repliche, replicaId])

  const ingressoLabel = (raw: string | null): string => {
    const s = String(raw ?? "")
      .trim()
      .toLowerCase()
    if (!s) return "Non ancora entrato"
    if (s.includes("non") && s.includes("entrato")) return "Non ancora entrato"
    if (s === "true" || s === "1" || s === "yes") return "Entrato"
    if (s.includes("entrato")) return "Entrato"
    return "Non ancora entrato"
  }

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"))
      return
    }
    setSortKey(key)
    setSortDirection("asc")
  }

  const sortedPrenotazioni = useMemo(() => {
    const normalize = (value: string | null) => String(value ?? "").trim().toLocaleLowerCase("it-IT")
    const normalizePosti = (value: unknown) => formatPosti(value).trim().toLocaleLowerCase("it-IT")
    const ingressoOrder = (value: string | null) => {
      const label = ingressoLabel(value)
      return label === "Entrato" ? 1 : 0
    }

    const list = [...prenotazioni]
    list.sort((a, b) => {
      if (sortKey === "stato_ingresso") {
        const cmp = ingressoOrder(a.stato_ingresso) - ingressoOrder(b.stato_ingresso)
        return sortDirection === "asc" ? cmp : -cmp
      }

      if (sortKey === "posti") {
        const va = normalizePosti(a.posti_prenotati)
        const vb = normalizePosti(b.posti_prenotati)
        const cmp = va.localeCompare(vb, "it", { sensitivity: "base", numeric: true })
        return sortDirection === "asc" ? cmp : -cmp
      }

      const va = normalize(a[sortKey] as string | null)
      const vb = normalize(b[sortKey] as string | null)
      const cmp = va.localeCompare(vb, "it", { sensitivity: "base", numeric: true })
      return sortDirection === "asc" ? cmp : -cmp
    })
    return list
  }, [prenotazioni, sortDirection, sortKey])

  const sortArrow = (key: SortKey) => {
    if (sortKey !== key) return ""
    return sortDirection === "asc" ? " ▲" : " ▼"
  }

  const exportCsv = () => {
    if (prenotazioni.length === 0) {
      alert("Nessuna prenotazione da esportare.")
      return
    }
    const headers = ["Nome", "Cognome", "Email", "Telefono", "Posti", "Stato pagamento", "Stato ingresso"]
    const rows = sortedPrenotazioni.map((p) => [
      String(p.nome ?? ""),
      String(p.cognome ?? ""),
      String(p.email ?? ""),
      String(p.telefono ?? ""),
      formatPosti(p.posti_prenotati),
      String(p.stato_pagamento ?? ""),
      ingressoLabel(p.stato_ingresso),
    ])
    const lines = [
      headers.map(escapeCsvCell).join(";"),
      ...rows.map((line) => line.map((c) => escapeCsvCell(c)).join(";")),
    ]
    const bom = "\uFEFF"
    const blob = new Blob([bom + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `prenotazioni-vista-${spettacoloId || "export"}-${replicaId || "replica"}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const printElenco = () => {
    if (sortedPrenotazioni.length === 0) {
      alert("Nessuna prenotazione da stampare.")
      return
    }
    window.print()
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Gestione prenotazioni</CardTitle>
          <CardDescription>
            Seleziona uno spettacolo e una replica per visualizzare le prenotazioni associate.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="pre-spettacolo" className="mb-1 block text-sm font-medium">
                Spettacolo
              </label>
              <select
                id="pre-spettacolo"
                value={spettacoloId}
                onChange={(e) => onSpettacoloChange(e.target.value)}
                disabled={loadingSpettacoli}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
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
              <label htmlFor="pre-replica" className="mb-1 block text-sm font-medium">
                Replica
              </label>
              <select
                id="pre-replica"
                value={replicaId}
                onChange={(e) => onReplicaChange(e.target.value)}
                disabled={!spettacoloId || loadingRepliche}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="">{spettacoloId ? "— Seleziona una replica —" : "— Prima scegli lo spettacolo —"}</option>
                {repliche.map((r) => {
                  const de = r.data_evento ? String(r.data_evento).slice(0, 10) : ""
                  const or = formatTimeHHmm(r.orario ?? r.data_evento)
                  const label = [de, or].filter(Boolean).join(" · ") || `ID ${r.id}`
                  return (
                    <option key={r.id} value={r.id}>
                      {label}
                    </option>
                  )
                })}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {replicaId && (
        <Card className="print-area">
          <CardHeader>
            <CardTitle className="text-base">
              Prenotazioni
              {spettacoloNome && (
                <span className="block text-sm font-normal text-muted-foreground">
                  {spettacoloNome}
                  {replicaLabel ? ` · ${replicaLabel}` : ""}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loadingPrenotazioni ? (
              <p className="text-sm text-muted-foreground">Caricamento prenotazioni…</p>
            ) : sortedPrenotazioni.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nessuna prenotazione per questa replica.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border print:border-black">
                <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="px-3 py-2 font-medium">
                        <button type="button" className="inline-flex items-center hover:underline" onClick={() => toggleSort("nome")}>
                          Nome{sortArrow("nome")}
                        </button>
                      </th>
                      <th className="px-3 py-2 font-medium">
                        <button
                          type="button"
                          className="inline-flex items-center hover:underline"
                          onClick={() => toggleSort("cognome")}
                        >
                          Cognome{sortArrow("cognome")}
                        </button>
                      </th>
                      <th className="px-3 py-2 font-medium">
                        <button type="button" className="inline-flex items-center hover:underline" onClick={() => toggleSort("email")}>
                          Email{sortArrow("email")}
                        </button>
                      </th>
                      <th className="px-3 py-2 font-medium">Telefono</th>
                      <th className="px-3 py-2 font-medium">
                        <button type="button" className="inline-flex items-center hover:underline" onClick={() => toggleSort("posti")}>
                          Posti{sortArrow("posti")}
                        </button>
                      </th>
                      <th className="px-3 py-2 font-medium">Stato pagamento</th>
                      <th className="px-3 py-2 font-medium">
                        <button
                          type="button"
                          className="inline-flex items-center hover:underline"
                          onClick={() => toggleSort("stato_ingresso")}
                        >
                          Stato ingresso{sortArrow("stato_ingresso")}
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPrenotazioni.map((p) => (
                      <tr key={String(p.id)} className="border-b border-border/60">
                        <td className="px-3 py-2">{p.nome ?? "—"}</td>
                        <td className="px-3 py-2">{p.cognome ?? "—"}</td>
                        <td className="px-3 py-2 break-all">{p.email ?? "—"}</td>
                        <td className="px-3 py-2">{p.telefono ?? "—"}</td>
                        <td className="px-3 py-2 text-xs">{formatPosti(p.posti_prenotati)}</td>
                        <td className="px-3 py-2">{p.stato_pagamento ?? "—"}</td>
                        <td className="px-3 py-2">{ingressoLabel(p.stato_ingresso)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex flex-wrap gap-2 print:hidden">
              <Button type="button" variant="secondary" onClick={exportCsv} disabled={sortedPrenotazioni.length === 0}>
                Esporta CSV
              </Button>
              <Button type="button" variant="outline" onClick={printElenco} disabled={sortedPrenotazioni.length === 0}>
                Stampa Elenco
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden !important;
            color: #000 !important;
            background: #fff !important;
            box-shadow: none !important;
          }
          .print-area,
          .print-area * {
            visibility: visible !important;
          }
          .print-area {
            position: absolute !important;
            inset: 0 !important;
            margin: 0 !important;
            border: 0 !important;
            width: 100% !important;
          }
          .print-area table,
          .print-area th,
          .print-area td {
            border-color: #000 !important;
          }
        }
      `}</style>
    </div>
  )
}
