import { Badge } from '../../components/ui/badge';
import { LIFECYCLE_LABELS, LIFECYCLE_TONE, type LifecycleState } from '../../lib/platform-api';

/** A hotel's lifecycle state as a coloured pill. */
export function LifecycleBadge({ state }: { state: LifecycleState }) {
  return <Badge variant={LIFECYCLE_TONE[state]}>{LIFECYCLE_LABELS[state]}</Badge>;
}
