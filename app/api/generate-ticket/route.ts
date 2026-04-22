import { NextResponse } from "next/server"
import { renderTicketsPdf } from "@/lib/tickets/ticket-pdf"

export const runtime = "nodejs"

type Body = {
  spettacolo: string
  data: string
  orario: string
  seats: { fila: string; posto: string }[]
  /** URL completo codificato nel QR (es. https://localhost:3000/scan?ticket_id=…) */
  ticket_scan_url: string
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<Body>

    const spettacolo = String(body.spettacolo ?? "").trim()
    const data = String(body.data ?? "").trim()
    const orario = String(body.orario ?? "").trim()
    const seats = Array.isArray(body.seats) ? body.seats : []
    const ticketScanUrl = String(body.ticket_scan_url ?? "").trim()

    if (!spettacolo || !data || !orario || !ticketScanUrl || seats.length === 0) {
      return NextResponse.json({ error: "Payload non valido per generazione ticket." }, { status: 400 })
    }

    const pdfBuffer = await renderTicketsPdf({
      spettacolo,
      data,
      orario,
      seats: seats.map((s) => ({ fila: String(s.fila ?? ""), posto: String(s.posto ?? "") })).filter((s) => s.fila && s.posto),
      ticketScanUrl,
    })

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=\"biglietti.pdf\"",
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Errore sconosciuto"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

