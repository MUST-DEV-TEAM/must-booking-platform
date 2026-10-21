export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border-2 border-primary bg-card text-primary">
        <svg aria-hidden="true" viewBox="0 0 40 40" className="size-7">
          <path
            d="M7 33V10.5C7 8.6 8.6 7 10.5 7h19c1.9 0 3.5 1.6 3.5 3.5V33"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <path
            d="m12 27 8-11 8 11M20 16v17"
            fill="none"
            className="stroke-brass"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      {compact ? null : (
        <div className="min-w-0 leading-tight">
          <div className="truncate font-extrabold" title="MUST Hotel">MUST Hotel</div>
          <div className="truncate text-xs text-muted-foreground" title="Reservation operations">Reservation operations</div>
        </div>
      )}
    </div>
  );
}
