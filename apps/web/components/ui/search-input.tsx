import { Search } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cn } from '../../lib/utils';
import { Input } from './input';

/** A text field with a search icon inside it. Pass `aria-label`; the placeholder is not a label. */
export function SearchInput({ className, ...props }: ComponentProps<typeof Input>) {
  return (
    <div className={cn('relative', className)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input type="search" className="pl-9" {...props} />
    </div>
  );
}
