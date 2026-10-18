'use client';
import { useState } from 'react';
import type { ReportColumn, ReportView, ViewConfiguration } from '../../lib/report-types';
import { reportLabel } from '../../lib/report-presentation';
import { ConfirmDialog } from './confirm-dialog';
import { FormField } from './form-field';
import { Input } from './input';
import { MultiSelect } from './multi-select';
import { Combobox } from './combobox';
/** Edits the presentation of a known report; filters come from the reviewed workspace. */
export function ReportViewEditor({
  view,
  configuration,
  columns,
  metricColumns,
  onClose,
  onSave,
}: {
  view?: ReportView;
  configuration: ViewConfiguration;
  columns: ReportColumn[];
  metricColumns: ReportColumn[];
  onClose: () => void;
  onSave: (body: {
    name: string;
    visibility: 'private' | 'team';
    configuration: ViewConfiguration;
    version?: number;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(view?.name ?? ''),
    [visibility, setVisibility] = useState<'private' | 'team'>(view?.visibility ?? 'private'),
    [config, setConfig] = useState(configuration);
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={view ? 'Edit saved view' : 'Save report view'}
      description="Saves the selected fixed dates and filters, columns and presentation. Team members run it with their own permissions."
      confirmLabel="Save view"
      confirmDisabled={!name.trim() || !config.columns.length || !config.metrics.length}
      onConfirm={() =>
        onSave({
          name,
          visibility,
          configuration: config,
          ...(view ? { version: view.version } : {}),
        })
      }
    >
      <FormField label="View name" htmlFor="report-view-name">
        <Input
          id="report-view-name"
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </FormField>
      <FormField label="Visibility">
        <Combobox
          label="View visibility"
          value={visibility}
          options={[
            { value: 'private', label: 'Private - only me' },
            { value: 'team', label: 'Hotel team' },
          ]}
          onChange={(v) => setVisibility(v as 'private' | 'team')}
        />
      </FormField>
      <FormField label="Columns">
        <MultiSelect
          label="Report columns"
          value={config.columns}
          options={columns.map((c) => ({ value: c.key, label: c.label }))}
          onChange={(v) => setConfig({ ...config, columns: v })}
        />
      </FormField>
      <FormField label="Metrics">
        <MultiSelect
          label="Report metrics"
          value={config.metrics}
          options={[
            ...new Set([
              'bookings',
              'cancelled',
              'cancellationRate',
              'averageLengthOfStay',
              'averageLeadDays',
              'soldNights',
              'availableNights',
              'occupancy',
              'blockedNights',
              'arrivals',
              'departures',
              ...metricColumns.map((c) => c.key),
            ]),
          ].map((value) => ({ value, label: reportLabel(value) }))}
          onChange={(v) => setConfig({ ...config, metrics: v })}
        />
      </FormField>
      <FormField label="Presentation">
        <Combobox
          label="View presentation"
          value={config.display}
          options={[
            { value: 'table', label: 'Table' },
            { value: 'chart', label: 'Chart' },
          ]}
          onChange={(v) => setConfig({ ...config, display: v as 'table' | 'chart' })}
        />
      </FormField>
      <FormField label="Chart metric">
        <Combobox
          label="Saved chart metric"
          value={config.chartMetric}
          options={metricColumns.map((c) => ({ value: c.key, label: c.label }))}
          onChange={(v) => setConfig({ ...config, chartMetric: v })}
        />
      </FormField>
    </ConfirmDialog>
  );
}
