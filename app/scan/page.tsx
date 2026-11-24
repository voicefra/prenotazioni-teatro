import { cookies } from "next/headers"
import { processTicketScan } from "@/lib/tickets/process-scan"
import { SCAN_AUTH_COOKIE, getScanPassword, isValidScanCookie } from "@/lib/tickets/scan-auth"
import { loginOperatore, logoutOperatore } from "./actions"

export const dynamic = "force-dynamic"

interface ScanPageProps {
  searchParams: Promise<{ ticket_id?: string; errore?: string }>
}

function formatScanTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString("it-IT", { timeZone: "Europe/Rome", dateStyle: "medium", timeStyle: "short" })
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col justify-center gap-6 px-4 py-12">{children}</div>
}

function LogoutButton() {
  return (
    <form action={logoutOperatore}>
      <button type="submit" className="text-xs text-muted-foreground underline">
        Disconnetti questo telefono
      </button>
    </form>
  )
}

export default async function ScanPage({ searchParams }: ScanPageProps) {
  const params = await searchParams
  const ticketId = (params?.ticket_id ?? "").trim()
  const loginError = params?.errore === "1"

  // 1) Solo operatori autorizzati: senza accesso non si legge né si registra nulla.
  const store = await cookies()
  const autorizzato = isValidScanCookie(store.get(SCAN_AUTH_COOKIE)?.value)

  if (!autorizzato) {
    const configurata = getScanPassword() !== ""
    return (
      <Shell>
        <div className="rounded-lg border border-border bg-card px-4 py-6">
          <h1 className="text-xl font-semibold text-foreground">Area riservata agli operatori</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            La verifica dei biglietti è riservata al personale dell&apos;organizzazione all&apos;ingresso in sala.
            Se sei uno spettatore, conserva il tuo QR code e mostralo all&apos;ingresso.
          </p>
          {configurata ? (
            <form action={loginOperatore} className="mt-5 space-y-3">
              <input type="hidden" name="ticket_id" value={ticketId} />
              <label htmlFor="password" className="block text-sm font-medium text-foreground">
                Password operatore
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-base"
              />
              {loginError && <p className="text-sm font-medium text-destructive">Password non corretta.</p>}
              <button
                type="submit"
                className="w-full rounded-lg bg-primary px-4 py-3 text-base font-medium text-primary-foreground hover:opacity-90"
              >
                Accedi
              </button>
              <p className="text-xs text-muted-foreground">Questo telefono resterà autorizzato per 30 giorni.</p>
            </form>
          ) : (
            <p className="mt-4 text-sm font-medium text-destructive">Password operatore non configurata sul server.</p>
          )}
        </div>
      </Shell>
    )
  }

  if (!ticketId) {
    return (
      <Shell>
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-6">
          <h1 className="text-xl font-semibold text-foreground">Telefono autorizzato</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Ora puoi scansionare i QR code dei biglietti con la fotocamera.
          </p>
        </div>
        <LogoutButton />
      </Shell>
    )
  }

  // 2) Verifica del biglietto
  const result = await processTicketScan(ticketId)

  if (result.ok) {
    return (
      <Shell>
        <div className="rounded-lg border-2 border-green-600 bg-green-600/10 px-4 py-6">
          <p className="text-2xl font-bold text-green-700 dark:text-green-400">✓ Ingresso consentito</p>
          <h1 className="mt-3 text-xl font-semibold text-foreground">{result.spettacolo}</h1>
          <p className="mt-3 text-base text-foreground">
            <span className="text-muted-foreground">Intestatario: </span>
            {result.nome} {result.cognome}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">Ingresso registrato: {formatScanTime(result.orarioScansione)}</p>
        </div>
        <LogoutButton />
      </Shell>
    )
  }

  if (result.reason === "already_scanned") {
    return (
      <Shell>
        <div className="rounded-lg border-2 border-destructive bg-destructive/10 px-4 py-6">
          <p className="text-2xl font-bold text-destructive">✗ Biglietto già scansionato</p>
          <p className="mt-1 text-lg font-semibold text-destructive">Ingresso già avvenuto</p>
          <h1 className="mt-4 text-base font-semibold text-foreground">{result.spettacolo}</h1>
          <p className="mt-2 text-base text-foreground">
            <span className="text-muted-foreground">Intestatario: </span>
            {result.nome} {result.cognome}
          </p>
          <p className="mt-2 text-sm text-foreground">
            <span className="text-muted-foreground">Primo ingresso: </span>
            {formatScanTime(result.primoIngresso)}
          </p>
        </div>
        <LogoutButton />
      </Shell>
    )
  }

  return (
    <Shell>
      <div className="rounded-lg border-2 border-destructive bg-destructive/10 px-4 py-6">
        <p className="text-2xl font-bold text-destructive">✗ Ingresso non consentito</p>
        <p className="mt-3 text-base text-foreground">{result.message}</p>
      </div>
      <LogoutButton />
    </Shell>
  )
}
