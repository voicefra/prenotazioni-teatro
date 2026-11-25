"use client"

import { Seat, type SeatStatus } from "./seat"

interface SeatData {
  id: string
  number: number
  status: SeatStatus
  price: number
}

interface SeatRowProps {
  rowLetter: string
  seats: SeatData[]
  onSeatClick: (seatId: string) => void
}

/**
 * Fila di posti con corridoio centrale. I posti si restringono per stare sempre
 * nella larghezza dello schermo (smartphone), fino a 40px su schermi grandi.
 */
export function SeatRow({ rowLetter, seats, onSeatClick }: SeatRowProps) {
  const sorted = [...seats].sort((a, b) => a.number - b.number)
  const maxNumber = sorted.length > 0 ? sorted[sorted.length - 1].number : 0
  const half = Math.ceil(maxNumber / 2)
  const leftSeats = sorted.filter((s) => s.number <= half)
  const rightSeats = sorted.filter((s) => s.number > half)

  const renderSeats = (list: SeatData[]) =>
    list.map((seat) => (
      <Seat
        key={seat.id}
        id={seat.id}
        row={rowLetter}
        number={seat.number}
        status={seat.status}
        price={seat.price}
        onClick={onSeatClick}
      />
    ))

  return (
    <div className="mx-auto flex w-full max-w-3xl items-center gap-1 md:gap-3">
      <span className="w-4 shrink-0 text-center text-xs font-semibold text-muted-foreground md:w-6 md:text-sm">
        {rowLetter}
      </span>

      <div className="flex min-w-0 flex-1 justify-end gap-[3px] md:gap-1.5">{renderSeats(leftSeats)}</div>

      {/* Corridoio centrale */}
      <div className="w-2 shrink-0 md:w-10" />

      <div className="flex min-w-0 flex-1 justify-start gap-[3px] md:gap-1.5">{renderSeats(rightSeats)}</div>

      <span className="w-4 shrink-0 text-center text-xs font-semibold text-muted-foreground md:w-6 md:text-sm">
        {rowLetter}
      </span>
    </div>
  )
}
