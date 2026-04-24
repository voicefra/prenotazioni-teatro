import Link from "next/link"
import { processTicketScan } from "@/lib/tickets/process-scan"

interface ScanPageProps {
  searchParams: Promise<{ ticket_id?: string }>
}

function formatScanTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short" })
}

export default async function ScanPage({ searchParams }: ScanPageProps) {
  const params = await searchParams
  const ticketId = (params?.ticket_id ?? "").trim()

  if (!ticketId) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col justify-center gap-4 px-4 py-12">
        <h1 className="text-xl font-semibold text-foreground">Ingresso</h1>
        <p className="text-sm text-muted-foreground">
          Parametro <span className="font-mono">ticket_id</span> mancante.
        </p>
        <Link href="/spettacoli" className="text-sm text-primary underline">
          Torna agli spettacoli
        </Link>
      </div>
    )
  }

  const result = await processTicketScan(ticketId)

  if (!result.ok) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col justify-center gap-4 px-4 py-12">
        <h1 className="text-xl font-semibold text-destructive">Prenotazione non valida</h1>
        <p className="text-sm text-muted-foreground">{result.message}</p>
        <Link href="/spettacoli" className="text-sm text-primary underline">
          Torna agli spettacoli
        </Link>
      </div>
    )
  }

  const whenLabel = formatScanTime(result.orarioScansione)

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col justify-center gap-6 px-4 py-12">
      <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-6">
        <p className="text-sm font-medium text-primary">Ingresso consentito</p>
        <h1 className="mt-2 text-2xl font-semibold text-foreground">{result.spettacolo}</h1>
        <p className="mt-4 text-sm text-foreground">
          <span className="text-muted-foreground">Intestatario: </span>
          {result.nome} {result.cognome}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">Ultima scansione: {whenLabel}</p>
      </div>

      {result.scansioni.length > 0 && (
        <div className="rounded-md border border-border bg-card/50 px-4 py-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Storico ingressi (public.scansioni)
          </p>
          <ul className="space-y-1.5 text-sm text-foreground">
            {result.scansioni.map((s) => (
              <li key={s.id} className="flex justify-between gap-2 border-b border-border/60 pb-1.5 last:border-0">
                <span className="font-mono text-xs text-muted-foreground">{s.id.slice(0, 8)}…</span>
                <span>{formatScanTime(s.orario_scansione)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Link href="/spettacoli" className="text-sm text-primary underline">
        Torna agli spettacoli
      </Link>
    </div>
  )
}
