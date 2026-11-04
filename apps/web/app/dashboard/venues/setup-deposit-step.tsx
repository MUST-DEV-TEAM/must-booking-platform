'use client';
import { Button } from '../../../components/ui/button';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { DepositRulesPanel } from './deposit-rules-panel';

export function SetupDepositStep({
  tenantId,
  venueId,
  saving,
  error,
  onFinish,
  onSkip,
}: {
  tenantId: string;
  venueId: string;
  saving: boolean;
  error?: string | null;
  onFinish: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="space-y-4">
      <DepositRulesPanel
        tenantId={tenantId}
        venueId={venueId}
        saveLabel="Save and finish setup"
        onSaved={onFinish}
      />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Button variant="outline" onClick={onSkip} disabled={saving}>
        Skip for now
      </Button>
    </div>
  );
}
