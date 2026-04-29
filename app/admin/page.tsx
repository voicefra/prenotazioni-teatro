import { PrenotazioniSection } from "./_components/prenotazioni-section"

export default function AdminPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50">
        <div className="container mx-auto px-4 py-4">
          <div>
            <h1 className="text-xl font-bold text-foreground md:text-2xl">Pannello Admin</h1>
            <p className="text-sm text-muted-foreground">
              Gestione prenotazioni
            </p>
          </div>
        </div>
      </header>

      <div className="container mx-auto max-w-5xl px-4 py-8">
        <PrenotazioniSection />
      </div>
    </div>
  )
}
