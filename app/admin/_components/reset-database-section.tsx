"use client"

import { useCallback, useEffect, useState } from "react"
import { adminReset, type AdminResetResult } from "../actions"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { formatTimeHHmm } from "@/lib/datetime-format"
import { supabase } from "@/lib/supabase"
import { logSupabaseDev } from "./admin-shared"

const TABLES = [
  { id: "prenotazioni", label: "prenotazioni" },
  { id: "posti", label: "posti" },
  { id: "repliche", label: "repliche" },
  { id: "spettacoli", label: "spettacoli" },
  { id: "teatri", label: "teatri" },
] as const

type ResetMode = "global" | "selective"

interface SpettacoloOpt {
  id: string
  nome_spettacolo: string
}

interface ReplicaOpt {
  id: string
  data_evento: string | null
  orario: string | null
}

export function ResetDatabaseSection() {
  const [resetMode, setResetMode] = useState<ResetMode>("global")
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [confirmationText, setConfirmationText] = useState("")
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null)

  const [spettacoli, setSpettacoli] = useState<SpettacoloOpt[]>([])
  const [repliche, setRepliche] = useState<ReplicaOpt[]>([])
  const [loadingSpettacoli, setLoadingSpettacoli] = useState(true)
  const [loadingRepliche, setLoadingRepliche] = useState(false)
  const [spettacoloId, setSpettacoloId] = useState("")
  const [replicaId, setReplicaId] = useState("")

  const loadSpettacoli = useCallback(async () => {
    setLoadingSpettacoli(true)
    const { data, error: qErr } = await supabase
      .from("spettacoli")
      .select("id, nome_spettacolo")
      .order("nome_spettacolo", { ascending: true })

    if (qErr) {
      logSupabaseDev("reset-db spettacoli", qErr)
      setSpettacoli([])
    } else {
      setSpettacoli((data ?? []) as SpettacoloOpt[])
    }
    setLoadingSpettacoli(false)
  }, [])

  const loadRepliche = useCallback(async (sid: string) => {
    if (!sid) {
      setRepliche([])
      return
    }
    setLoadingRepliche(true)
    const { data, error: qErr } = await supabase
      .from("repliche")
      .select("id, data_evento, orario")
      .eq("spettacolo_id", sid)
      .order("data_evento", { ascending: true })

    if (qErr) {
      logSupabaseDev("reset-db repliche", qErr)
      setRepliche([])
    } else {
      setRepliche((data ?? []) as ReplicaOpt[])
    }
    setLoadingRepliche(false)
  }, [])

  useEffect(() => {
    void loadSpettacoli()
  }, [loadSpettacoli])

  useEffect(() => {
    void loadRepliche(spettacoloId)
    setReplicaId("")
  }, [spettacoloId, loadRepliche])

  const selectedTables = TABLES.filter((t) => {
    if (resetMode === "selective" && t.id === "teatri") return false
    return selected[t.id]
  })

  const toggle = (id: string) => {
    if (resetMode === "selective" && id === "teatri") return
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }))
    setMessage(null)
  }

  const onModeChange = (value: string) => {
    const m = value === "selective" ? "selective" : "global"
    setResetMode(m)
    setMessage(null)
    if (m === "global") {
      setSpettacoloId("")
      setReplicaId("")
    }
    if (m === "selective") {
      setSelected((prev) => {
        const next = { ...prev }
        if (next.teatri) delete next.teatri
        return next
      })
    }
  }

  const buildConfirmMessage = (tables: string[]) => {
    if (resetMode === "global") {
      return (
        "ATTENZIONE: questa operazione elimina definitivamente i dati nelle tabelle selezionate (TRUNCATE).\n\n" +
        "Tabelle: " +
        tables.join(", ") +
        "\n\nConfermi?"
      )
    }
    const sp = spettacoli.find((s) => s.id === spettacoloId)?.nome_spettacolo ?? spettacoloId
    return (
      "ATTENZIONE: reset selettivo — DELETE delle righe legate alla replica scelta (nessun TRUNCATE globale).\n\n" +
      "Spettacolo: " +
      sp +
      "\nReplica: " +
      replicaId +
      "\nTabelle: " +
      tables.join(", ") +
      "\n\nConfermi?"
    )
  }

  const formatResult = (result: AdminResetResult): string => {
    if (!result.ok) return result.error
    if (result.mode === "global") {
      return `Reset globale completato. Tabelle svuotate: ${result.truncated.join(", ")}.`
    }
    return `Reset selettivo completato. Tabelle aggiornate: ${result.deleted.join(", ")}.`
  }

  const handleReset = async () => {
    if (running) return
    if (confirmationText !== "CONFERMA" || selectedTables.length === 0) return
    if (resetMode === "selective" && (spettacoloId.trim() === "" || replicaId.trim() === "")) return

    const tables = selectedTables.map((t) => t.id)

    const ok = window.confirm(buildConfirmMessage(tables))
    if (!ok) return

    setRunning(true)
    setMessage(null)

    const filter =
      resetMode === "selective"
        ? { spettacolo_id: spettacoloId.trim(), replica_id: replicaId.trim() }
        : null

    const result = await adminReset(tables, confirmationText, filter)

    if (!result.ok) {
      setMessage({ type: "err", text: result.error })
      setRunning(false)
      return
    }

    setMessage({ type: "ok", text: formatResult(result) })
    setSelected({})
    setConfirmationText("")
    if (resetMode === "selective") {
      setSpettacoloId("")
      setReplicaId("")
    }
    setRunning(false)
  }

  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle className="text-destructive">Manutenzione database</CardTitle>
        <CardDescription>
          <strong>Reset Database</strong> — globale (TRUNCATE) o selettivo (DELETE per spettacolo/replica). Operazione
          irreversibile. Visibile solo in questa pagina admin.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {message && (
          <div
            role="alert"
            className={
              message.type === "ok"
                ? "rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm"
                : "rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            }
          >
            {message.text}
          </div>
        )}

        <div className="space-y-3">
          <p className="text-sm font-medium text-foreground">Modalità</p>
          <RadioGroup value={resetMode} onValueChange={onModeChange} className="flex flex-col gap-3 sm:flex-row sm:gap-6">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="global" id="reset-mode-global" />
              <Label htmlFor="reset-mode-global" className="cursor-pointer font-normal">
                Reset globale (TRUNCATE)
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="selective" id="reset-mode-selective" />
              <Label htmlFor="reset-mode-selective" className="cursor-pointer font-normal">
                Reset selettivo (DELETE per replica)
              </Label>
            </div>
          </RadioGroup>
        </div>

        {resetMode === "selective" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="reset-spettacolo" className="mb-1 block text-sm font-medium">
                Seleziona spettacolo
              </label>
              <select
                id="reset-spettacolo"
                value={spettacoloId}
                onChange={(e) => {
                  setSpettacoloId(e.target.value)
                  setMessage(null)
                }}
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
              <label htmlFor="reset-replica" className="mb-1 block text-sm font-medium">
                Seleziona replica
              </label>
              <select
                id="reset-replica"
                value={replicaId}
                onChange={(e) => {
                  setReplicaId(e.target.value)
                  setMessage(null)
                }}
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
        )}

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-foreground">Tabelle interessate</legend>
          {resetMode === "selective" && (
            <p className="text-xs text-muted-foreground">
              In reset selettivo la tabella <span className="font-mono">teatri</span> non è disponibile (nessun filtro per
              replica). Se includi <span className="font-mono">spettacoli</span>, verrà eliminato l&apos;intero spettacolo
              (e i dati collegati, in base alle FK).
            </p>
          )}
          <ul className="space-y-2">
            {TABLES.map((t) => {
              const disabledSelective = resetMode === "selective" && t.id === "teatri"
              return (
                <li key={t.id} className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id={`reset-${t.id}`}
                    checked={Boolean(selected[t.id])}
                    onChange={() => toggle(t.id)}
                    disabled={disabledSelective}
                    className="size-4 rounded border-border disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <Label
                    htmlFor={`reset-${t.id}`}
                    className={
                      disabledSelective ? "cursor-not-allowed font-mono text-sm font-normal opacity-50" : "cursor-pointer font-mono text-sm font-normal"
                    }
                  >
                    {t.label}
                    {disabledSelective ? " (solo reset globale)" : ""}
                  </Label>
                </li>
              )
            })}
          </ul>
        </fieldset>

        <div className="space-y-2">
          <Label htmlFor="reset-confirm" className="text-sm font-medium">
            Per abilitare il pulsante, digita <span className="font-mono font-bold">CONFERMA</span>
          </Label>
          <input
            id="reset-confirm"
            type="text"
            value={confirmationText}
            onChange={(e) => {
              const nextText = e.target.value
              setConfirmationText(nextText)
              console.log("Testo inserito:", nextText)
              setMessage(null)
            }}
            autoComplete="off"
            placeholder="CONFERMA"
            className="w-full max-w-xs rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
          />
        </div>

        <div>
          <Button
            type="button"
            variant="destructive"
            disabled={confirmationText !== "CONFERMA" || selectedTables.length === 0}
            onClick={() => void handleReset()}
          >
            {running ? "Esecuzione…" : resetMode === "global" ? "Esegui reset globale" : "Esegui reset selettivo"}
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            Richiede la chiave <code className="text-[10px]">SUPABASE_SERVICE_ROLE_KEY</code> sul server e la funzione SQL{" "}
            <code className="text-[10px]">admin_reset</code> (vedi migration in <code className="text-[10px]">supabase/migrations</code>
            ).
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
