'use client';

import { useState } from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';

import { Button } from '../../../components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '../../../components/ui/card';
import { Checkbox } from '../../../components/ui/checkbox';
import { ConfirmDialog } from '../../../components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../../components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../../../components/ui/dropdown-menu';
import { FormField } from '../../../components/ui/form-field';
import { Input, Textarea } from '../../../components/ui/input';
import { MultiSelect } from '../../../components/ui/multi-select';
import { EmptyPanel } from '../../../components/ui/state-panel';
import { Switch } from '../../../components/ui/switch';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '../../../components/ui/table';
import { BulkBar, ColumnChooser, DensityToggle } from '../../../components/ui/table-toolbar';
import { Pagination } from '../../../components/ui/pagination';
import { SortableTableHead } from '../../../components/ui/sortable-table-head';
import { useTablePreferences } from '../../../lib/use-table-preferences';
import type { RoomCategory, RoomType } from './room-management-types';

const DEFAULT_COLUMNS = { description: true, count: true, visibility: true, updated: true };

type CategoryInput = { name: string; description: string; storefrontVisible: boolean };
type Editor = { category: RoomCategory | null; value: CategoryInput };

/** Searchable category table with shared edit, assignment and safe-delete dialogs. */
export function RoomCategoriesPanel({
  categories,
  roomTypes,
  canManage,
  saving,
  onCreate,
  onUpdate,
  onDelete,
  onReorder,
  onAssign,
}: {
  categories: RoomCategory[];
  roomTypes: RoomType[];
  canManage: boolean;
  saving: boolean;
  onCreate: (value: CategoryInput) => Promise<unknown>;
  onUpdate: (id: string, value: Partial<RoomCategory>) => Promise<unknown>;
  onDelete: (category: RoomCategory) => Promise<unknown>;
  onReorder: (ids: string[]) => Promise<unknown>;
  onAssign: (category: RoomCategory, ids: string[]) => Promise<unknown>;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState<{
    key: 'order' | 'name' | 'count' | 'updated';
    direction: 'asc' | 'desc';
  }>({ key: 'order', direction: 'asc' });
  const { columns, density, toggleColumn, toggleDensity } = useTablePreferences(
    'must.room-categories.table',
    DEFAULT_COLUMNS,
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [deleting, setDeleting] = useState<RoomCategory[]>([]);
  const [assignment, setAssignment] = useState<{ category: RoomCategory; ids: string[] } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = saving || busy;
  const ordered = [...categories].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  );
  const visible = ordered.filter((c) =>
    `${c.name} ${c.description ?? ''}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );
  const sorted = [...visible].sort((a, b) => {
    const difference =
      sort.key === 'name'
        ? a.name.localeCompare(b.name)
        : sort.key === 'count'
          ? a.roomCount - b.roomCount
          : sort.key === 'updated'
            ? (a.updatedAt ?? '').localeCompare(b.updatedAt ?? '')
            : a.sortOrder - b.sortOrder;
    return difference * (sort.direction === 'asc' ? 1 : -1);
  });
  const currentPage = Math.min(page, Math.max(1, Math.ceil(sorted.length / pageSize)));
  const pageRows = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  function heading(key: typeof sort.key, label: string) {
    return (
      <SortableTableHead
        label={label}
        active={sort.key === key}
        direction={sort.direction}
        onSort={() => {
          setPage(1);
          setSort({
            key,
            direction: sort.key === key && sort.direction === 'asc' ? 'desc' : 'asc',
          });
        }}
      />
    );
  }
  const chosen = categories.filter((c) => selected.includes(c.id));
  const value = editor?.value;
  const nameError = value
    ? !value.name.trim()
      ? 'Name is required.'
      : value.name.trim().length > 200
        ? 'Name must be at most 200 characters.'
        : categories.some(
              (c) =>
                c.id !== editor?.category?.id &&
                c.name.toLocaleLowerCase() === value.name.trim().toLocaleLowerCase(),
            )
          ? 'A category with this name already exists.'
          : null
    : null;
  const descriptionError =
    value && value.description.trim().length > 2000
      ? 'Description must be at most 2,000 characters.'
      : null;
  function openEditor(category: RoomCategory | null) {
    setError(null);
    setEditor({
      category,
      value: {
        name: category?.name ?? '',
        description: category?.description ?? '',
        storefrontVisible: category?.storefrontVisible ?? true,
      },
    });
  }
  async function run(action: () => Promise<unknown>, done?: () => void) {
    if (!canManage || pending) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      done?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save categories.');
    } finally {
      setBusy(false);
    }
  }
  function move(category: RoomCategory, direction: -1 | 1) {
    const index = ordered.findIndex((c) => c.id === category.id),
      next = index + direction;
    if (next < 0 || next >= ordered.length) return;
    const ids = ordered.map((c) => c.id);
    [ids[index], ids[next]] = [ids[next]!, ids[index]!];
    void run(() => onReorder(ids));
  }
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3 sm:flex-row">
        <div>
          <CardTitle>Room categories</CardTitle>
          <CardDescription>
            Group room types and choose their storefront order and visibility.
          </CardDescription>
        </div>
        {canManage ? (
          <Button disabled={pending} onClick={() => openEditor(null)}>
            <Plus aria-hidden="true" />
            Add category
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="mr-auto max-w-sm"
            aria-label="Search categories"
            placeholder="Search categories"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
          <ColumnChooser
            labels={{
              description: 'Description',
              count: 'Room types',
              visibility: 'Storefront',
              updated: 'Updated',
            }}
            visible={columns}
            onToggle={toggleColumn}
          />
          <DensityToggle compact={density === 'compact'} onToggle={toggleDensity} />
        </div>
        {error && !editor && !assignment ? (
          <p role="alert" className="m-0 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {canManage ? (
          <BulkBar count={chosen.length} onClear={() => setSelected([])}>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                void run(
                  async () => {
                    for (const c of chosen) await onUpdate(c.id, { storefrontVisible: true });
                  },
                  () => setSelected([]),
                )
              }
            >
              Show on storefront
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                void run(
                  async () => {
                    for (const c of chosen) await onUpdate(c.id, { storefrontVisible: false });
                  },
                  () => setSelected([]),
                )
              }
            >
              Hide on storefront
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={pending}
              onClick={() => setDeleting(chosen)}
            >
              Delete selected
            </Button>
          </BulkBar>
        ) : null}
        {visible.length ? (
          <Table
            containerClassName="max-h-[65vh]"
            className={density === 'compact' ? '[&_td]:py-2' : undefined}
          >
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                {canManage ? (
                  <TableHead className="w-10">
                    <Checkbox
                      aria-label="Select all categories"
                      checked={
                        visible.every((c) => selected.includes(c.id))
                          ? true
                          : visible.some((c) => selected.includes(c.id))
                            ? 'indeterminate'
                            : false
                      }
                      onCheckedChange={(checked) =>
                        setSelected(
                          checked
                            ? [...new Set([...selected, ...visible.map((c) => c.id)])]
                            : selected.filter((id) => !visible.some((c) => c.id === id)),
                        )
                      }
                    />
                  </TableHead>
                ) : null}
                {heading('order', 'Order')}
                {heading('name', 'Name')}
                {columns.description ? <TableHead>Description</TableHead> : null}
                {columns.count ? heading('count', 'Room types') : null}
                {columns.visibility ? <TableHead>Storefront</TableHead> : null}
                {columns.updated ? heading('updated', 'Updated') : null}
                {canManage ? (
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((c) => (
                <TableRow key={c.id}>
                  {canManage ? (
                    <TableCell>
                      <Checkbox
                        aria-label={`Select ${c.name}`}
                        checked={selected.includes(c.id)}
                        onCheckedChange={(checked) =>
                          setSelected(
                            checked ? [...selected, c.id] : selected.filter((id) => id !== c.id),
                          )
                        }
                      />
                    </TableCell>
                  ) : null}
                  <TableCell>{ordered.findIndex((item) => item.id === c.id) + 1}</TableCell>
                  <TableCell className="font-semibold">{c.name}</TableCell>
                  {columns.description ? (
                    <TableCell className="max-w-72 whitespace-normal">
                      {c.description || '?'}
                    </TableCell>
                  ) : null}
                  {columns.count ? (
                    <TableCell>
                      {c.roomCount} {c.roomCount === 1 ? 'room type' : 'room types'}
                    </TableCell>
                  ) : null}
                  {columns.visibility ? (
                    <TableCell>
                      <Switch
                        checked={c.storefrontVisible}
                        disabled={!canManage || pending}
                        aria-label={`${c.name} visible in storefront`}
                        onCheckedChange={(storefrontVisible) =>
                          void run(() => onUpdate(c.id, { storefrontVisible }))
                        }
                      />
                    </TableCell>
                  ) : null}
                  {columns.updated ? (
                    <TableCell>
                      {c.updatedAt ? (
                        <time dateTime={c.updatedAt} title={new Date(c.updatedAt).toLocaleString()}>
                          {new Date(c.updatedAt).toLocaleDateString()}
                        </time>
                      ) : (
                        '?'
                      )}
                    </TableCell>
                  ) : null}
                  {canManage ? (
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Actions for ${c.name}`}
                            disabled={pending}
                          >
                            <MoreHorizontal aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => openEditor(c)}>Edit</DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => {
                              setError(null);
                              setAssignment({
                                category: c,
                                ids: roomTypes
                                  .filter((t) => t.categoryId === c.id)
                                  .map((t) => t.id),
                              });
                            }}
                          >
                            Manage room types
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={ordered[0]?.id === c.id}
                            onSelect={() => move(c, -1)}
                          >
                            Move up
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={ordered.at(-1)?.id === c.id}
                            onSelect={() => move(c, 1)}
                          >
                            Move down
                          </DropdownMenuItem>
                          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting([c])}>
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyPanel
            title={categories.length ? 'No categories match' : 'No categories yet'}
            description={
              categories.length
                ? 'Try another search.'
                : 'Add a category to organize room types on the storefront.'
            }
            action={
              !categories.length && canManage ? (
                <Button onClick={() => openEditor(null)}>Add category</Button>
              ) : undefined
            }
          />
        )}
        <Pagination
          page={currentPage}
          pageSize={pageSize}
          total={visible.length}
          onPage={setPage}
          noun="categories"
          pageSizeOptions={[10, 25, 50]}
          onPageSize={(size) => {
            setPage(1);
            setPageSize(size);
          }}
        />
      </CardContent>
      <Dialog
        open={Boolean(editor)}
        onOpenChange={(open) => {
          if (!open && !pending) setEditor(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editor?.category ? 'Edit category' : 'Add category'}</DialogTitle>
            <DialogDescription>Choose a unique name and storefront visibility.</DialogDescription>
          </DialogHeader>
          {editor && value ? (
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (nameError || descriptionError) return;
                const input = {
                  ...value,
                  name: value.name.trim(),
                  description: value.description.trim(),
                };
                void run(
                  () => (editor.category ? onUpdate(editor.category.id, input) : onCreate(input)),
                  () => setEditor(null),
                );
              }}
            >
              <FormField label="Name" htmlFor="category-name" required error={nameError}>
                <Input
                  id="category-name"
                  value={value.name}
                  disabled={pending || !canManage}
                  aria-invalid={Boolean(nameError)}
                  onChange={(event) =>
                    setEditor({ ...editor, value: { ...value, name: event.target.value } })
                  }
                />
              </FormField>
              <FormField
                label="Description"
                htmlFor="category-description"
                error={descriptionError}
              >
                <Textarea
                  id="category-description"
                  value={value.description}
                  disabled={pending || !canManage}
                  onChange={(event) =>
                    setEditor({ ...editor, value: { ...value, description: event.target.value } })
                  }
                />
              </FormField>
              <FormField label="Visible on storefront" htmlFor="category-visible">
                <Switch
                  id="category-visible"
                  checked={value.storefrontVisible}
                  disabled={pending || !canManage}
                  onCheckedChange={(storefrontVisible) =>
                    setEditor({ ...editor, value: { ...value, storefrontVisible } })
                  }
                />
              </FormField>
              {error ? (
                <p role="alert" className="m-0 text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <DialogFooter>
                <Button variant="outline" disabled={pending} onClick={() => setEditor(null)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={!canManage || pending || Boolean(nameError || descriptionError)}
                  loading={pending}
                >
                  Save category
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(assignment)}
        onOpenChange={(open) => {
          if (!open && !pending) setAssignment(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage room types</DialogTitle>
            <DialogDescription>
              Selected types belong to {assignment?.category.name}. Removed types become
              uncategorized; selecting a type moves it from its previous category.
            </DialogDescription>
          </DialogHeader>
          {assignment ? (
            <MultiSelect
              label="Room types in category"
              placeholder="Choose room types"
              options={roomTypes.map((t) => ({
                value: t.id,
                label: t.name,
                description: t.categoryName ? `Current category: ${t.categoryName}` : 'No category',
              }))}
              value={assignment.ids}
              onChange={(ids) => setAssignment({ ...assignment, ids })}
              disabled={!canManage || pending}
              searchable
            />
          ) : null}
          {error ? (
            <p role="alert" className="m-0 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setAssignment(null)}>
              Cancel
            </Button>
            <Button
              disabled={!canManage || pending}
              loading={pending}
              onClick={() => {
                if (assignment)
                  void run(
                    () => onAssign(assignment.category, assignment.ids),
                    () => setAssignment(null),
                  );
              }}
            >
              Save room types
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleting.length > 0}
        onOpenChange={(open) => {
          if (!open) setDeleting([]);
        }}
        title={
          deleting.length === 1
            ? `Delete ${deleting[0]?.name}?`
            : `Delete ${deleting.length} categories?`
        }
        description={`${deleting.reduce((sum, c) => sum + c.roomCount, 0)} room types will become uncategorized. Room types and their rooms will be kept.`}
        confirmLabel="Delete categories"
        destructive
        confirmDisabled={!canManage || pending}
        onConfirm={async () => {
          if (!canManage) return;
          for (const c of deleting) await onDelete(c);
          setSelected([]);
        }}
      />
    </Card>
  );
}
