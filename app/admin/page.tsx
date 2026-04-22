"use client"

import Link from "next/link"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PrenotazioniSection } from "./_components/prenotazioni-section"
import { ReplicheSection } from "./_components/repliche-section"
import { ResetDatabaseSection } from "./_components/reset-database-section"
import { SpettacoliSection } from "./_components/spettacoli-section"
import { TeatriSection } from "./_components/teatri-section"

/**
 * Pannello Admin: Teatri, Spettacoli, Repliche, Prenotazioni, Reset database.
 */

export default function AdminPage() {
  const [tab, setTab] = useState("teatri")

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
          </div>
        </div>
      </header>

      <div className="container mx-auto max-w-5xl px-4 py-8">
        <Tabs value={tab} onValueChange={setTab} className="gap-8">
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
