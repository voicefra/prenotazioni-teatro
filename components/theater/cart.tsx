"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { ShoppingCart, Ticket, X } from "lucide-react"

interface SelectedSeat {
  id: string
  row: string
  number: number
  price: number
}

interface CartProps {
  selectedSeats: SelectedSeat[]
  onRemoveSeat: (seatId: string) => void
  onCheckout: () => void
  /** Diritti di prenotazione (€) per posto — da tabella spettacoli */
  dirittiPrevenditaPerSeat: number
}

export function Cart({ selectedSeats, onRemoveSeat, onCheckout, dirittiPrevenditaPerSeat }: CartProps) {
  const subtotalPrenotazioni = selectedSeats.reduce((sum, seat) => sum + seat.price, 0)
  const quotaServizio = selectedSeats.length * dirittiPrevenditaPerSeat
  const total = subtotalPrenotazioni + quotaServizio

  return (
    <Card className="bg-card border-border sticky top-4">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <ShoppingCart className="w-5 h-5 text-primary" />
          Riepilogo Prenotazione
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {selectedSeats.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <Ticket className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Nessun posto selezionato</p>
            <p className="text-xs mt-1">Clicca su un posto libero per selezionarlo</p>
          </div>
        ) : (
          <>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {selectedSeats.map((seat) => (
                <div
                  key={seat.id}
                  className="flex items-center justify-between bg-secondary/50 rounded-lg px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-t-md bg-seat-selected flex items-center justify-center text-xs font-bold text-primary-foreground">
                      {seat.number}
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        Fila {seat.row} - Posto {seat.number}
                      </p>
                      <p className="text-xs text-muted-foreground">Platea</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-primary">
                      €{seat.price.toFixed(2)}
                    </span>
                    <button
                      onClick={() => onRemoveSeat(seat.id)}
                      className="p-1 hover:bg-destructive/20 rounded-full transition-colors"
                      aria-label={`Rimuovi posto ${seat.row}${seat.number}`}
                    >
                      <X className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-border pt-3 space-y-1 text-sm text-muted-foreground">
              <div className="flex justify-between items-center">
                <span>Posti selezionati</span>
                <span>{selectedSeats.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Subtotale prenotazione</span>
                <span>€{subtotalPrenotazioni.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Diritti di prenotazione ({selectedSeats.length} × €{dirittiPrevenditaPerSeat.toFixed(2)})</span>
                <span>€{quotaServizio.toFixed(2)}</span>
              </div>
            </div>
          </>
        )}
      </CardContent>
      <CardFooter className="flex-col gap-3 pt-0">
        <div className="w-full flex justify-between items-center text-lg font-bold">
          <span>Totale della prenotazione</span>
          <span className="text-primary">€{total.toFixed(2)}</span>
        </div>
        <Button className="w-full" size="lg" disabled={selectedSeats.length === 0} onClick={onCheckout}>
          Procedi al Pagamento
        </Button>
      </CardFooter>
    </Card>
  )
}
