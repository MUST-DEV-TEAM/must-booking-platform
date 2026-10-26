'use client';

import { useEffect, useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '../../../components/ui/alert';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import type { AccommodationCsvKind, AccommodationCsvRow } from './room-management-csv';

type Preview = {
  kind: AccommodationCsvKind;
  rows: Array<{
    rowNumber: number;
    action: 'create' | 'update' | 'invalid';
    target: string;
    errors: string[];
  }>;
  summary: { create: number; update: number; errors: number };
  canConfirm: boolean;
};

/** Reviews a server-side dry run and confirms an accommodation CSV import. */
export function RoomManagementImportDialog({
  tenantId,
  propertyId,
  kind,
  rows,
  onOpenChange,
  onImported,
}: {
  tenantId: string;
  propertyId: string;
  kind: AccommodationCsvKind | null;
  rows: AccommodationCsvRow[];
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const open = kind !== null;
  const importUrl = `/api/tenants/${tenantId}/properties/${propertyId}/accommodations/import`;

  useEffect(() => {
    if (!kind) {
      setPreview(null);
      setError('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    setPreview(null);
    void fetch(`${importUrl}/preview`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, rows }),
    })
      .then(async (response) => {
        const result = (await response.json().catch(() => null)) as
          Preview | { message?: string } | null;
        if (!response.ok)
          throw new Error(
            result && 'message' in result ? result.message : 'Unable to preview this CSV.',
          );
        if (!cancelled) setPreview(result as Preview);
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : 'Unable to preview this CSV.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [importUrl, kind, rows]);

  async function confirmImport() {
    if (!kind || !preview?.canConfirm || saving) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${importUrl}/confirm`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, rows }),
      });
      const result = (await response.json().catch(() => null)) as
        Preview['summary'] | { message?: string; preview?: Preview } | null;
      if (!response.ok) {
        if (result && 'preview' in result && result.preview) setPreview(result.preview);
        throw new Error(
          result && 'message' in result ? result.message : 'Unable to import this CSV.',
        );
      }
      onImported();
      onOpenChange(false);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Unable to import this CSV.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(85vh,52rem)] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Review CSV import</DialogTitle>
          <DialogDescription>
            {kind === 'rooms' ? 'Rooms' : 'Room types'} will be matched by ID, or by exact name when
            the ID is blank. Review every row before confirming.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Import unavailable</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {loading ? <p className="m-0 text-sm text-muted-foreground">Checking rows…</p> : null}
        {preview ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2" aria-label="Import summary">
              <Badge variant="success">{preview.summary.create} to create</Badge>
              <Badge variant="info">{preview.summary.update} to update</Badge>
              {preview.summary.errors ? (
                <Badge variant="danger">{preview.summary.errors} with errors</Badge>
              ) : null}
            </div>
            {preview.rows.length ? (
              <Table containerClassName="max-h-80 rounded-md border">
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow>
                    <TableHead>CSV row</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Accommodation</TableHead>
                    <TableHead>Validation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((row) => (
                    <TableRow key={`${row.rowNumber}-${row.target}`}>
                      <TableCell>{row.rowNumber}</TableCell>
                      <TableCell>
                        <Badge variant={row.action === 'invalid' ? 'danger' : 'outline'}>
                          {row.action === 'invalid' ? 'Invalid' : row.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-64 truncate">{row.target}</TableCell>
                      <TableCell className="whitespace-normal">
                        {row.errors.length ? row.errors.join(' ') : 'Ready'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : null}
            {!preview.canConfirm ? (
              <Alert variant="warning">
                <AlertTitle>Fix the listed rows</AlertTitle>
                <AlertDescription>
                  The import stays disabled while any row has an error.
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={() => void confirmImport()}
            disabled={!preview?.canConfirm || loading || saving}
            loading={saving}
          >
            Import {preview?.rows.length ?? rows.length} rows
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
