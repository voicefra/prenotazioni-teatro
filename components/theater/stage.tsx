export function Stage() {
  return (
    <div className="w-full max-w-2xl mx-auto mb-12">
      <div 
        className="relative h-16 md:h-20 bg-gradient-to-b from-stage to-stage/70 rounded-b-[100%] shadow-lg shadow-stage/30 flex items-center justify-center"
        style={{
          clipPath: "ellipse(100% 100% at 50% 0%)"
        }}
      >
        <span className="text-accent-foreground font-semibold tracking-widest uppercase text-sm md:text-base">
          Palcoscenico
        </span>
      </div>
      <div className="mt-2 flex justify-center">
        <div className="h-1 w-3/4 bg-gradient-to-r from-transparent via-stage/50 to-transparent rounded-full" />
      </div>
    </div>
  )
}
