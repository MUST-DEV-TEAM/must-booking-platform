import { Brand } from './brand';
export function HotelBrand({
  name,
  logoUrl,
  compact = false,
  showNameWithLogo = false,
}: {
  name: string;
  logoUrl?: string | null;
  compact?: boolean;
  showNameWithLogo?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {logoUrl ? (
        <>
          <img
            src={logoUrl}
            alt={name}
            className={
              compact
                ? 'max-h-9 w-9 object-contain'
                : showNameWithLogo
                  ? 'max-h-9 max-w-12 shrink-0 object-contain'
                  : 'max-h-9 max-w-full object-contain'
            }
          />
          {showNameWithLogo && !compact ? (
            <span className="truncate font-semibold" title={name}>
              {name}
            </span>
          ) : null}
        </>
      ) : (
        <>
          <Brand compact />
          {compact ? null : (
            <span className="truncate font-semibold" title={name}>
              {name}
            </span>
          )}
        </>
      )}
    </div>
  );
}
