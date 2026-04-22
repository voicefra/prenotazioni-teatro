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

export function SeatRow({ rowLetter, seats, onSeatClick }: SeatRowProps) {
  // Split seats into left (1-5) and right (6-10 or 6-9 for last row)
  const leftSeats = seats.filter(s => s.number <= 5)
  const rightSeats = seats.filter(s => s.number > 5)

  return (
    <div className="flex items-center justify-center gap-2 md:gap-4">
      {/* Row letter - left */}
      <span className="w-6 text-center text-sm font-semibold text-muted-foreground">
        {rowLetter}
      </span>
      
      {/* Left seats (1-5) */}
      <div className="flex gap-1 md:gap-1.5">
        {leftSeats.map((seat) => (
          <Seat
            key={seat.id}
            id={seat.id}
            row={rowLetter}
            number={seat.number}
            status={seat.status}
            price={seat.price}
            onClick={onSeatClick}
          />
        ))}
      </div>
      
      {/* Center aisle */}
      <div className="w-6 md:w-10" />
      
      {/* Right seats (6-10) */}
      <div className="flex gap-1 md:gap-1.5">
        {rightSeats.map((seat) => (
          <Seat
            key={seat.id}
            id={seat.id}
            row={rowLetter}
            number={seat.number}
            status={seat.status}
            price={seat.price}
            onClick={onSeatClick}
          />
        ))}
      </div>
      
      {/* Row letter - right */}
      <span className="w-6 text-center text-sm font-semibold text-muted-foreground">
        {rowLetter}
      </span>
    </div>
  )
}
