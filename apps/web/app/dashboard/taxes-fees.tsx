'use client';

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { DetailList } from '../../components/ui/detail-list';
import { QuickPeek } from '../../components/ui/quick-peek';
import { RecordDirectory, type RecordColumn } from '../../components/ui/record-directory';
import { EmptyPanel, ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';
import { TabBar } from '../../components/ui/tab-bar';
import { createInventoryWriter, inventoryRequest } from './inventory-api';
import { PricingEditor } from './pricing-editor';
import { PricingPreviewPanel } from './pricing-preview';
import { chargeBases, type PricingRecord, type PricingWorkspace } from './pricing-types';
import { settingsTabHref } from './settings-registry';

const categoryLabels: Record<string, string> = {
  vat: 'VAT',
  tourist_tax: 'Tourist tax',
  service: 'Service charge',
  other: 'Other',
};
const categoryOf = (record: PricingRecord) =>
  record.category ? (categoryLabels[record.category] ?? record.category) : 'Not classified';
const basisOf = (record: PricingRecord) =>
  chargeBases.find((basis) => basis.value === record.basis)?.label ?? record.basis ?? '';
const displayOf = (record: PricingRecord) =>
  record.display === 'added' ? 'Added as a separate line' : 'Included in the room price shown';

/**
 * Settings, Taxes and fees: the mandatory taxes and fees of this hotel (moved here from Rates &
 * Pricing, same saved records and the same editor), how prices are entered and shown, and an
 * example price. A hotel that works with Clock has its taxes calculated there.
 */
export function TaxesFeesSettings({
  tenantId,
  propertyId,
  canWrite: allowedToWrite,
}: {
  tenantId: string;
  propertyId: string;
  canWrite: boolean;
}) {
  const root = `/api/tenants/${tenantId}/properties/${propertyId}`;
  const base = `${root}/pricing`;
  const client = useQueryClient();
  const [view, setView] = useState('All');
  const [peek, setPeek] = useState<PricingRecord | null>(null);
  const [editor, setEditor] = useState<{ record?: PricingRecord } | null>(null);
  const [confirm, setConfirm] = useState<{ record: PricingRecord; action: string } | null>(null);
  const writer = useRef(createInventoryWriter());
  const query = useQuery({
    queryKey: ['dashboard', 'pricing', tenantId, propertyId],
    queryFn: () => inventoryRequest<PricingWorkspace>(base),
  });
  const history = useQuery({
    queryKey: [
      'dashboard',
      'pricing-history',
      tenantId,
      propertyId,
      'charges',
      peek?.id,
      peek?.version,
    ],
    enabled: !!peek,
    queryFn: () =>
      inventoryRequest<{ id: string; action: string; createdAt: string }[]>(
        `${base}/history/charges/${peek!.id}`,
      ),
  });
  const refresh = () =>
    client.invalidateQueries({ queryKey: ['dashboard', 'pricing', tenantId, propertyId] });

  if (query.error)
    return (
      <ErrorPanel
        title="Taxes and fees could not be loaded"
        description={query.error.message}
        onRetry={() => void query.refetch()}
      />
    );
  if (!query.data) return <ListSkeleton />;
  const data = query.data;
  const canWrite = allowedToWrite && !data.readOnly;

  if (data.readOnly)
    return (
      <EmptyPanel
        title="Taxes are calculated in Clock"
        description="This hotel's prices come from Clock PMS+, and the quote guests see already includes the taxes and fees set up there. Nothing is added here."
      />
    );

  const record = peek ? (data.charges.find((charge) => charge.id === peek.id) ?? peek) : null;
  const actions = (charge: PricingRecord) =>
    canWrite
      ? [
          ...(charge.lifecycle !== 'Archived'
            ? [
                { label: 'Edit', onSelect: () => setEditor({ record: charge }) },
                ...(charge.lifecycle === 'Draft'
                  ? [
                      {
                        label: 'Activate',
                        onSelect: () => setConfirm({ record: charge, action: 'activate' }),
                      },
                    ]
                  : []),
                {
                  label: 'Archive',
                  onSelect: () => setConfirm({ record: charge, action: 'archive' }),
                },
              ]
            : []),
          {
            label: 'Duplicate as draft',
            onSelect: () => setConfirm({ record: charge, action: 'duplicate' }),
          },
        ]
      : [];
  const columns: RecordColumn<PricingRecord>[] = [
    { id: 'name', label: 'Name', value: (r) => r.name },
    { id: 'type', label: 'Type', value: categoryOf },
    {
      id: 'amount',
      label: 'Amount',
      value: (r) => `${r.value ?? ''}${String(r.basis).startsWith('percentage') ? ' %' : ''}`,
    },
    { id: 'basis', label: 'Calculated as', value: basisOf },
    { id: 'display', label: 'Guests see it', value: displayOf },
    {
      id: 'status',
      label: 'Status',
      value: (r) => r.lifecycle,
      render: (r) => (
        <Badge variant={r.lifecycle === 'Active' ? 'success' : 'muted'}>{r.lifecycle}</Badge>
      ),
    },
  ];
  const rows = data.charges.filter((charge) => view === 'All' || charge.lifecycle === view);
  const facts = (charge: PricingRecord) => [
    { label: 'Status', value: charge.lifecycle },
    { label: 'Type', value: categoryOf(charge) },
    { label: 'Amount', value: charge.value },
    { label: 'Calculated as', value: basisOf(charge) },
    { label: 'Guests see it', value: displayOf(charge) },
    {
      label: 'Room types',
      value: charge.roomTypeIds.length
        ? charge.roomTypeIds
            .map((id) => data.roomTypes.find((t) => t.id === id)?.name ?? 'Removed room type')
            .join(', ')
        : 'All room types',
    },
    { label: 'Confirmed with the hotel', value: charge.confirmed ? 'Yes' : 'No' },
    { label: 'Version', value: charge.version },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:h-full">
        <Card>
          <CardHeader>
            <CardTitle>How you enter prices</CardTitle>
            <CardDescription>The rates you type in Rates & Pricing.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p className="m-0">
              Prices are entered <strong>before taxes and fees</strong>. The taxes and fees below
              are added on top when a guest gets a price.
            </p>
            <p className="m-0 text-muted-foreground">
              Whether the hotel is registered for VAT is set in{' '}
              <a href={settingsTabHref(tenantId, propertyId, 'profile')}>Profile</a>.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>What guests see</CardTitle>
            <CardDescription>
              On the booking page, in the quote and in the confirmation.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p className="m-0">
              Guests always see <strong>one total with every mandatory tax and fee included</strong>
              , as EU rules for price display expect.
            </p>
            <p className="m-0 text-muted-foreground">
              For each tax or fee you choose whether the breakdown shows it inside the room price or
              as its own line. The total stays the same.
            </p>
          </CardContent>
        </Card>
      </div>

      <section aria-label="Taxes and fees" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="m-0 text-base font-semibold">Taxes and fees</h3>
            <p className="m-0 text-sm text-muted-foreground">
              VAT, city or tourist tax and service charges that guests pay on top of the rate.
            </p>
          </div>
          {canWrite ? <Button onClick={() => setEditor({})}>Create tax or fee</Button> : null}
        </div>
        <TabBar
          label="Taxes and fees status"
          current={view}
          onSelect={setView}
          tabs={['All', 'Active', 'Draft', 'Archived'].map((status) => ({
            id: status,
            label: status,
            count: data.charges.filter((c) => status === 'All' || c.lifecycle === status).length,
          }))}
        />
        <RecordDirectory
          rows={rows}
          columns={columns}
          storageKey="must.settings.taxes-fees.table"
          onRow={setPeek}
          actions={actions}
          emptyTitle="No taxes or fees in this view"
        />
        <Alert>
          <AlertDescription>
            Coming soon: exempt children under a set age, and charge a tax for at most a set number
            of nights.
          </AlertDescription>
        </Alert>
      </section>

      <section aria-label="Example price" className="flex flex-col gap-3">
        <div>
          <h3 className="m-0 text-base font-semibold">Example price</h3>
          <p className="m-0 text-sm text-muted-foreground">
            Pick a stay to see every line a guest would get, with the taxes and fees applied.
          </p>
        </div>
        <PricingPreviewPanel base={base} data={data} />
      </section>

      {record ? (
        <QuickPeek
          open
          onClose={() => setPeek(null)}
          title={record.name}
          description="Tax or fee"
          badges={<Badge variant="outline">{record.lifecycle}</Badge>}
          actions={
            <>
              {actions(record).map((a) => (
                <Button key={a.label} variant="outline" onClick={a.onSelect}>
                  {a.label}
                </Button>
              ))}
            </>
          }
        >
          <DetailList items={facts(record)} />
          {history.data?.length ? (
            <ul className="m-0 mt-4 flex list-none flex-col gap-1 p-0 text-sm text-muted-foreground">
              {history.data.map((entry) => (
                <li key={entry.id}>
                  {entry.action} · {new Date(entry.createdAt).toLocaleString()}
                </li>
              ))}
            </ul>
          ) : null}
        </QuickPeek>
      ) : null}
      {editor && canWrite ? (
        <PricingEditor
          base={base}
          kind="charges"
          record={editor.record}
          data={data}
          onClose={() => setEditor(null)}
          onStored={() => void refresh()}
          onSaved={(saved) => {
            setEditor(null);
            setPeek(saved);
            void refresh();
          }}
        />
      ) : null}
      {confirm && canWrite ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setConfirm(null)}
          title={`${confirm.action[0]!.toUpperCase() + confirm.action.slice(1)} ${confirm.record.name}?`}
          description="Applies to future price calculations. Quotes already given and existing bookings keep their saved prices."
          confirmLabel="Confirm change"
          reasonLabel="Reason"
          reasonRequired
          onConfirm={async (reason) => {
            await writer.current(`${base}/charges/${confirm.record.id}/${confirm.action}`, 'POST', {
              version: confirm.record.version,
              changeReason: reason,
            });
            setConfirm(null);
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}
