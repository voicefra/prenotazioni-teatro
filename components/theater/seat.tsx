"use client"

import { cn } from "@/lib/utils"

export type SeatStatus = "free" | "selected" | "occupied"

interface SeatProps {
  id: string
  row: string
  number: number
  status: SeatStatus
  price: number
  onClick: (id: string) => void
}

export function Seat({ id, row, number, status, price, onClick }: SeatProps) {
  const handleClick = () => {
    if (status !== "occupied") {
      onClick(id)
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={status === "occupied"}
      className={cn(
        "relative w-9 h-9 md:w-10 md:h-10 rounded-t-lg transition-all duration-200 flex items-center justify-center text-xs font-medium",
        "border-b-4",
        status === "free" && "bg-seat-free hover:bg-seat-free/80 border-seat-free/60 cursor-pointer text-foreground",
        status === "selected" && "bg-seat-selected hover:bg-seat-selected/90 border-seat-selected/60 cursor-pointer text-primary-foreground ring-2 ring-seat-selected/50 ring-offset-2 ring-offset-background",
        status === "occupied" && "bg-seat-occupied border-seat-occupied/60 cursor-not-allowed text-muted-foreground opacity-50"
      )}
      aria-label={`Posto ${row}${number} - ${status === "free" ? "libero" : status === "selected" ? "selezionato" : "occupato"}`}
    >
      <span className="text-[10px] md:text-xs">{number}</span>
      {status === "selected" && (
        <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] text-seat-selected font-semibold whitespace-nowrap">
          €{price}
        </span>
      )}
    </button>
  )
}
