"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Stage } from "./stage"
import { SeatRow } from "./seat-row"
import { Cart } from "./cart"
import { Legend } from "./legend"
import type { SeatStatus } from "./seat"
import { formatTimeHHmm } from "@/lib/datetime-format"
import { supabase } from "@/lib/supabase"

interface Seat {
  id: string
  row: string
  number: number
  status: SeatStatus
  price: number
}

interface PostoRow {
  id: number | string
  numero_posto: string
  spettacolo_id?: number | string
  replica_id?: number | string
}

/** Riga repliche: nomi colonna tipici su Supabase (adatta se il tuo schema differisce). */
interface ReplicaRow {
  id: number | string
  spettacolo_id?: number | string
  id_spettacolo?: number | string
  show_id?: number | string
  data_evento?: string | null
  data?: string | null
  data_ora?: string | null
  orario?: string | null
}

interface SpettacoloHeaderRow {
  teatro_id?: number | string | null
  nome_spettacolo?: string | null
  ente_organizzatore?: string | null
  locandina_url?: string | null
  prezzo_biglietto?: number | null
  diritti_prevendita?: number | null
}

interface TeatroInfoRow {
  nome_teatro?: string | null
  indirizzo?: string | null
  comune?: string | null
  telefono?: string | null
}

interface PrenotazioneStatusRow {
  posti_prenotati: string[] | string | null
  stato_pagamento: "pending" | "paid" | "failed" | string
}

interface BookingFormData {
  nome: string
  cognome: string
  email: string
  telefono: string
}

interface PendingCheckoutData {
  seatsCodes: string[]
  replicaId: string
  customer: BookingFormData
  totalAmount: number
}

const PENDING_SEATS_KEY = "pending_seats"
const PENDING_CHECKOUT_DATA_KEY = "pending_checkout_data"

const TICKET_EMAIL_FALLBACK_ALERT =
  "Il pagamento è andato a buon fine, ma l'invio del biglietto ha riscontrato un problema. Controlla la tua email o contatta l'assistenza."

async function readSendTicketFailureDetails(res: Response): Promise<string> {
  const ct = (res.headers.get("content-type") || "").toLowerCase()
  try {
    if (ct.includes("application/json")) {
      const j = (await res.json()) as { error?: string; code?: string }
      const line = [j.code, j.error].filter(Boolean).join(" — ")
      return line || "(JSON senza messaggio)"
    }
    const text = await res.text()
    return text.slice(0, 2000) || "(corpo vuoto)"
  } catch (e) {
    return e instanceof Error ? e.message : "lettura risposta fallita"
  }
}

const initialFormData: BookingFormData = {
  nome: "",
  cognome: "",
  email: "",
  telefono: "",
}

const parseNumeroPosto = (numeroPosto: string) => {
  const match = numeroPosto.trim().match(/^([A-Za-z]+)[-\s]?(\d+)$/)
  if (match) {
    return {
      row: match[1].toUpperCase(),
      number: Number(match[2]),
    }
  }

  return {
    row: "A",
    number: Number(numeroPosto.replace(/\D/g, "")) || 0,
  }
}

const toSeatCode = (seat: Pick<Seat, "row" | "number">) => `${seat.row}${seat.number}`

