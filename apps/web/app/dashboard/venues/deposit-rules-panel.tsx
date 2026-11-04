'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../../components/ui/dialog';
import { FormField } from '../../../components/ui/form-field';
import { Input } from '../../../components/ui/input';
import { NumberStepper } from '../../../components/ui/number-stepper';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { depositRulesApi, type DepositRule, type DepositRules } from './deposit-rules-api';
import { venueApi } from './venue-api';

const blank: DepositRule = {
  serviceId: null,
  areaId: null,
  mode: 'none',
  amount: '0.00',
  minParty: 1,
  freeCancelHours: 24,
};
const label = (rule: DepositRule, currency: string) =>
  rule.mode === 'none'
    ? 'No deposit'
    : `${rule.amount} ${currency} ${rule.mode === 'per_guest' ? 'per guest' : 'per booking'}  -  ${rule.minParty}+ guests  -  ${rule.freeCancelHours}h cancellation`;

/** One policy editor serves setup and subsequent restaurant changes. */
export function DepositRulesPanel({
  tenantId,
  venueId,
  onSaved,
  saveLabel = 'Save deposit rules',
}: {
  tenantId: string;
  venueId: string;
  onSaved?: () => void;
  saveLabel?: string;
}) {
  const client = useQueryClient();
  const policy = useQuery({
    queryKey: ['venue-deposit-rules', tenantId, venueId],
    queryFn: () => depositRulesApi.get(tenantId, venueId),
  });
  const services = useQuery({
    queryKey: ['venue-services', tenantId, venueId],
    queryFn: () => venueApi.listServices(tenantId, venueId),
  });
  const layout = useQuery({
    queryKey: ['venue-layout', tenantId, venueId],
    queryFn: () => venueApi.getLayout(tenantId, venueId),
  });
  const [draft, setDraft] = useState<DepositRules | null>(null);
  const [editing, setEditing] = useState<{ title: string; rule: DepositRule } | null>(null);
  const save = useMutation({
    mutationFn: () => depositRulesApi.save(tenantId, venueId, draft ?? policy.data!),
    onSuccess: async (data) => {
      client.setQueryData(['venue-deposit-rules', tenantId, venueId], data);
      setDraft(null);
      onSaved?.();
    },
  });
  if (policy.isPending || services.isPending || layout.isPending)
    return <p>Loading deposit rules...</p>;
  const error = policy.error ?? services.error ?? layout.error;
  if (error || !policy.data || !services.data || !layout.data)
    return (
      <Alert variant="destructive">
        <AlertDescription>{error?.message ?? 'Could not load deposit rules.'}</AlertDescription>
      </Alert>
    );
  const current = draft ?? policy.data;
  const find = (serviceId: string | null, areaId: string | null) =>
    current.rules.find((r) => r.serviceId === serviceId && r.areaId === areaId);
  const update = (rule: DepositRule | null, serviceId: string | null, areaId: string | null) =>
    setDraft({
      ...current,
      rules: [
        ...current.rules.filter((r) => r.serviceId !== serviceId || r.areaId !== areaId),
        ...(rule ? [rule] : []),
      ],
    });
  const cell = (title: string, serviceId: string | null, areaId: string | null) => {
    const exact = find(serviceId, areaId);
    const inherited = find(serviceId, null) ?? find(null, null) ?? blank;
    const text = exact
      ? label(exact, current.currency)
      : serviceId
        ? `Inherit: ${label(inherited, current.currency)}`
        : 'No deposit';
    return (
      <Button
        variant="outline"
        className="h-auto min-h-12 w-full justify-start whitespace-normal text-left"
        aria-label={`${title}: ${text}`}
        onClick={() => setEditing({ title, rule: exact ?? { ...inherited, serviceId, areaId } })}
      >
        {text}
      </Button>
    );
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Set a restaurant default, then override a service or a service and dining area. Deposits
        count toward the final bill. Changes apply to new bookings.
      </p>
      {current.requiresLegacyConversion ? (
        <Alert variant="warning">
          <AlertDescription>
            The previous percentage rule needs a fixed amount. Choose a rate before accepting
            deposits.
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="space-y-2">
        <h4 className="font-semibold">Restaurant default</h4>
        {cell('Restaurant default', null, null)}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="p-2 text-left">Service</th>
              <th className="p-2 text-left">Service default</th>
              {layout.data.areas
                .filter((a) => a.active)
                .map((a) => (
                  <th key={a.id} className="p-2 text-left">
                    {a.name}
                  </th>
                ))}
            </tr>
          </thead>
          <tbody>
            {services.data.map((s) => (
              <tr key={s.id}>
                <th className="p-2 text-left">{s.name}</th>
                <td className="min-w-52 p-2">{cell(s.name, s.id!, null)}</td>
                {layout.data.areas
                  .filter((a) => a.active)
                  .map((a) => (
                    <td className="min-w-52 p-2" key={a.id}>
                      {cell(`${s.name}  -  ${a.name}`, s.id!, a.id)}
                    </td>
                  ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {save.error ? (
        <Alert variant="destructive">
          <AlertDescription>{save.error.message}</AlertDescription>
        </Alert>
      ) : null}
      <Button onClick={() => save.mutate()} disabled={save.isPending}>
        {saveLabel}
      </Button>
      {editing ? (
        <RuleDialog
          title={editing.title}
          currency={current.currency}
          initial={editing.rule}
          onClose={() => setEditing(null)}
          onSave={(rule) => {
            update(rule, editing.rule.serviceId, editing.rule.areaId);
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

function RuleDialog({
  title,
  currency,
  initial,
  onClose,
  onSave,
}: {
  title: string;
  currency: string;
  initial: DepositRule;
  onClose: () => void;
  onSave: (rule: DepositRule | null) => void;
}) {
  const [rule, setRule] = useState(initial);
  const [error, setError] = useState('');
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <FormField label="Deposit">
          <Select
            value={rule.mode}
            onValueChange={(mode) =>
              setRule({
                ...rule,
                mode: mode as DepositRule['mode'],
                amount: mode === 'none' ? '0.00' : rule.amount,
              })
            }
          >
            <SelectTrigger aria-label="Deposit type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No deposit</SelectItem>
              <SelectItem value="per_guest">Fixed amount per guest</SelectItem>
              <SelectItem value="per_booking">Fixed amount per booking</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        {rule.mode !== 'none' ? (
          <>
            <FormField label={`Amount (${currency})`}>
              <Input
                aria-label="Deposit amount"
                inputMode="decimal"
                value={rule.amount}
                onChange={(e) => setRule({ ...rule, amount: e.target.value })}
              />
            </FormField>
            <FormField label="Only for groups of at least">
              <NumberStepper
                label="Minimum party"
                min={1}
                max={500}
                value={rule.minParty}
                onChange={(minParty) => setRule({ ...rule, minParty })}
              />
            </FormField>
            <FormField
              label="Free cancellation until"
              hint="Hours before the booking. Earlier cancellations qualify for a refund."
            >
              <NumberStepper
                label="Cancellation hours"
                min={0}
                max={8760}
                value={rule.freeCancelHours}
                onChange={(freeCancelHours) => setRule({ ...rule, freeCancelHours })}
              />
            </FormField>
          </>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
        <DialogFooter>
          {initial.serviceId ? (
            <Button variant="outline" onClick={() => onSave(null)}>
              Use inherited rule
            </Button>
          ) : null}
          <Button
            onClick={() => {
              if (
                rule.mode !== 'none' &&
                (!/^\d{1,10}(\.\d{1,2})?$/.test(rule.amount) || Number(rule.amount) <= 0)
              ) {
                setError('Enter a positive amount with at most two decimals.');
                return;
              }
              onSave(rule);
            }}
          >
            Apply rule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
