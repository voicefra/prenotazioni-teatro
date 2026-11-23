"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Stage } from "./stage"
import { SeatRow } from "./seat-row"
import { Cart, type CartBookingMode } from "./cart"
import { Legend } from "./legend"
import type { SeatStatus } from "./seat"
import { formatTimeHHmm } from "@/lib/datetime-format"
import {
  collectOccupiedSeatCodes,
  countBookedTicketsFromPrenotazioni,
  pendingHoldCutoffIso,
  prenotazioniAvailabilityOrFilter,
} from "@/lib/booking/prenotazioni-utils"
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
  modalita_prenotazione?: string | null
  modalita_pagamento?: string | null
}

interface TeatroInfoRow {
  nome_teatro?: string | null
  indirizzo?: string | null
  comune?: string | null
  telefono?: string | null
  numero_file?: number | null
  posti_per_fila?: number | null
}

interface PrenotazioneStatusRow {
  posti_prenotati: string[] | string | null
  stato_pagamento: "pending" | "paid" | "failed" | string
  created_at?: string | null
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

const FISCAL_DISCLAIMER =
  "Si tiene a precisare che il suddetto portale web che viene utilizzato non opera come Sistema di Biglietteria Automatizzata ai sensi del Provvedimento Agenzia Entrate del 23/07/2001, in quanto non emette alcun Titolo di Accesso fiscale. Il portale è un mero strumento di e-commerce per la prenotazione e il pagamento anticipato. L'assolvimento degli obblighi fiscali e del diritto d'autore per l'accesso allo spettacolo avverrà tramite l'emissione di regolari Titoli di Accesso fiscali premarcati SIAE, che avverrà direttamente in biglietteria, il giorno dello spettacolo, presentando al personale addetto, il voucher di prenotazione che verrà inviato sulla mail. Gli incassi verranno quindi regolarmente rendicontati tramite Modello C1."

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

function generateUnicoSeatCodes(count: number): string[] {
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const bytes = new Uint8Array(10)
    crypto.getRandomValues(bytes)
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase()
    out.push(`UNICO-${hex}`)
  }
  return out
}

