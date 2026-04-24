"use client"

import Link from "next/link"
import { useEffect, useState, Suspense, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { formatTimeHHmm } from "@/lib/datetime-format"

interface ReplicaBase {
  id: number | string
  spettacolo_id: string
  data_evento_label: string
  orario_label: string
  sort_ts: number
}

interface Replica extends ReplicaBase {
  /** true se prenotazioni pagate >= posti totali teatro */
  isSoldOut: boolean
}

interface Spettacolo {
  id: number | string
  nome_spettacolo: string
  ente_organizzatore: string | null
  nome_teatro: string | null
  locandina_url: string | null
  repliche: Replica[]
}

interface TeatroRow {
  id: string
  nome_teatro: string | null
  numero_file: number
  posti_per_fila: number
}

const FISCAL_DISCLAIMER =
  "Si tiene a precisare che il suddetto portale web che viene utilizzato non opera come Sistema di Biglietteria Automatizzata ai sensi del Provvedimento Agenzia Entrate del 23/07/2001, in quanto non emette alcun Titolo di Accesso fiscale. Il portale è un mero strumento di e-commerce per la prenotazione e il pagamento anticipato. L'assolvimento degli obblighi fiscali e del diritto d'autore per l'accesso allo spettacolo avverrà tramite l'emissione di regolari Titoli di Accesso fiscali premarcati SIAE, che avverrà direttamente in biglietteria, il giorno dello spettacolo, presentando al personale addetto, il voucher di prenotazione che verrà inviato sulla mail. Gli incassi verranno quindi regolarmente rendicontati tramite Modello C1."

function capienzaTeatro(teatro: TeatroRow | null): number {
  if (!teatro) return 0
  const nf = Math.floor(Number(teatro.numero_file))
  const pp = Math.floor(Number(teatro.posti_per_fila))
  if (!Number.isFinite(nf) || !Number.isFinite(pp) || nf < 1 || pp < 1) return 0
  return nf * pp
}

function formatDataEventoItDateOnly(raw: unknown): string {
  const s = String(raw ?? "").trim()
  if (!s) return ""
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  const formatted = d.toLocaleDateString("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })
  if (!formatted) return s
  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
}

function mapReplicaRow(replica: Record<string, unknown>): ReplicaBase | null {
  const id = String(replica.id ?? "").trim()
  const spettacoloId = String(replica.spettacolo_id ?? "").trim()
  if (!id || !spettacoloId) return null

  const dataEvento = replica.data_evento
  const orarioCol = replica.orario
  const ts = Date.parse(String(dataEvento ?? ""))
  const dataLabel = formatDataEventoItDateOnly(dataEvento)
  const timeFromOrario =
    orarioCol != null && String(orarioCol).trim() !== ""
      ? formatTimeHHmm(orarioCol)
      : formatTimeHHmm(dataEvento)

  return {
    id,
    spettacolo_id: spettacoloId,
    data_evento_label: dataLabel || "(data non impostata)",
    orario_label: timeFromOrario || "—",
    sort_ts: Number.isNaN(ts) ? Number.MAX_SAFE_INTEGER : ts,
  }
}

function SpettacoliContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const completionHandledRef = useRef(false)

  const [spettacoli, setSpettacoli] = useState<Spettacolo[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (completionHandledRef.current) return
    if (searchParams.get("prenotazione") !== "completata") return
    completionHandledRef.current = true
    alert("Prenotazione completata con successo!")
    router.replace("/spettacoli", { scroll: false })
  }, [searchParams, router])

  useEffect(() => {
    const loadSpettacoli = async () => {
      setIsLoading(true)
      setError(null)

      const { data: spettacoliData, error: spettacoliError } = await supabase
        .from("spettacoli")
        .select("*")
        .order("nome_spettacolo", { ascending: true })

      if (spettacoliError) {
        const supabaseError = spettacoliError
        console.error("[spettacoli] Errore Supabase completo (spettacoli):", supabaseError)
        try {
          console.error(
            "[spettacoli] Errore Supabase JSON (spettacoli):",
            JSON.stringify(supabaseError, Object.getOwnPropertyNames(Object(supabaseError)), 2),
          )
        } catch {
          // noop
        }
        setError("Non riesco a caricare gli spettacoli. Riprova tra poco.")
        setIsLoading(false)
        return
      }

      const { data: teatriData, error: teatriError } = await supabase
        .from("teatri")
        .select("*")

      if (teatriError) {
        const supabaseError = teatriError
        console.error("[spettacoli] Errore Supabase completo (teatri):", supabaseError)
        try {
          console.error(
            "[spettacoli] Errore Supabase JSON (teatri):",
            JSON.stringify(supabaseError, Object.getOwnPropertyNames(Object(supabaseError)), 2),
          )
        } catch {
          // noop
        }
        setError("Non riesco a caricare i teatri. Riprova tra poco.")
        setIsLoading(false)
        return
      }

      const spettacoliRows = (spettacoliData ?? []) as Record<string, unknown>[]
      const teatriRows = (teatriData ?? []) as Record<string, unknown>[]
      const teatriMap = teatriRows.reduce((acc, row) => {
        const id = String(row.id ?? "").trim()
        if (!id) return acc
        const nf = Number(row.numero_file ?? 0)
        const pp = Number(row.posti_per_fila ?? 0)
        acc.set(id, {
          id,
          nome_teatro: row.nome_teatro != null ? String(row.nome_teatro) : null,
          numero_file: Number.isFinite(nf) ? nf : 0,
          posti_per_fila: Number.isFinite(pp) ? pp : 0,
        } satisfies TeatroRow)
        return acc
      }, new Map<string, TeatroRow>())
      const spettacoloIds = spettacoliRows.map((row) => String(row.id ?? "").trim()).filter(Boolean)

      let replicheBySpettacolo = new Map<string, ReplicaBase[]>()
      if (spettacoloIds.length > 0) {
        const { data: replicheData, error: replicheError } = await supabase
          .from("repliche")
          .select("id, spettacolo_id, data_evento, orario")
          .in("spettacolo_id", spettacoloIds)

        if (replicheError) {
          const supabaseError = replicheError
          console.error("[spettacoli] Errore Supabase completo (repliche):", supabaseError)
          try {
            console.error(
              "[spettacoli] Errore Supabase JSON (repliche):",
              JSON.stringify(supabaseError, Object.getOwnPropertyNames(Object(supabaseError)), 2),
            )
          } catch {
            // noop
          }
          setError("Non riesco a caricare le repliche. Riprova tra poco.")
          setIsLoading(false)
          return
        }

        const mappedRepliche = ((replicheData ?? []) as Record<string, unknown>[])
          .map((replicaRow) => mapReplicaRow(replicaRow))
          .filter(Boolean) as ReplicaBase[]
        mappedRepliche.sort((a, b) => a.sort_ts - b.sort_ts)
        replicheBySpettacolo = mappedRepliche.reduce((acc, replica) => {
          const key = replica.spettacolo_id
          const list = acc.get(key) ?? []
          list.push(replica)
          acc.set(key, list)
          return acc
        }, new Map<string, Replica[]>())
      }

      /** Conteggio prenotazioni pagate per replica (1 riga = 1 posto venduto). */
      const paidCountByReplica = new Map<string, number>()
      const allReplicaIds = [...new Set([...replicheBySpettacolo.values()].flat().map((r) => r.id))]
      if (allReplicaIds.length > 0) {
        const CHUNK = 150
        for (let i = 0; i < allReplicaIds.length; i += CHUNK) {
          const chunk = allReplicaIds.slice(i, i + CHUNK)
          const { data: prenData, error: prenError } = await supabase
            .from("prenotazioni")
            .select("replica_id")
            .eq("stato_pagamento", "paid")
            .in("replica_id", chunk)

          if (prenError) {
            const supabaseError = prenError
            console.error("[spettacoli] Errore Supabase completo (prenotazioni sold-out):", supabaseError)
            try {
              console.error(
                "[spettacoli] Errore Supabase JSON (prenotazioni):",
                JSON.stringify(supabaseError, Object.getOwnPropertyNames(Object(supabaseError)), 2),
              )
            } catch {
              // noop
            }
            setError("Non riesco a verificare la disponibilità delle repliche. Riprova tra poco.")
            setIsLoading(false)
            return
          }
          for (const row of (prenData ?? []) as { replica_id?: string | number }[]) {
            const rid = String(row.replica_id ?? "").trim()
            if (!rid) continue
            paidCountByReplica.set(rid, (paidCountByReplica.get(rid) ?? 0) + 1)
          }
        }
      }

      const mapped = spettacoliRows.map((row) => {
        const spettacoloId = String(row.id ?? "")
        const teatroId = String(row.teatro_id ?? "").trim()
        const teatro = teatriMap.get(teatroId) ?? null
        const capienza = capienzaTeatro(teatro)

        const replicheRaw = replicheBySpettacolo.get(spettacoloId) ?? []
        const repliche: Replica[] = replicheRaw.map((rep) => {
          const paid = paidCountByReplica.get(String(rep.id)) ?? 0
          const isSoldOut = capienza > 0 && paid >= capienza
          return { ...rep, isSoldOut }
        })

        return {
          id: spettacoloId,
          nome_spettacolo: String(row.nome_spettacolo ?? "Spettacolo"),
          ente_organizzatore: row.ente_organizzatore ? String(row.ente_organizzatore) : null,
          nome_teatro: teatro?.nome_teatro ?? null,
          locandina_url: row.locandina_url ? String(row.locandina_url) : null,
          repliche,
        }
      })

      setSpettacoli(mapped)
      setIsLoading(false)
    }

    void loadSpettacoli()
  }, [])

  return (
    <main className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 md:py-12">
        <div className="mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Scegli il tuo spettacolo</h1>
          <p className="text-sm md:text-base text-muted-foreground mt-2">
            Seleziona uno spettacolo per iniziare la prenotazione.
          </p>
          <small className="mt-3 block text-xs leading-relaxed text-muted-foreground">{FISCAL_DISCLAIMER}</small>
        </div>

        {isLoading && (
          <div className="rounded-xl border border-border bg-card/50 p-6 text-sm text-muted-foreground">
            Caricamento spettacoli...
          </div>
        )}

        {!isLoading && error && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
            {error}
          </div>
        )}

        {!isLoading && !error && spettacoli.length === 0 && (
          <div className="rounded-xl border border-border bg-card/50 p-6 text-sm text-muted-foreground">
            Nessuno spettacolo disponibile al momento.
          </div>
        )}

        {!isLoading && !error && spettacoli.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {spettacoli.map((spettacolo) => (
              <article
                key={spettacolo.id}
                className="rounded-2xl overflow-hidden border border-border bg-card/30 flex h-full flex-col"
              >
                <div className="w-full p-4 pb-0">
                  <div className="h-80 w-full overflow-hidden rounded-xl bg-muted/30">
                    {spettacolo.locandina_url ? (
                      <img
                        src={spettacolo.locandina_url}
                        alt={`Locandina ${spettacolo.nome_spettacolo}`}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
                        Nessuna locandina
                      </div>
                    )}
                  </div>
                </div>

                <div className="p-4 flex-1 flex flex-col">
                  <div className="min-h-28 space-y-2">
                    <h2 className="max-h-16 overflow-hidden text-xl font-bold text-foreground">
                      {spettacolo.nome_spettacolo}
                    </h2>
                    {spettacolo.nome_teatro && (
                      <p className="truncate text-sm text-muted-foreground">
                        <span className="font-semibold text-foreground">Teatro:</span> {spettacolo.nome_teatro}
                      </p>
                    )}
                    {spettacolo.ente_organizzatore && (
                      <p className="truncate text-sm text-muted-foreground">
                        <span className="font-semibold text-foreground">Organizzato da:</span>{" "}
                        {spettacolo.ente_organizzatore}
                      </p>
                    )}
                  </div>

                  <div className="mt-4 flex-1">
                    <h3 className="text-sm font-medium text-foreground">Date disponibili</h3>

                    {spettacolo.repliche.length === 0 ? (
                      <p className="mt-1 text-sm text-muted-foreground">Nessuna replica disponibile.</p>
                    ) : (
                      <ul className="mt-2 space-y-2">
                        {spettacolo.repliche.map((replica) => (
                          <li
                            key={replica.id}
                            className="rounded-lg border border-border/60 p-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
                          >
                            <div className="text-sm text-muted-foreground min-w-0 flex-1 space-y-1">
                              <p>
                                <span className="font-semibold text-foreground">Data:</span>{" "}
                                {replica.data_evento_label}
                              </p>
                              <p>
                                <span className="font-semibold text-foreground">Orario:</span>{" "}
                                {replica.orario_label}
                              </p>
                            </div>
                            {replica.isSoldOut ? (
                              <span
                                className="inline-flex shrink-0 cursor-not-allowed select-none items-center justify-center self-start rounded-md bg-zinc-700 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-100 sm:self-center"
                                aria-disabled="true"
                              >
                                SOLD OUT
                              </span>
                            ) : (
                              <Link
                                href={`/?replica_id=${encodeURIComponent(String(replica.id))}`}
                                className="inline-flex shrink-0 items-center justify-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 self-start sm:self-center"
                              >
                                Prenota Ora
                              </Link>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
      <footer className="border-t border-border/60 bg-card/20 px-4 py-4">
        <div className="container mx-auto">
          <small className="block text-xs leading-relaxed text-muted-foreground">{FISCAL_DISCLAIMER}</small>
        </div>
      </footer>
    </main>
  )
}

export default function SpettacoliPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-background">
          <div className="container mx-auto px-4 py-12 text-sm text-muted-foreground">Caricamento...</div>
        </main>
      }
    >
      <SpettacoliContent />
    </Suspense>
  )
}
