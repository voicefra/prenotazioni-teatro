"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import {
  SCAN_AUTH_COOKIE,
  SCAN_AUTH_MAX_AGE_S,
  getScanPassword,
  isValidScanPassword,
  scanAuthToken,
} from "@/lib/tickets/scan-auth"

const UUID_RE = /^[0-9a-f-]{36}$/i

function scanPath(ticketId: string, extra?: string): string {
  const params = new URLSearchParams()
  if (UUID_RE.test(ticketId)) params.set("ticket_id", ticketId)
  if (extra) params.set("errore", extra)
  const q = params.toString()
  return q ? `/scan?${q}` : "/scan"
}

/** Login operatore: se la password è giusta salva il cookie e riapre la scansione. */
export async function loginOperatore(formData: FormData): Promise<void> {
  const password = String(formData.get("password") ?? "")
  const ticketId = String(formData.get("ticket_id") ?? "").trim()

  if (!isValidScanPassword(password)) {
    redirect(scanPath(ticketId, "1"))
  }

  const store = await cookies()
  store.set(SCAN_AUTH_COOKIE, scanAuthToken(getScanPassword()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/scan",
    maxAge: SCAN_AUTH_MAX_AGE_S,
  })

  redirect(scanPath(ticketId))
}

/** Disconnette questo telefono (es. telefono personale prestato per una sera). */
export async function logoutOperatore(): Promise<void> {
  const store = await cookies()
  store.delete({ name: SCAN_AUTH_COOKIE, path: "/scan" })
  redirect("/scan")
}