export function TheaterBooking() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const replicaIdFromUrl = searchParams.get("replica_id")?.trim() || ""
  const effectiveReplicaId =
    replicaIdFromUrl || safeReadPendingCheckoutData()?.replicaId?.trim() || ""

  const [seats, setSeats] = useState<Seat[]>([])
  const [isLoadingSeats, setIsLoadingSeats] = useState(false)
  const [loadSeatsError, setLoadSeatsError] = useState<string | null>(null)
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
  const [bookingMode, setBookingMode] = useState<CartBookingMode>("posti_assegnati")
  /** true se lo spettacolo è "solo prenotazione" (nessun pagamento online). */
  const [isSoloPrenotazione, setIsSoloPrenotazione] = useState(false)
  const [postoUnicoQuantity, setPostoUnicoQuantity] = useState(1)
  const [postoUnicoPostiRimanenti, setPostoUnicoPostiRimanenti] = useState(0)
  const [teatroCapienzaTotale, setTeatroCapienzaTotale] = useState(0)
  const [isDataModalOpen, setIsDataModalOpen] = useState(false)
  const [isSubmittingBooking, setIsSubmittingBooking] = useState(false)
  const [formData, setFormData] = useState<BookingFormData>(initialFormData)
  const [isVerifyingPayment, setIsVerifyingPayment] = useState(false)
  const [bookingConfirmed, setBookingConfirmed] = useState(false)
  const [bookingConfirmMessage, setBookingConfirmMessage] = useState<string | null>(null)
  const [paymentVerifyError, setPaymentVerifyError] = useState<string | null>(null)
  const [cancelToastMessage, setCancelToastMessage] = useState<string | null>(null)

  // Evita doppie esecuzioni in dev (React Strict Mode)
  const successHandledRef = useRef(false)
  const canceledHandledRef = useRef(false)
  const loadSeatsRequestRef = useRef(0)

  const loadSeats = useCallback(async () => {
    const targetReplicaId = effectiveReplicaId
    if (!targetReplicaId) {
      setSeats([])
      setIsLoadingSeats(false)
      return
    }

    const requestId = ++loadSeatsRequestRef.current
    setIsLoadingSeats(true)
    setLoadSeatsError(null)

    try {
      const { data: replicaData, error: replicaError } = await supabase
        .from("repliche")
        .select("*")
        .eq("id", targetReplicaId)
        .maybeSingle()

      if (replicaError) {
        logSupabaseError("[repliche]", replicaError)
        setSeats([])
        setLoadSeatsError("Impossibile caricare la replica. Riprova tra poco.")
        return
      }

      if (!replicaData) {
        console.log(
          "[repliche] Nessuna riga per id=",
          targetReplicaId,
          "(verifica RLS, tipo UUID vs testo, o che la replica esista).",
        )
        setSeats([])
        setLoadSeatsError("Replica non trovata.")
        return
      }

      const replica = replicaData as ReplicaRow
      const spettacoloId = pickSpettacoloIdFromReplica(replica)

      if (!spettacoloId) {
        console.log("[repliche] Impossibile ricavare l'ID spettacolo dalla riga:", replicaData)
        setSeats([])
        setLoadSeatsError("Spettacolo non trovato per questa replica.")
        return
      }

      if (requestId !== loadSeatsRequestRef.current) return

      setSelectedReplicaId(String(replica.id))
      setSelectedSpettacoloId(spettacoloId)

      const deRaw = replica.data_evento ?? replica.data ?? replica.data_ora
      setBookingDateLabel(formatDataEventoItDateOnly(deRaw) || "—")
      setBookingOrarioLabel(pickReplicaOrarioLabel(replica) || "—")

      const { data: spettacoloRow, error: spettacoloErr } = await supabase
        .from("spettacoli")
        .select("teatro_id, nome_spettacolo, ente_organizzatore, locandina_url, prezzo_biglietto, diritti_prevendita, modalita_prenotazione, modalita_pagamento")
        .eq("id", spettacoloId)
        .maybeSingle()

      if (spettacoloErr) {
        logSupabaseError("[spettacoli]", spettacoloErr)
      }

      const show = (spettacoloRow ?? null) as SpettacoloHeaderRow | null
      setSelectedSpettacoloTitle(String(show?.nome_spettacolo ?? "Spettacolo"))
      setSelectedEnteOrganizzatore(String(show?.ente_organizzatore ?? "").trim())

      const teatroId = String(show?.teatro_id ?? "").trim()
      let capienzaSala = 0
      if (teatroId) {
        const { data: teatroRow, error: teatroErr } = await supabase
          .from("teatri")
          .select("nome_teatro, indirizzo, comune, telefono, numero_file, posti_per_fila")
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
        const nf = Math.floor(Number(teatro?.numero_file ?? 0))
        const pp = Math.floor(Number(teatro?.posti_per_fila ?? 0))
        capienzaSala = Number.isFinite(nf) && Number.isFinite(pp) && nf > 0 && pp > 0 ? nf * pp : 0
        setTeatroCapienzaTotale(capienzaSala)
      } else {
        setTeatroNome("Dati non disponibili")
        setTeatroIndirizzo("Dati non disponibili")
        setTeatroComune("Dati non disponibili")
        setTeatroTelefono("Dati non disponibili")
        setTeatroCapienzaTotale(0)
        capienzaSala = 0
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

      const modalitaRaw = String(show?.modalita_prenotazione ?? "posti_assegnati").trim()
      const isPostoUnico = modalitaRaw === "posto_unico"
      setBookingMode(isPostoUnico ? "posto_unico" : "posti_assegnati")
      setIsSoloPrenotazione(String(show?.modalita_pagamento ?? "pagamento_online").trim() === "solo_prenotazione")

      const holdCutoff = pendingHoldCutoffIso()

      const { data: statusRows, error: statusError } = await supabase
        .from("prenotazioni")
        .select("posti_prenotati, stato_pagamento, created_at")
        .eq("replica_id", targetReplicaId)
        .or(prenotazioniAvailabilityOrFilter(holdCutoff))

      if (statusError) {
        logSupabaseError("[prenotazioni disponibilità]", statusError)
        setSeats([])
        setLoadSeatsError("Impossibile verificare la disponibilità dei posti.")
        return
      }

      if (requestId !== loadSeatsRequestRef.current) return

      const statusTyped = (statusRows ?? []) as PrenotazioneStatusRow[]
      const bookedTickets = countBookedTicketsFromPrenotazioni(statusTyped)

      if (isPostoUnico) {
        const rimanenti = Math.max(0, capienzaSala - bookedTickets)
        setPostoUnicoPostiRimanenti(rimanenti)
        setPostoUnicoQuantity((prev) => {
          if (rimanenti <= 0) return 0
          const p = Math.floor(Number(prev))
          const base = Number.isFinite(p) && p >= 1 ? p : 1
          return Math.min(base, rimanenti)
        })
        setSeats([])
        return
      }

      let postiRows: PostoRow[] = []
      const byReplica = await supabase.from("posti").select("id, numero_posto").eq("replica_id", targetReplicaId)

      if (byReplica.error) {
        logSupabaseError("[posti per replica_id]", byReplica.error)
      }

      if (!byReplica.error && byReplica.data && byReplica.data.length > 0) {
        postiRows = byReplica.data as PostoRow[]
        console.log("[posti] Caricati per replica_id=", targetReplicaId, "count=", postiRows.length)
      } else {
        const byShow = await supabase.from("posti").select("id, numero_posto").eq("spettacolo_id", spettacoloId)

        if (byShow.error) {
          logSupabaseError("[posti per spettacolo_id]", byShow.error)
          setSeats([])
          setLoadSeatsError("Impossibile caricare la mappa dei posti.")
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
            : "",
        )
      }

      if (requestId !== loadSeatsRequestRef.current) return

      const notFreeSeatCodes = collectOccupiedSeatCodes(statusTyped)

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
    } catch (err) {
      console.error("[loadSeats] unhandled:", err)
      if (requestId === loadSeatsRequestRef.current) {
        setSeats([])
        setLoadSeatsError("Errore imprevisto durante il caricamento della replica.")
      }
    } finally {
      if (requestId === loadSeatsRequestRef.current) {
        setIsLoadingSeats(false)
      }
    }
  }, [effectiveReplicaId])

  useEffect(() => {
    if (!effectiveReplicaId) {
      setIsLoadingSeats(false)
      return
    }
    void loadSeats()
  }, [effectiveReplicaId, loadSeats])

  useEffect(() => {
    void fetch("/api/cleanup", { method: "GET" }).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (searchParams.get("canceled") !== "true") {
      canceledHandledRef.current = false
    }
    if (searchParams.get("success") !== "true") {
      successHandledRef.current = false
    }
  }, [searchParams])

  useEffect(() => {
    const handleWakeUp = (event: PageTransitionEvent) => {
      if (event.persisted) {
        window.location.reload()
      }
    }

    window.addEventListener("pageshow", handleWakeUp)
    return () => window.removeEventListener("pageshow", handleWakeUp)
  }, [])

  // Gestione annullamento pagamento (?canceled=true)
  useEffect(() => {
    const handleCanceled = async () => {
      if (canceledHandledRef.current) return

      const params = new URLSearchParams(window.location.search)
      const isCanceled = params.get("canceled") === "true"
      if (!isCanceled) return

      canceledHandledRef.current = true

      const sessionId = (params.get("session_id") || "").trim()
      const pendingCheckout = safeReadPendingCheckoutData()
      const replicaIdParam = (
        params.get("replica_id") ||
        effectiveReplicaId ||
        pendingCheckout?.replicaId ||
        ""
      ).trim()

      if (sessionId) {
        try {
          const cancelRes = await fetch(
            `/api/checkout/cancel?session_id=${encodeURIComponent(sessionId)}`,
            { method: "GET", headers: { Accept: "application/json" } },
          )
          if (!cancelRes.ok) {
            const errJson = (await cancelRes.json().catch(() => ({}))) as { error?: string }
            console.error("[checkout/cancel] non OK:", cancelRes.status, errJson)
          }
        } catch (e) {
          console.error("[checkout/cancel] fetch fallita:", e)
        }
      }

      clearPendingStorage()

      if (replicaIdParam) {
        router.replace(`/?replica_id=${encodeURIComponent(replicaIdParam)}`, { scroll: false })
      } else {
        removeQueryParams(["canceled", "session_id"])
        router.replace("/spettacoli", { scroll: false })
      }
      router.refresh()
      if (replicaIdParam) await loadSeats()

      setCancelToastMessage("Prenotazione annullata.")
      window.setTimeout(() => setCancelToastMessage(null), 5000)
    }

    void handleCanceled()
  }, [loadSeats, effectiveReplicaId, router])

  // Gestione successo pagamento (?success=true&session_id=...) — double check Stripe (localhost / fallback webhook)
  useEffect(() => {
    const handleSuccess = async () => {
      if (successHandledRef.current) return

      const params = new URLSearchParams(window.location.search)
      const isSuccess = params.get("success") === "true"
      if (!isSuccess) return

      const stripeSessionId = (params.get("session_id") || "").trim()
      if (!stripeSessionId) {
        successHandledRef.current = true
        setIsVerifyingPayment(false)
        setPaymentVerifyError(
          "Pagamento completato, ma manca session_id nell'URL. Contatta l'assistenza con i dati del pagamento.",
        )
        return
      }

      successHandledRef.current = true
      setIsVerifyingPayment(true)
      setBookingConfirmed(false)
      setBookingConfirmMessage(null)
      setPaymentVerifyError(null)

      try {
        const verifyRes = await fetch(
          `/api/checkout/verify?session_id=${encodeURIComponent(stripeSessionId)}`,
          { method: "GET", headers: { Accept: "application/json" } },
        )

        let payload: { ok?: boolean; error?: string; warning?: string } = {}
        try {
          payload = (await verifyRes.json()) as typeof payload
        } catch {
          payload = {}
        }

        const verified = verifyRes.ok && payload.ok !== false

        if (!verified) {
          const detail = payload.error || `Errore verifica (HTTP ${verifyRes.status})`
          setIsVerifyingPayment(false)
          setPaymentVerifyError(
            `Non siamo riusciti a confermare la prenotazione: ${detail}. Il pagamento potrebbe essere andato a buon fine: controlla la email o contatta l'assistenza indicando l'ID ordine Stripe.`,
          )
          successHandledRef.current = false
          return
        }

        clearPendingStorage()

        const replicaIdParam = (params.get("replica_id") || effectiveReplicaId || "").trim()
        if (replicaIdParam) {
          router.replace(`/?replica_id=${encodeURIComponent(replicaIdParam)}`, { scroll: false })
        } else {
          removeQueryParams(["success", "session_id"])
        }
        router.refresh()

        setIsVerifyingPayment(false)
        setBookingConfirmed(true)
        setBookingConfirmMessage(
          payload.warning ??
            "Prenotazione confermata! Riceverai a breve la ricevuta con i PDF in allegato sulla email indicata.",
        )

        void loadSeats()
      } catch (e) {
        console.error("[checkout/verify] fetch fallita:", e)
        setIsVerifyingPayment(false)
        setPaymentVerifyError(
          "Errore di rete durante la conferma dei biglietti. Ricarica la pagina; se il problema persiste, contatta l'assistenza.",
        )
        successHandledRef.current = false
      }
    }

    void handleSuccess()
  }, [loadSeats, effectiveReplicaId, router])

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
    if (bookingMode === "posto_unico") {
      if (teatroCapienzaTotale <= 0) {
        alert("Capienza teatro non disponibile. Contatta l'organizzazione.")
        return
      }
      if (postoUnicoPostiRimanenti <= 0) {
        alert("Spettacolo sold out: non ci sono posti disponibili per questa replica.")
        return
      }
      const q = Math.floor(postoUnicoQuantity)
      if (!Number.isFinite(q) || q < 1) {
        alert("Indica quanti posti vuoi prenotare.")
        return
      }
      if (q > postoUnicoPostiRimanenti) {
        alert("Non ci sono abbastanza posti disponibili. Aggiorniamo la disponibilità.")
        void loadSeats()
        return
      }
      setIsDataModalOpen(true)
      return
    }

    const selectedCount = seats.filter((seat) => seat.status === "selected").length
    if (selectedCount === 0) {
      alert("Seleziona almeno un posto")
      return
    }

    setIsDataModalOpen(true)
  }, [
    bookingMode,
    teatroCapienzaTotale,
    postoUnicoPostiRimanenti,
    postoUnicoQuantity,
    seats,
    loadSeats,
  ])

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

    let selectedSeatCodes: string[] = []
    let totalAmount = 0

    if (bookingMode === "posto_unico") {
      const n = Math.floor(postoUnicoQuantity)
      if (teatroCapienzaTotale <= 0) {
        alert("Capienza teatro non disponibile. Contatta l'organizzazione.")
        return
      }
      if (n < 1) {
        alert("Indica quanti posti vuoi prenotare.")
        return
      }

      const fifteenMinutesAgo = pendingHoldCutoffIso()

      const { data: statusRows, error: statusError } = await supabase
        .from("prenotazioni")
        .select("posti_prenotati, stato_pagamento, created_at")
        .eq("replica_id", selectedReplicaId)
        .or(prenotazioniAvailabilityOrFilter(fifteenMinutesAgo))

      if (statusError) {
        logSupabaseError("[prenotazioni verifica checkout posto unico]", statusError)
        alert("Errore durante la verifica dei posti. Riprova.")
        return
      }

      const booked = countBookedTicketsFromPrenotazioni((statusRows ?? []) as PrenotazioneStatusRow[])
      const rimanenti = Math.max(0, teatroCapienzaTotale - booked)
      if (n > rimanenti) {
        alert(
          rimanenti <= 0
            ? "Spettacolo sold out: non ci sono più posti disponibili per questa replica."
            : "Non ci sono abbastanza posti disponibili per la quantità richiesta.",
        )
        await loadSeats()
        return
      }

      selectedSeatCodes = generateUnicoSeatCodes(n)
      totalAmount = n * prezzoBigliettoEur + n * dirittiPrevenditaEur
    } else {
      const selectedSnapshot = seats.filter((seat) => seat.status === "selected")
      selectedSeatCodes = selectedSnapshot.map(toSeatCode)
      const n = selectedSnapshot.length
      totalAmount =
        selectedSnapshot.reduce((sum, s) => sum + s.price, 0) + n * dirittiPrevenditaEur

      if (selectedSeatCodes.length === 0) {
        alert("Seleziona almeno un posto")
        setIsDataModalOpen(false)
        return
      }

      // 1) Verifica disponibilita aggiornata per la replica scelta
      const fifteenMinutesAgo = pendingHoldCutoffIso()

      const { data: statusRows, error: statusError } = await supabase
        .from("prenotazioni")
        .select("posti_prenotati, stato_pagamento, created_at")
        .eq("replica_id", selectedReplicaId)
        .or(prenotazioniAvailabilityOrFilter(fifteenMinutesAgo))

      if (statusError) {
        logSupabaseError("[prenotazioni verifica checkout]", statusError)
        alert("Errore durante la verifica dei posti. Riprova.")
        return
      }

      const notFreeSeatCodes = collectOccupiedSeatCodes((statusRows ?? []) as PrenotazioneStatusRow[])

      const seatsAlreadyTaken = selectedSeatCodes.filter((code) => notFreeSeatCodes.has(code.toUpperCase()))
      if (seatsAlreadyTaken.length > 0) {
        alert("Uno o più posti selezionati non sono più disponibili.")
        await loadSeats()
        return
      }
    }

    setIsSubmittingBooking(true)

    if (isSoloPrenotazione) {
      // Solo prenotazione: nessun pagamento, il server salva i posti come "riservato" e invia l'email.
      try {
        const res = await fetch("/api/prenota", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            seats: selectedSeatCodes,
            replicaId: selectedReplicaId,
            spettacoloId: selectedSpettacoloId,
            bookingMode,
            customer: { nome, cognome, email, telefono },
          }),
        })

        if (!res.ok) {
          let errorMsg = "Errore durante la prenotazione. Riprova."
          try {
            const errJson = await res.json()
            if (errJson?.error) errorMsg = String(errJson.error)
          } catch {
            // ignore
          }
          await loadSeats()
          alert(errorMsg)
          return
        }

        setIsDataModalOpen(false)
        setFormData(initialFormData)
        setBookingConfirmMessage(
          "Prenotazione registrata! Ti abbiamo inviato una email con il riepilogo e il PDF. Il posto resta riservato per 48 ore in attesa della conferma dell'organizzatore.",
        )
        setBookingConfirmed(true)
        window.scrollTo({ top: 0, behavior: "smooth" })
        await loadSeats()
      } catch {
        alert("Errore di rete durante la prenotazione. Riprova.")
      } finally {
        setIsSubmittingBooking(false)
      }
      return
    }

    try {
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
          bookingMode,
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
  }, [
    formData,
    seats,
    loadSeats,
    selectedReplicaId,
    selectedSpettacoloId,
    dirittiPrevenditaEur,
    bookingMode,
    postoUnicoQuantity,
    teatroCapienzaTotale,
    prezzoBigliettoEur,
    isSoloPrenotazione,
  ])

  const handleClearCart = useCallback(async () => {
    if (bookingMode === "posto_unico") {
      if (postoUnicoPostiRimanenti > 0) setPostoUnicoQuantity(1)
      await loadSeats()
      return
    }

    const hasSelectedSeats = seats.some((seat) => seat.status === "selected")
    if (!hasSelectedSeats) return

    setSeats((currentSeats) =>
      currentSeats.map((seat) => (seat.status === "selected" ? { ...seat, status: "free" } : seat))
    )

    await loadSeats()
  }, [bookingMode, postoUnicoPostiRimanenti, seats, loadSeats])

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

  const postoUnicoSoldOutUi =
    !isLoadingSeats && bookingMode === "posto_unico" && (postoUnicoPostiRimanenti <= 0 || teatroCapienzaTotale <= 0)

  const isStripeReturn =
    searchParams.get("canceled") === "true" || searchParams.get("success") === "true"

  if (!effectiveReplicaId && !isStripeReturn) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="max-w-md rounded-xl border border-border bg-card p-6 text-center">
          <h1 className="text-lg font-semibold text-foreground">Replica non trovata</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Non è stato possibile identificare la replica da prenotare. Torna alla home per scegliere uno spettacolo.
          </p>
          <Link
            href="/"
            className="mt-6 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Torna alla home
          </Link>
        </div>
      </div>
    )
  }

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
                  "Caricamento replica..."
                ) : bookingDateLabel && bookingDateLabel !== "—" ? (
                  <>
                    {selectedEnteOrganizzatore && <span className="block">Organizzato da: {selectedEnteOrganizzatore}</span>}
                    <span className="block">Data: {bookingDateLabel}</span>
                    <span className="block">Orario: {bookingOrarioLabel}</span>
                    {!isLoadingSeats && bookingMode === "posto_unico" && (
                      <span className="block text-foreground/90">Modalità: posto unico (senza mappa)</span>
                    )}
                  </>
                ) : bookingMode === "posto_unico" ? (
                  "Indica quanti posti desideri"
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
        {bookingConfirmed && (
          <div
            className="mb-6 rounded-xl border border-primary/30 bg-primary/10 px-4 py-4 md:px-6"
            role="status"
          >
            <h2 className="text-lg font-semibold text-foreground">Prenotazione confermata</h2>
            <p className="mt-2 text-sm text-muted-foreground">{bookingConfirmMessage}</p>
            <button
              type="button"
              onClick={() => router.push("/spettacoli")}
              className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Torna agli spettacoli
            </button>
          </div>
        )}

        {loadSeatsError && !isLoadingSeats && (
          <div className="mb-6 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-4 text-sm text-destructive">
            {loadSeatsError}
            <button
              type="button"
              onClick={() => void loadSeats()}
              className="mt-3 block text-sm font-medium underline"
            >
              Riprova
            </button>
          </div>
        )}

        {isLoadingSeats && (
          <div className="mb-6 rounded-xl border border-border bg-card/50 p-4 text-sm text-muted-foreground">
            Caricamento replica e disponibilità...
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
            {bookingMode !== "posto_unico" && (
              <>
                <Stage />
                <Legend />
              </>
            )}

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
              {bookingMode === "posto_unico" && !isLoadingSeats && (
                <div className="mb-6 space-y-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-3 text-sm text-foreground">
                  <p className="font-semibold text-foreground">Prenotazione a posto unico</p>
                  <p className="text-muted-foreground">
                    Non è prevista la scelta del numero di posto in sala. Indica nel riepilogo a destra quanti posti
                    desideri, poi usa &quot;{isSoloPrenotazione ? "Prenota" : "Procedi al pagamento"}&quot;.
                  </p>
                  <p>
                    <span className="font-medium">Capienza teatro:</span>{" "}
                    {teatroCapienzaTotale > 0 ? `${teatroCapienzaTotale} posti` : "non configurata"}
                  </p>
                  <p>
                    <span className="font-medium">Posti ancora disponibili per questa replica:</span>{" "}
                    {teatroCapienzaTotale > 0 ? postoUnicoPostiRimanenti : "—"}
                  </p>
                  {postoUnicoSoldOutUi && (
                    <p className="font-medium text-destructive pt-1">
                      {teatroCapienzaTotale <= 0
                        ? "Impossibile prenotare: capienza teatro non configurata. Contatta l'organizzazione."
                        : "Sold out: non è più possibile prenotare per questa replica."}
                    </p>
                  )}
                </div>
              )}
              {bookingMode !== "posto_unico" && (
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
              )}

              <div className="mt-8 border-t border-border pt-6">
                <h3 className="mb-3 text-center text-sm font-semibold text-muted-foreground">Riepilogo costi</h3>
                <div className="mx-auto max-w-sm space-y-2 text-sm">
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Prenotazione (per posto)</span>
                    <span className="font-semibold text-primary">€{prezzoBigliettoEur.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Diritti di prenotazione (per posto)</span>
                    <span className="font-semibold text-primary">€{dirittiPrevenditaEur.toFixed(2)}</span>
                  </div>
                  <p className="pt-1 text-center text-xs text-muted-foreground">
                    Il totale della prenotazione include titolo di accesso e costo servizio per i posti
                    {bookingMode === "posto_unico" ? " richiesti" : " selezionati"}.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="w-full lg:w-80 xl:w-96">
            <div className="sticky top-4">
              <Cart
                bookingMode={bookingMode}
                postoUnicoQuantity={postoUnicoQuantity}
                onPostoUnicoQuantityChange={setPostoUnicoQuantity}
                postoUnicoMax={postoUnicoPostiRimanenti}
                postoUnicoSoldOut={postoUnicoSoldOutUi}
                prezzoPerPosto={prezzoBigliettoEur}
                selectedSeats={selectedSeats}
                onRemoveSeat={handleRemoveSeat}
                onCheckout={handleCheckout}
                submitLabel={isSoloPrenotazione ? "Prenota" : "Procedi al Pagamento"}
                dirittiPrevenditaPerSeat={dirittiPrevenditaEur}
              />

              <div className="mt-3">
                <button
                  type="button"
                  onClick={handleClearCart}
                  disabled={bookingMode === "posto_unico" ? postoUnicoPostiRimanenti <= 0 : selectedSeats.length === 0}
                  className="w-full rounded-lg border border-destructive px-4 py-2 font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {bookingMode === "posto_unico" ? "Ripristina quantità (1 posto)" : "Annulla (Svuota Carrello)"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
      <footer className="border-t border-border/60 bg-card/20 px-4 py-4">
        <div className="container mx-auto">
          <small className="block text-xs leading-relaxed text-muted-foreground">{FISCAL_DISCLAIMER}</small>
        </div>
      </footer>

      {cancelToastMessage && (
        <div
          className="fixed bottom-6 left-1/2 z-[70] max-w-md -translate-x-1/2 rounded-lg border border-border bg-card px-4 py-3 text-sm shadow-lg"
          role="status"
        >
          {cancelToastMessage}
        </div>
      )}

      {isVerifyingPayment && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div
            className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg"
            role="dialog"
            aria-live="polite"
            aria-busy="true"
          >
            <h2 className="text-lg font-semibold text-foreground">Conferma in corso</h2>
            <p className="mt-3 text-sm text-muted-foreground">Stiamo confermando i tuoi biglietti...</p>
            <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
            </div>
          </div>
        </div>
      )}

      {paymentVerifyError && !isVerifyingPayment && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-destructive/40 bg-card p-6 shadow-lg" role="alert">
            <h2 className="text-lg font-semibold text-destructive">Conferma non riuscita</h2>
            <p className="mt-3 text-sm text-muted-foreground">{paymentVerifyError}</p>
            <button
              type="button"
              onClick={() => {
                setPaymentVerifyError(null)
                successHandledRef.current = false
                removeQueryParams(["success", "session_id"])
              }}
              className="mt-6 w-full rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted/50"
            >
              Chiudi
            </button>
          </div>
        </div>
      )}

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