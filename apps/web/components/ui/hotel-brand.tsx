import { Brand } from './brand';
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
          className={compact ? 'max-h-9 w-9 object-contain' : 'max-h-9 max-w-full object-contain'}
        />
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
