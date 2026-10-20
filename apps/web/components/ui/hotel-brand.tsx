export function HotelBrand({
  name,
  logoUrl,
  compact = false,
}: {
  name: string;
  logoUrl?: string | null;
  compact?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={name}
          className={compact ? 'h-8 w-8 object-contain' : 'max-h-12 max-w-40 object-contain'}
        />
      ) : (
        <span className="truncate font-semibold" title={name}>
          {compact ? name.slice(0, 2) : name}
        </span>
      )}
    </div>
  );
}
