export function Legend() {
  return (
    <div className="flex flex-wrap justify-center gap-4 md:gap-8 mb-8">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-t-md bg-seat-free border-b-2 border-seat-free/60" />
        <span className="text-sm text-muted-foreground">Libero</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-t-md bg-seat-selected border-b-2 border-seat-selected/60 ring-1 ring-seat-selected/50" />
        <span className="text-sm text-muted-foreground">Selezionato</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-t-md bg-seat-occupied border-b-2 border-seat-occupied/60 opacity-50" />
        <span className="text-sm text-muted-foreground">Occupato</span>
      </div>
    </div>
  )
}