const safeReadPendingSeats = (): string[] => {
  try {
    const raw = localStorage.getItem(PENDING_SEATS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((v) => String(v)).filter(Boolean)
  } catch {
    return []
  }
}

const safeReadPendingCheckoutData = (): PendingCheckoutData | null => {
  try {
    const raw = localStorage.getItem(PENDING_CHECKOUT_DATA_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw) as Partial<PendingCheckoutData>
    if (!parsed || !Array.isArray(parsed.seatsCodes) || !parsed.customer || !parsed.replicaId) {
      return null
    }

    return {
      seatsCodes: parsed.seatsCodes.map((v) => String(v)),
      replicaId: String(parsed.replicaId),
      customer: {
        nome: String(parsed.customer.nome ?? ""),
        cognome: String(parsed.customer.cognome ?? ""),
        email: String(parsed.customer.email ?? ""),
        telefono: String(parsed.customer.telefono ?? ""),
      },
      totalAmount: Number(parsed.totalAmount ?? 0),
    }
  } catch {
    return null
  }
}

const clearPendingStorage = () => {
  localStorage.removeItem(PENDING_SEATS_KEY)
  localStorage.removeItem(PENDING_CHECKOUT_DATA_KEY)
}

const removeQueryParams = (keys: string[]) => {
  const url = new URL(window.location.href)
  keys.forEach((k) => url.searchParams.delete(k))
  const next = `${url.pathname}${url.search}${url.hash}`
  window.history.replaceState({}, "", next)
}

/** PostgREST/Supabase: l'oggetto errore a volte serializza come {} con console.error — espone message/code/details/hint. */
function logSupabaseError(context: string, error: unknown) {
  console.log("Dettaglio errore:", error)
  if (error && typeof error === "object") {
    const o = error as Record<string, unknown>
    console.log(`${context} message:`, o.message)
    console.log(`${context} code:`, o.code)
    console.log(`${context} details:`, o.details)
    console.log(`${context} hint:`, o.hint)
  }
  try {
    console.log(`${context} JSON:`, JSON.stringify(error, Object.getOwnPropertyNames(Object(error)), 2))
  } catch {
    console.log(`${context} (non serializzabile)`)
  }
}

function pickSpettacoloIdFromReplica(row: ReplicaRow): string | null {
  const v = row.spettacolo_id ?? row.id_spettacolo ?? row.show_id
  if (v == null || v === "") return null
  return String(v)
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

function pickReplicaOrarioLabel(row: ReplicaRow): string {
  const fromCol = row.orario
  if (fromCol != null && String(fromCol).trim() !== "") {
    const t = formatTimeHHmm(fromCol)
    if (t) return t
  }
  return formatTimeHHmm(row.data_evento ?? row.data ?? row.data_ora)
}

function normalizeBookedSeats(value: string[] | string | null | undefined): string[] {
  if (Array.isArray(value)) return value.map((seat) => String(seat).trim()).filter(Boolean)
  if (value == null) return []
  const seat = String(value).trim()
  return seat ? [seat] : []
}

export function TheaterBooking() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const replicaId = searchParams.get("replica_id")

  const [seats, setSeats] = useState<Seat[]>([])
  const [isLoadingSeats, setIsLoadingSeats] = useState(true)
  const [selectedReplicaId, setSelectedReplicaId] = useState<string | null>(null)
  const [selectedSpettacoloId, setSelectedSpettacoloId] = useState<string | null>(null)
  const [selectedSpettacoloTitle, setSelectedSpettacoloTitle] = useState<string>("Spettacolo")
  const [selectedEnteOrganizzatore, setSelectedEnteOrganizzatore] = useState<string>("")
  const [teatroNome, setTeatroNome] = useState<string>("Dati non disponibili")
  const [teatroIndirizzo, setTeatroIndirizzo] = useState<string>("Dati non disponibili")
  const [teatroComune, setTeatroComune] = useState<string>("Dati non disponibili")
  const [teatroTelefono, setTeatroTelefono] = useState<string>("Dati non disponibili")
  /** Data replica (solo giorno, italiano) */
  const [bookingDateLabel, setBookingDateLabel] = useState<string>("")
  /** Orario: colonna orario oppure ricavato da data_evento */
  const [bookingOrarioLabel, setBookingOrarioLabel] = useState<string>("")
  const [prezzoBigliettoEur, setPrezzoBigliettoEur] = useState(15)
  const [dirittiPrevenditaEur, setDirittiPrevenditaEur] = useState(2)
  const [isDataModalOpen, setIsDataModalOpen] = useState(false)
  const [isSubmittingBooking, setIsSubmittingBooking] = useState(false)
  const [formData, setFormData] = useState<BookingFormData>(initialFormData)

  // Evita doppie esecuzioni in dev (React Strict Mode)
  const successHandledRef = useRef(false)
  const canceledHandledRef = useRef(false)

  const loadSeats = useCallback(async () => {
    if (!replicaId) {
      setSeats([])
      setIsLoadingSeats(false)
      return
    }

    setIsLoadingSeats(true)

    /**
     * 1) Replica: niente join annidato qui (se la FK o i nomi colonne non coincidono, la join fallisce o torna vuota).
     *    Usiamo select('*') per allinearci allo schema reale su Supabase.
     */
    const { data: replicaData, error: replicaError } = await supabase
      .from("repliche")
      .select("*")
      .eq("id", replicaId)
      .maybeSingle()

    if (replicaError) {
      logSupabaseError("[repliche]", replicaError)
      setSeats([])
      setIsLoadingSeats(false)
      return
    }

    if (!replicaData) {
      console.log(
        "[repliche] Nessuna riga per id=",
        replicaId,
        "(verifica RLS, tipo UUID vs testo, o che la replica esista)."
      )
      setSeats([])
      setIsLoadingSeats(false)
      return
    }

    const replica = replicaData as ReplicaRow
    const spettacoloId = pickSpettacoloIdFromReplica(replica)

    if (!spettacoloId) {
      console.log("[repliche] Impossibile ricavare l'ID spettacolo dalla riga:", replicaData)
      setSeats([])
      setIsLoadingSeats(false)
      return
    }

    setSelectedReplicaId(String(replica.id))
    setSelectedSpettacoloId(spettacoloId)

    const deRaw = replica.data_evento ?? replica.data ?? replica.data_ora
    setBookingDateLabel(formatDataEventoItDateOnly(deRaw) || "—")
    setBookingOrarioLabel(pickReplicaOrarioLabel(replica) || "—")

    const { data: spettacoloRow, error: spettacoloErr } = await supabase
      .from("spettacoli")
      .select("teatro_id, nome_spettacolo, ente_organizzatore, locandina_url, prezzo_biglietto, diritti_prevendita")
      .eq("id", spettacoloId)
      .maybeSingle()

    if (spettacoloErr) {
      logSupabaseError("[spettacoli]", spettacoloErr)
    }

    const show = (spettacoloRow ?? null) as SpettacoloHeaderRow | null
    setSelectedSpettacoloTitle(String(show?.nome_spettacolo ?? "Spettacolo"))
    setSelectedEnteOrganizzatore(String(show?.ente_organizzatore ?? "").trim())

    const teatroId = String(show?.teatro_id ?? "").trim()
    if (teatroId) {
      const { data: teatroRow, error: teatroErr } = await supabase
        .from("teatri")
        .select("nome_teatro, indirizzo, comune, telefono")
        .eq("id", teatroId)
        .maybeSingle()
      if (teatroErr) {
        logSupabaseError("[teatri]", teatroErr)
      }
      const teatro = (teatroRow ?? null) as TeatroInfoRow | null
      setTeatroNome(String(teatro?.nome_teatro ?? "").trim() || "Dati non disponibili")
      setTeatroIndirizzo(String(teatro?.indirizzo ?? "").trim() || "Dati non disponibili")
      setTeatroComune(String(teatro?.comune ?? "").trim() || "Dati non disponibili")
      setTeatroTelefono(String(teatro?.telefono ?? "").trim() || "Dati non disponibili")
    } else {
      setTeatroNome("Dati non disponibili")
      setTeatroIndirizzo("Dati non disponibili")
      setTeatroComune("Dati non disponibili")
      setTeatroTelefono("Dati non disponibili")
    }

    const prezzoPosto = (() => {
      const raw = show?.prezzo_biglietto
      const n = typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? ""))
      return Number.isFinite(n) && n >= 0 ? n : 15
    })()

    const dirittiPosto = (() => {
      const raw = show?.diritti_prevendita
      const n = typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? ""))
      return Number.isFinite(n) && n >= 0 ? n : 2
    })()

    setPrezzoBigliettoEur(prezzoPosto)
    setDirittiPrevenditaEur(dirittiPosto)

    /**
     * 2) Posti: priorità a replica_id (mappa per quella replica).
     *    Se la colonna non esiste o non ci sono righe, fallback su spettacolo_id (mappa unica per spettacolo).
     */
    let postiRows: PostoRow[] = []
    const byReplica = await supabase.from("posti").select("id, numero_posto").eq("replica_id", replicaId)

    if (byReplica.error) {
      logSupabaseError("[posti per replica_id]", byReplica.error)
    }

    if (!byReplica.error && byReplica.data && byReplica.data.length > 0) {
      postiRows = byReplica.data as PostoRow[]
      console.log("[posti] Caricati per replica_id=", replicaId, "count=", postiRows.length)
    } else {
      const byShow = await supabase.from("posti").select("id, numero_posto").eq("spettacolo_id", spettacoloId)

      if (byShow.error) {
        logSupabaseError("[posti per spettacolo_id]", byShow.error)
        setSeats([])
        setIsLoadingSeats(false)
        return
      }

      postiRows = (byShow.data ?? []) as PostoRow[]
      console.log(
        "[posti] Fallback spettacolo_id=",
        spettacoloId,
        "count=",
        postiRows.length,
        byReplica.error || !byReplica.data?.length
          ? "(replica_id assente, vuoto, o colonna diversa)"
          : ""
      )
    }

    const { data: statusRows, error: statusError } = await supabase
      .from("prenotazioni")
      .select("posti_prenotati, stato_pagamento")
      .eq("replica_id", replicaId)
      .in("stato_pagamento", ["pending", "paid"])

    if (statusError) {
      logSupabaseError("[prenotazioni disponibilità]", statusError)
      setIsLoadingSeats(false)
      return
    }

    const notFreeSeatCodes = new Set<string>()
    ;((statusRows ?? []) as PrenotazioneStatusRow[]).forEach((row) => {
      normalizeBookedSeats(row.posti_prenotati).forEach((seatCode) => {
        notFreeSeatCodes.add(String(seatCode).toUpperCase())
      })
    })

    const mappedSeats: Seat[] = postiRows.map((posto) => {
      const parsedSeat = parseNumeroPosto(posto.numero_posto)
      const seatCode = `${parsedSeat.row}${parsedSeat.number}`.toUpperCase()

      return {
        id: String(posto.id),
        row: parsedSeat.row,
        number: parsedSeat.number,
        status: notFreeSeatCodes.has(seatCode) ? "occupied" : "free",
        price: prezzoPosto,
      }
    })

    mappedSeats.sort((a, b) => {
      const rowCompare = a.row.localeCompare(b.row, undefined, { numeric: true })
      if (rowCompare !== 0) return rowCompare
      return a.number - b.number
    })

    setSeats(mappedSeats)
    setIsLoadingSeats(false)
  }, [replicaId])

  useEffect(() => {
    if (!replicaId) {
      router.replace("/spettacoli")
      return
    }
    loadSeats()
  }, [replicaId, router, loadSeats])

  // Gestione annullamento pagamento (?canceled=true)
  useEffect(() => {
    const handleCanceled = async () => {
      if (canceledHandledRef.current) return

      const params = new URLSearchParams(window.location.search)
      const isCanceled = params.get("canceled") === "true"
      if (!isCanceled) return

      canceledHandledRef.current = true

      const pendingSeatIds = safeReadPendingSeats()
      if (pendingSeatIds.length > 0) console.info("Checkout annullato, rilascio locale posti pending")

      clearPendingStorage()
      removeQueryParams(["canceled", "session_id"])
      await loadSeats()
      alert("Pagamento annullato, i posti sono tornati liberi")
    }

    void handleCanceled()
  }, [loadSeats])

  // Gestione successo pagamento (?success=true&session_id=...)
  useEffect(() => {
    const handleSuccess = async () => {
      if (successHandledRef.current) return

      const params = new URLSearchParams(window.location.search)
      const isSuccess = params.get("success") === "true"
      if (!isSuccess) return

      successHandledRef.current = true

      // session_id preso rigorosamente dall'URL di ritorno Stripe
      const stripeSessionId = (params.get("session_id") || "").trim()
      if (!stripeSessionId) {
        alert("Pagamento completato, ma manca session_id nell'URL. Contatta l'assistenza.")
        successHandledRef.current = false
        return
      }

      const pendingCheckoutData = safeReadPendingCheckoutData()
      const pendingReplicaId = pendingCheckoutData?.replicaId

      // 1) Legge righe già salvate per questa sessione
      const { data: existingBookings, error: checkError } = await supabase
        .from("prenotazioni")
        .select("id, posti_prenotati")
        .eq("stripe_session_id", stripeSessionId)
        .limit(1000)

      if (checkError) {
        logSupabaseError("[prenotazioni anti-duplicato]", checkError)
        alert("Errore durante il controllo anti-duplicato. Riprova.")
        successHandledRef.current = false
        return
      }

      // 2) Insert per posto: una riga prenotazione per ogni singolo seat code
      if (!pendingCheckoutData) {
        alert("Pagamento completato, ma dati prenotazione mancanti. Contatta l'assistenza.")
        successHandledRef.current = false
        return
      }

      const seatsToPersist = [...new Set(pendingCheckoutData.seatsCodes.map((seat) => String(seat).trim()).filter(Boolean))]
      const alreadyPersistedSeatCodes = new Set<string>()
      ;((existingBookings ?? []) as Array<{ posti_prenotati?: string[] | string | null }>).forEach((row) => {
        normalizeBookedSeats(row.posti_prenotati).forEach((seatCode) => {
          alreadyPersistedSeatCodes.add(String(seatCode).toUpperCase())
        })
      })
      const missingSeatCodes = seatsToPersist.filter((seatCode) => !alreadyPersistedSeatCodes.has(seatCode.toUpperCase()))

      if (missingSeatCodes.length > 0) {
        const rowsToInsert = missingSeatCodes.map((seatCode) => ({
          replica_id: pendingReplicaId,
          nome: pendingCheckoutData.customer.nome,
          cognome: pendingCheckoutData.customer.cognome,
          email: pendingCheckoutData.customer.email,
          telefono: pendingCheckoutData.customer.telefono,
          posti_prenotati: [seatCode],
          stripe_session_id: stripeSessionId,
          stato_pagamento: "paid",
        }))

        const { error: insertError } = await supabase.from("prenotazioni").insert(rowsToInsert)

        if (insertError) {
          const supaErr = insertError as {
            message?: string
            code?: string
            details?: string
            hint?: string
          }
          console.error("[prenotazioni insert post-pagamento] ERRORE ESATTO SUPABASE", {
            message: supaErr.message,
            code: supaErr.code,
            details: supaErr.details,
            hint: supaErr.hint,
            payloadRows: rowsToInsert.length,
            stripeSessionId,
            seats: missingSeatCodes,
          })
          logSupabaseError("[prenotazioni insert post-pagamento]", insertError)
          if (supaErr.code === "23505" && String(supaErr.details ?? "").includes("stripe_session_id")) {
            alert(
              "Pagamento completato ma salvataggio bloccato: vincolo UNIQUE su stripe_session_id. Rimuovi il vincolo dal DB per permettere una riga per ogni posto."
            )
            successHandledRef.current = false
            return
          }
          alert("Pagamento completato, ma salvataggio prenotazione non riuscito. Contatta assistenza.")
          successHandledRef.current = false
          return
        }
      }

      // 3) Invio biglietti via email (server-side) + idempotenza
      if (pendingCheckoutData) {
        try {
          const sendRes = await fetch("/api/send-ticket", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              session_id: stripeSessionId,
              replica_id: pendingCheckoutData.replicaId,
              customer: pendingCheckoutData.customer,
              seats: pendingCheckoutData.seatsCodes,
            }),
          })

          if (!sendRes.ok) {
            const details = await readSendTicketFailureDetails(sendRes)
            console.error("[send-ticket] risposta non OK", sendRes.status, details)
            alert(TICKET_EMAIL_FALLBACK_ALERT)
          } else {
            const ct = (sendRes.headers.get("content-type") || "").toLowerCase()
            if (!ct.includes("application/json")) {
              const preview = await sendRes.text().catch(() => "")
              console.error("[send-ticket] Content-Type inatteso (OK):", ct, preview.slice(0, 500))
              alert(TICKET_EMAIL_FALLBACK_ALERT)
            } else {
              try {
                const data = (await sendRes.json()) as { ok?: boolean; alreadySent?: boolean }
                if (!data?.ok && !data?.alreadySent) {
                  console.error("[send-ticket] JSON OK ma payload inatteso:", data)
                  alert(TICKET_EMAIL_FALLBACK_ALERT)
                }
              } catch (e) {
                console.error("[send-ticket] parse JSON fallito dopo OK HTTP:", e)
                alert(TICKET_EMAIL_FALLBACK_ALERT)
              }
            }
          }
        } catch (e) {
          console.error("[send-ticket] fetch o elaborazione fallita:", e)
          alert(TICKET_EMAIL_FALLBACK_ALERT)
        }
      }

      clearPendingStorage()
      removeQueryParams(["success", "session_id", "replica_id"])
      router.replace("/spettacoli?prenotazione=completata")
    }

    void handleSuccess()
  }, [loadSeats, router])

  // Selezione locale dei posti
  const handleSeatClick = useCallback((seatId: string) => {
    setSeats((currentSeats) =>
      currentSeats.map((seat) =>
        seat.id === seatId
          ? {
              ...seat,
              status:
                seat.status === "free"
                  ? "selected"
                  : seat.status === "selected"
                    ? "free"
                    : seat.status,
            }
          : seat
      )
    )
  }, [])

  const handleRemoveSeat = useCallback((seatId: string) => {
    setSeats((currentSeats) =>
      currentSeats.map((seat) => (seat.id === seatId ? { ...seat, status: "free" } : seat))
    )
  }, [])

  // Click su "Procedi al Pagamento" -> apre modulo dati
  const handleCheckout = useCallback(() => {
    const selectedCount = seats.filter((seat) => seat.status === "selected").length
    if (selectedCount === 0) {
      alert("Seleziona almeno un posto")
      return
    }

    setIsDataModalOpen(true)
  }, [seats])

  const handleFormInputChange = useCallback((field: keyof BookingFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }, [])

  const handleCloseModal = useCallback(() => {
    if (isSubmittingBooking) return
    setIsDataModalOpen(false)
  }, [isSubmittingBooking])

  const handleConfirmData = useCallback(async () => {
    const nome = formData.nome.trim()
    const cognome = formData.cognome.trim()
    const email = formData.email.trim()
    const telefono = formData.telefono.trim()

    if (!nome || !cognome || !email || !telefono) {
      alert("Compila tutti i campi richiesti")
      return
    }

    if (!selectedReplicaId) {
      alert("Replica non valida. Torna alla pagina spettacoli.")
      return
    }

    const selectedSnapshot = seats.filter((seat) => seat.status === "selected")
    const selectedSeatCodes = selectedSnapshot.map(toSeatCode)
    const n = selectedSnapshot.length
    const totalAmount =
      selectedSnapshot.reduce((sum, s) => sum + s.price, 0) + n * dirittiPrevenditaEur

    if (selectedSeatCodes.length === 0) {
      alert("Seleziona almeno un posto")
      setIsDataModalOpen(false)
      return
    }

    setIsSubmittingBooking(true)

    try {
      // 1) Verifica disponibilita aggiornata per la replica scelta
      const { data: statusRows, error: statusError } = await supabase
        .from("prenotazioni")
        .select("posti_prenotati, stato_pagamento")
        .eq("replica_id", selectedReplicaId)
        .in("stato_pagamento", ["pending", "paid"])

      if (statusError) {
        logSupabaseError("[prenotazioni verifica checkout]", statusError)
        alert("Errore durante la verifica dei posti. Riprova.")
        return
      }

      const notFreeSeatCodes = new Set<string>()
      ;((statusRows ?? []) as PrenotazioneStatusRow[]).forEach((row) => {
        normalizeBookedSeats(row.posti_prenotati).forEach((seatCode) => {
          notFreeSeatCodes.add(String(seatCode).toUpperCase())
        })
      })

      const seatsAlreadyTaken = selectedSeatCodes.filter((code) => notFreeSeatCodes.has(code.toUpperCase()))
      if (seatsAlreadyTaken.length > 0) {
        alert("Uno o più posti selezionati non sono più disponibili.")
        await loadSeats()
        return
      }

      // 2) Salva stato temporaneo nel browser (NO insert prenotazioni qui)
      const pendingData: PendingCheckoutData = {
        seatsCodes: selectedSeatCodes,
        replicaId: selectedReplicaId,
        customer: { nome, cognome, email, telefono },
        totalAmount,
      }

      localStorage.setItem(PENDING_SEATS_KEY, JSON.stringify(selectedSeatCodes))
      localStorage.setItem(PENDING_CHECKOUT_DATA_KEY, JSON.stringify(pendingData))

      // 3) Chiama Stripe
      const checkoutRes = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seats: selectedSeatCodes,
          totalAmount,
          replicaId: selectedReplicaId,
          spettacoloId: selectedSpettacoloId,
          customer: {
            nome,
            cognome,
            email,
            telefono,
          },
        }),
      })

      if (!checkoutRes.ok) {
        let errorMsg = "Errore durante l'avvio del pagamento. Riprova."
        try {
          const errJson = await checkoutRes.json()
          if (errJson?.error) errorMsg = String(errJson.error)
        } catch {
          // ignore
        }

        clearPendingStorage()
        await loadSeats()
        alert(errorMsg)
        return
      }

      const checkoutData = (await checkoutRes.json()) as { url?: string }

      if (!checkoutData?.url) {
        clearPendingStorage()
        await loadSeats()
        alert("Errore durante l'avvio del pagamento. Riprova.")
        return
      }

      setIsDataModalOpen(false)
      setFormData(initialFormData)
      window.location.href = checkoutData.url
    } finally {
      setIsSubmittingBooking(false)
    }
  }, [formData, seats, loadSeats, selectedReplicaId, selectedSpettacoloId, dirittiPrevenditaEur])

  const handleClearCart = useCallback(async () => {
    const hasSelectedSeats = seats.some((seat) => seat.status === "selected")
    if (!hasSelectedSeats) return

    setSeats((currentSeats) =>
      currentSeats.map((seat) => (seat.status === "selected" ? { ...seat, status: "free" } : seat))
    )

    await loadSeats()
  }, [seats, loadSeats])

  const selectedSeats = seats
    .filter((seat) => seat.status === "selected")
    .map((seat) => ({
      id: seat.id,
      row: seat.row,
      number: seat.number,
      price: seat.price,
    }))

  const seatsByRow = seats.reduce((acc, seat) => {
    if (!acc[seat.row]) acc[seat.row] = []
    acc[seat.row].push(seat)
    return acc
  }, {} as Record<string, Seat[]>)

  const rows = Object.keys(seatsByRow).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="mb-3">
            <Link
              href="/spettacoli"
              className="inline-flex items-center text-sm font-medium text-primary hover:underline"
            >
              ← Torna alla scelta data
            </Link>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-foreground md:text-2xl truncate">{selectedSpettacoloTitle}</h1>
              <div className="text-sm text-muted-foreground">
                {isLoadingSeats ? (
                  "Caricamento replica e mappa posti..."
                ) : bookingDateLabel && bookingDateLabel !== "—" ? (
                  <>
                    {selectedEnteOrganizzatore && <span className="block">Organizzato da: {selectedEnteOrganizzatore}</span>}
                    <span className="block">Data: {bookingDateLabel}</span>
                    <span className="block">Orario: {bookingOrarioLabel}</span>
                  </>
                ) : (
                  "Seleziona i tuoi posti"
                )}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-sm text-muted-foreground">Settore</p>
              <p className="text-lg font-semibold text-primary">Platea</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {isLoadingSeats && (
          <div className="mb-6 rounded-xl border border-border bg-card/50 p-4 text-sm text-muted-foreground">
            Caricamento mappa posti della replica selezionata...
          </div>
        )}

        <div className="flex flex-col gap-8 lg:flex-row">
          <div className="flex-1">
            <div className="mb-4 rounded-lg border border-border bg-card/60 px-4 py-3 text-sm text-foreground">
              <p>
                <span className="font-semibold">Teatro:</span> {teatroNome}
              </p>
              <p>
                <span className="font-semibold">Indirizzo:</span>{" "}
                {teatroIndirizzo !== "Dati non disponibili" || teatroComune !== "Dati non disponibili"
                  ? `${teatroIndirizzo !== "Dati non disponibili" ? teatroIndirizzo : ""}${
                      teatroIndirizzo !== "Dati non disponibili" && teatroComune !== "Dati non disponibili" ? ", " : ""
                    }${teatroComune !== "Dati non disponibili" ? teatroComune : ""}`.trim() || "Dati non disponibili"
                  : "Dati non disponibili"}
              </p>
              <p>
                <span className="font-semibold">Telefono:</span> {teatroTelefono}
              </p>
            </div>
            <Stage />
            <Legend />

            <div className="rounded-2xl border border-border bg-card/30 p-4 md:p-8">
              <div className="mb-4 space-y-1 rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm text-foreground md:text-base">
                <p>
                  Prenotazione per: <span className="font-semibold">{selectedSpettacoloTitle}</span>
                </p>
                {selectedEnteOrganizzatore && (
                  <p>
                    Organizzato da: <span className="font-semibold">{selectedEnteOrganizzatore}</span>
                  </p>
                )}
                <p>
                  Data: <span className="font-semibold">{bookingDateLabel}</span>
                </p>
                <p>
                  Orario: <span className="font-semibold">{bookingOrarioLabel}</span>
                </p>
              </div>
              <div className="space-y-3 md:space-y-4">
                {rows.map((row) => (
                  <SeatRow
                    key={row}
                    rowLetter={row}
                    seats={seatsByRow[row] || []}
                    onSeatClick={handleSeatClick}
                  />
                ))}
              </div>

              <div className="mt-8 border-t border-border pt-6">
                <h3 className="mb-3 text-center text-sm font-semibold text-muted-foreground">Prezzi (da database)</h3>
                <div className="mx-auto max-w-sm space-y-2 text-sm">
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Biglietto (per posto)</span>
                    <span className="font-semibold text-primary">€{prezzoBigliettoEur.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Diritti di prevendita (per posto)</span>
                    <span className="font-semibold text-primary">€{dirittiPrevenditaEur.toFixed(2)}</span>
                  </div>
                  <p className="pt-1 text-center text-xs text-muted-foreground">
                    Il totale nel carrello include biglietti e diritti per i posti selezionati.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="w-full lg:w-80 xl:w-96">
            <div className="sticky top-4">
              <Cart
                selectedSeats={selectedSeats}
                onRemoveSeat={handleRemoveSeat}
                onCheckout={handleCheckout}
                dirittiPrevenditaPerSeat={dirittiPrevenditaEur}
              />

              <div className="mt-3">
                <button
                  type="button"
                  onClick={handleClearCart}
                  disabled={selectedSeats.length === 0}
                  className="w-full rounded-lg border border-destructive px-4 py-2 font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Annulla (Svuota Carrello)
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {isDataModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5">
            <h2 className="mb-4 text-lg font-semibold text-foreground">Inserisci i tuoi dati</h2>

            <div className="space-y-3">
              <div>
                <label htmlFor="nome" className="mb-1 block text-sm">
                  Nome
                </label>
                <input
                  id="nome"
                  type="text"
                  value={formData.nome}
                  onChange={(e) => handleFormInputChange("nome", e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  placeholder="Mario"
                  disabled={isSubmittingBooking}
                />
              </div>

              <div>
                <label htmlFor="cognome" className="mb-1 block text-sm">
                  Cognome
                </label>
                <input
                  id="cognome"
                  type="text"
                  value={formData.cognome}
                  onChange={(e) => handleFormInputChange("cognome", e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  placeholder="Rossi"
                  disabled={isSubmittingBooking}
                />
              </div>

              <div>
                <label htmlFor="email" className="mb-1 block text-sm">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => handleFormInputChange("email", e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  placeholder="mario@email.it"
                  disabled={isSubmittingBooking}
                />
              </div>

              <div>
                <label htmlFor="telefono" className="mb-1 block text-sm">
                  Cellulare
                </label>
                <input
                  id="telefono"
                  type="tel"
                  value={formData.telefono}
                  onChange={(e) => handleFormInputChange("telefono", e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  placeholder="+39 333 1234567"
                  disabled={isSubmittingBooking}
                />
              </div>
            </div>

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={handleCloseModal}
                disabled={isSubmittingBooking}
                className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={handleConfirmData}
                disabled={isSubmittingBooking}
                className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {isSubmittingBooking ? "Invio..." : "Conferma Dati"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}