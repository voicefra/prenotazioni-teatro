import Link from "next/link"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PrenotazioniSection } from "./_components/prenotazioni-section"
import { ReplicheSection } from "./_components/repliche-section"
import { ResetDatabaseSection } from "./_components/reset-database-section"
import { SpettacoliSection } from "./_components/spettacoli-section"
import { TeatriSection } from "./_components/teatri-section"

const ADMIN_AUTH_COOKIE = "admin_auth"

async function authenticateAdmin(formData: FormData) {
  "use server"
  const typedPassword = String(formData.get("password") ?? "")
  const expectedPassword = process.env.ADMIN_PASSWORD

  if (!expectedPassword || typedPassword !== expectedPassword) {
    redirect("/admin?error=wrong")
  }

  const cookieStore = await cookies()
  cookieStore.set(ADMIN_AUTH_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/admin",
    maxAge: 60 * 60 * 8,
  })
  redirect("/admin")
}

async function logoutAdmin() {
  "use server"
  const cookieStore = await cookies()
  cookieStore.delete(ADMIN_AUTH_COOKIE)
  redirect("/admin")
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }> | { error?: string }
}) {
  const cookieStore = await cookies()
  const isAuthenticated = cookieStore.get(ADMIN_AUTH_COOKIE)?.value === "1"
  const resolvedSearch = searchParams && typeof (searchParams as Promise<{ error?: string }>).then === "function"
    ? await (searchParams as Promise<{ error?: string }>)
    : (searchParams as { error?: string } | undefined)
  const hasWrongPasswordError = resolvedSearch?.error === "wrong"

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto max-w-md px-4 py-16">
          <div className="rounded-xl border border-border bg-card/60 p-6">
            <h1 className="text-xl font-bold text-foreground">Accesso Admin</h1>
            <p className="mt-2 text-sm text-muted-foreground">Inserisci la password per accedere al pannello amministrativo.</p>
            {hasWrongPasswordError && (
              <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                Password errata
              </p>
            )}
            <form action={authenticateAdmin} className="mt-4 space-y-3">
              <input
                name="password"
                type="password"
                required
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                placeholder="Password admin"
              />
              <Button type="submit" className="w-full">
                Accedi
              </Button>
            </form>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50">
        <div className="container mx-auto flex flex-wrap items-center justify-between gap-4 px-4 py-4">
          <div>
            <h1 className="text-xl font-bold text-foreground md:text-2xl">Pannello Admin</h1>
            <p className="text-sm text-muted-foreground">
              Teatri (inclusi indirizzo, comune e telefono), spettacoli, repliche, prenotazioni e manutenzione DB
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/spettacoli">Vai agli spettacoli</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/">Home prenotazioni</Link>
            </Button>
            <form action={logoutAdmin}>
              <Button variant="destructive" size="sm" type="submit">
                Esci
              </Button>
            </form>
          </div>
        </div>
      </header>

      <div className="container mx-auto max-w-5xl px-4 py-8">
        <Tabs defaultValue="teatri" className="gap-8">
          <TabsList className="flex h-auto w-full flex-wrap gap-1 p-1">
            <TabsTrigger value="teatri" className="flex-1 min-w-[100px]">
              Teatri
            </TabsTrigger>
            <TabsTrigger value="spettacoli" className="flex-1 min-w-[100px]">
              Spettacoli
            </TabsTrigger>
            <TabsTrigger value="repliche" className="flex-1 min-w-[100px]">
              Repliche
            </TabsTrigger>
            <TabsTrigger value="prenotazioni" className="flex-1 min-w-[100px]">
              Prenotazioni
            </TabsTrigger>
            <TabsTrigger value="reset-db" className="flex-1 min-w-[120px]">
              Reset Database
            </TabsTrigger>
          </TabsList>

          <TabsContent value="teatri" className="mt-0 outline-none">
            <TeatriSection />
          </TabsContent>

          <TabsContent value="spettacoli" className="mt-0 outline-none">
            <SpettacoliSection />
          </TabsContent>

          <TabsContent value="repliche" className="mt-0 outline-none">
            <ReplicheSection />
          </TabsContent>

          <TabsContent value="prenotazioni" className="mt-0 outline-none">
            <PrenotazioniSection />
          </TabsContent>

          <TabsContent value="reset-db" className="mt-0 outline-none">
            <ResetDatabaseSection />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
