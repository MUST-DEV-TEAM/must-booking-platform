'use client';

import { useEffect, useMemo, useState } from 'react';
import { BedDouble, DoorOpen, Download, Image as ImageIcon, Plus, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '../../../components/ui/avatar';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';
import { Checkbox } from '../../../components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu';
import { EmptyPanel, NoResultsPanel } from '../../../components/ui/state-panel';
import { Pagination } from '../../../components/ui/pagination';
import { QuickPeek } from '../../../components/ui/quick-peek';
import { SearchInput } from '../../../components/ui/search-input';
import { SortableTableHead } from '../../../components/ui/sortable-table-head';
import { TabBar } from '../../../components/ui/tab-bar';
import { BulkBar, ColumnChooser, DensityToggle } from '../../../components/ui/table-toolbar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import { useTablePreferences } from '../../../lib/use-table-preferences';
import type { Amenity, Room, RoomManagementData, RoomType } from './room-management-types';
import {
  CompactAmenities,
  RoomPeek,
  RoomRowActions,
  RoomTypePeek,
  RowActions,
  SummaryTile,
} from './room-management-details';

const columnLabels = {
  occupancy: 'Maximum occupancy',
  units: 'Physical rooms',
  amenities: 'Amenities',
  photos: 'Photos',
  roomType: 'Room type',
  floor: 'Floor',
  view: 'View',
  size: 'Room size',
} as const;
type ColumnKey = keyof typeof columnLabels;
type SortKey =
  'name' | 'occupancy' | 'units' | 'amenities' | 'photos' | 'roomType' | 'floor' | 'view' | 'size';
type PickedRow =
  | { kind: 'room-type'; id: string; item: RoomType }
  | { kind: 'room'; id: string; item: Room; roomType: RoomType };
type RoomLine = { room: Room; roomType: RoomType };
const defaultColumns: Record<ColumnKey, boolean> = {
  occupancy: true,
  units: true,
  amenities: true,
  photos: true,
  roomType: true,
  floor: true,
  view: true,
  size: true,
};
const pageSizes = [10, 25, 50] as const;

/** Room type and physical room directories, composed from the shared dashboard table primitives. */
export function RoomManagementLists({
  data,
  canManageAccommodations,
  canManagePhotos,
  canViewCalendar,
  onAddRoomType,
  onEditRoomType,
  onOpenRoomTypeDetail,
  onDeleteRoomType,
  onDuplicateRoomType,
  onAddRoom,
  onEditRoom,
  onDeleteRoom,
  onOpenCalendar,
  onManageAmenities,
  onToggleRoomTypeAmenity,
  onToggleRoomAmenity,
  onCustomizeRoomAmenities,
  onInheritRoomAmenities,
  customizingRoomAmenities,
}: {
  data: RoomManagementData;
  canManageAccommodations: boolean;
  canManagePhotos: boolean;
  canViewCalendar: boolean;
  onAddRoomType: () => void;
  onEditRoomType: (roomType: RoomType) => void;
  onOpenRoomTypeDetail: (roomType: RoomType) => void;
  onDeleteRoomType: (roomType: RoomType) => void;
  onDuplicateRoomType: (roomType: RoomType) => void;
  onAddRoom: (roomType: RoomType) => void;
  onEditRoom: (roomType: RoomType, room: Room) => void;
  onDeleteRoom: (roomType: RoomType, room: Room) => void;
  onOpenCalendar: (
    target:
      { kind: 'room-type'; roomType: RoomType } | { kind: 'room'; room: Room; roomType: RoomType },
  ) => void;
  onManageAmenities: () => void;
  onToggleRoomTypeAmenity: (roomTypeId: string, amenityId: string) => void;
  onToggleRoomAmenity: (roomId: string, amenityId: string) => void;
  onCustomizeRoomAmenities: (roomId: string, inherited: Amenity[]) => void;
  onInheritRoomAmenities: (roomId: string) => void;
  customizingRoomAmenities: Record<string, boolean>;
}) {
  const [view, setView] = useState<'room-types' | 'rooms'>('room-types');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({
    key: 'name',
    direction: 'asc',
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [peek, setPeek] = useState<PickedRow | null>(null);
  const { columns, density, toggleColumn, toggleDensity } = useTablePreferences(
    'must.accommodations.table',
    defaultColumns,
  );

  const roomLines = useMemo<RoomLine[]>(
    () =>
      data.roomTypes.flatMap((roomType) =>
        (data.rooms[roomType.id] ?? []).map((room) => ({ roomType, room })),
      ),
    [data.roomTypes, data.rooms],
  );
  const filteredTypes = useMemo(
    () =>
      data.roomTypes.filter((roomType) => {
        const text =
          `${roomType.name} ${roomType.description ?? ''} ${(data.roomTypeAmenities[roomType.id] ?? []).map((item) => item.name).join(' ')}`.toLocaleLowerCase();
        return text.includes(search.trim().toLocaleLowerCase());
      }),
    [data.roomTypes, data.roomTypeAmenities, search],
  );
  const filteredRooms = useMemo(
    () =>
      roomLines.filter(({ room, roomType }) => {
        const text =
          `${room.name} ${room.title ?? ''} ${room.viewType ?? ''} ${room.roomSize ?? ''} ${roomType.name}`.toLocaleLowerCase();
        return text.includes(search.trim().toLocaleLowerCase());
      }),
    [roomLines, search],
  );

  const rows = view === 'room-types' ? filteredTypes : filteredRooms;
  const sortedRows = useMemo(
    () =>
      [...rows].sort((left, right) => {
        const a = sortValue(left, sort.key, view, data);
        const b = sortValue(right, sort.key, view, data);
        const result =
          typeof a === 'number' && typeof b === 'number'
            ? a - b
            : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
        return sort.direction === 'asc' ? result : -result;
      }),
    [rows, sort, view, data],
  );
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);
  const rowPadding = density === 'compact' ? 'py-2' : 'py-4';
  const pageRows = sortedRows.slice((page - 1) * pageSize, page * pageSize);
  const pageKeys = pageRows.map((row) => rowKey(row, view));
  const allPageSelected = pageKeys.length > 0 && pageKeys.every((key) => selected.includes(key));
  const selectedRows = [
    ...filteredTypes.map((item) => ({ kind: 'room-type' as const, id: item.id, item })),
    ...filteredRooms.map(({ room, roomType }) => ({
      kind: 'room' as const,
      id: room.id,
      item: room,
      roomType,
    })),
  ].filter((row) => selected.includes(`${row.kind}:${row.id}`));

  function selectView(nextView: string) {
    setView(nextView as 'room-types' | 'rooms');
    setSearch('');
    setPage(1);
    setSelected([]);
    setPeek(null);
    setSort({ key: 'name', direction: 'asc' });
  }
  function toggleSort(key: SortKey) {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
  }
  function openPeek(row: RoomType | RoomLine) {
    setPeek(
      view === 'room-types'
        ? { kind: 'room-type', id: (row as RoomType).id, item: row as RoomType }
        : {
            kind: 'room',
            id: (row as RoomLine).room.id,
            item: (row as RoomLine).room,
            roomType: (row as RoomLine).roomType,
          },
    );
  }
  function toggleRow(key: string) {
    setSelected((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  }
  function togglePage() {
    setSelected((current) =>
      allPageSelected
        ? current.filter((key) => !pageKeys.includes(key))
        : [...new Set([...current, ...pageKeys])],
    );
  }
  function exportRows(rowsToExport: PickedRow[], filename: string) {
    const lines = rowsToExport.map((row) =>
      row.kind === 'room-type'
        ? [
            row.item.name,
            'Room type',
            String(row.item.maxOccupancy),
            String((data.rooms[row.id] ?? []).length),
            '',
          ]
        : [row.item.name, 'Physical room', '', '', row.roomType.name],
    );
    downloadCsv(
      ['Name', 'Kind', 'Maximum occupancy', 'Physical rooms', 'Room type'],
      lines,
      filename,
    );
  }
  async function copyRows() {
    const names = selectedRows.map((row) => row.item.name).join('\n');
    try {
      await navigator.clipboard.writeText(names);
      toast.success('Selected names copied.');
    } catch {
      toast.error('Clipboard access is unavailable.');
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryTile
          icon={BedDouble}
          label="Room types"
          value={data.roomTypes.length}
          detail="Sellable accommodation options"
        />
        <SummaryTile
          icon={DoorOpen}
          label="Physical rooms"
          value={roomLines.length}
          detail="Rooms assigned to a room type"
        />
        <SummaryTile
          icon={Sparkles}
          label="Amenities"
          value={data.amenities.length}
          detail="Property amenities available to assign"
        />
      </div>
      <Card className="gap-0 overflow-hidden py-0">
        <CardContent className="flex flex-col gap-4 p-4 sm:p-5">
          <TabBar
            label="Accommodation lists"
            current={view}
            onSelect={selectView}
            tabs={[
              { id: 'room-types', label: 'Room types', count: data.roomTypes.length },
              { id: 'rooms', label: 'Rooms', count: roomLines.length },
            ]}
          />
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <SearchInput
                aria-label={`Search ${view === 'room-types' ? 'room types' : 'rooms'}`}
                placeholder="Search by name or details"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                  setSelected([]);
                }}
                className="w-full sm:max-w-sm"
              />
              <Badge variant="muted">
                {view === 'room-types'
                  ? `${data.roomTypes.length} room types`
                  : `${roomLines.length} rooms`}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {view === 'room-types' ? (
                canManagePhotos ? (
                  <ColumnChooser<'occupancy' | 'units' | 'amenities' | 'photos'>
                    labels={{
                      occupancy: columnLabels.occupancy,
                      units: columnLabels.units,
                      amenities: columnLabels.amenities,
                      photos: columnLabels.photos,
                    }}
                    visible={{
                      occupancy: columns.occupancy,
                      units: columns.units,
                      amenities: columns.amenities,
                      photos: columns.photos,
                    }}
                    onToggle={(column) => toggleColumn(column)}
                  />
                ) : (
                  <ColumnChooser<'occupancy' | 'units' | 'amenities'>
                    labels={{
                      occupancy: columnLabels.occupancy,
                      units: columnLabels.units,
                      amenities: columnLabels.amenities,
                    }}
                    visible={{
                      occupancy: columns.occupancy,
                      units: columns.units,
                      amenities: columns.amenities,
                    }}
                    onToggle={(column) => toggleColumn(column)}
                  />
                )
              ) : (
                <ColumnChooser<'roomType' | 'floor' | 'view' | 'size'>
                  labels={{
                    roomType: columnLabels.roomType,
                    floor: columnLabels.floor,
                    view: columnLabels.view,
                    size: columnLabels.size,
                  }}
                  visible={{
                    roomType: columns.roomType,
                    floor: columns.floor,
                    view: columns.view,
                    size: columns.size,
                  }}
                  onToggle={(column) => toggleColumn(column)}
                />
              )}{' '}
              <DensityToggle compact={density === 'compact'} onToggle={toggleDensity} />
              <Button
                variant="outline"
                onClick={() =>
                  exportRows(
                    view === 'room-types'
                      ? filteredTypes.map((item) => ({
                          kind: 'room-type' as const,
                          id: item.id,
                          item,
                        }))
                      : filteredRooms.map(({ room, roomType }) => ({
                          kind: 'room' as const,
                          id: room.id,
                          item: room,
                          roomType,
                        })),
                    view === 'room-types' ? 'room-types.csv' : 'rooms.csv',
                  )
                }
              >
                <Download aria-hidden="true" /> Export CSV
              </Button>
              {canManageAccommodations ? (
                <Button variant="outline" onClick={onManageAmenities}>
                  Manage amenities
                </Button>
              ) : null}
              {canManageAccommodations && view === 'room-types' ? (
                <Button onClick={onAddRoomType}>
                  <Plus aria-hidden="true" /> Add room type
                </Button>
              ) : canManageAccommodations ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button>
                      <Plus aria-hidden="true" /> Add room
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {data.roomTypes.length ? (
                      data.roomTypes.map((roomType) => (
                        <DropdownMenuItem key={roomType.id} onSelect={() => onAddRoom(roomType)}>
                          Add to {roomType.name}
                        </DropdownMenuItem>
                      ))
                    ) : (
                      <DropdownMenuItem disabled>Add a room type first</DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          </div>
          <BulkBar count={selectedRows.length} noun="selected" onClear={() => setSelected([])}>
            <Button variant="outline" size="sm" onClick={() => void copyRows()}>
              Copy names
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportRows(selectedRows, 'accommodations-selected.csv')}
            >
              Export selected
            </Button>
          </BulkBar>
          {rows.length === 0 ? (
            search ? (
              <NoResultsPanel
                onClear={() => {
                  setSearch('');
                  setPage(1);
                }}
              />
            ) : view === 'room-types' ? (
              <EmptyPanel
                title="No room types yet"
                description="Create the sellable room types offered by this property."
                action={
                  canManageAccommodations ? (
                    <Button onClick={onAddRoomType}>
                      <Plus aria-hidden="true" /> Add room type
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <EmptyPanel
                title="No physical rooms yet"
                description={
                  data.roomTypes.length
                    ? 'Add physical rooms and assign them to a room type.'
                    : 'Create a room type before adding physical rooms.'
                }
              />
            )
          ) : (
            <>
              <Table containerClassName="max-h-[65vh]">
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        aria-label="Select all rows on this page"
                        checked={
                          allPageSelected
                            ? true
                            : pageKeys.some((key) => selected.includes(key))
                              ? 'indeterminate'
                              : false
                        }
                        onCheckedChange={togglePage}
                      />
                    </TableHead>
                    <SortableTableHead
                      label={view === 'room-types' ? 'Room type' : 'Room'}
                      active={sort.key === 'name'}
                      direction={sort.direction}
                      onSort={() => toggleSort('name')}
                    />
                    {view === 'room-types' ? (
                      <>
                        {columns.occupancy ? (
                          <SortableTableHead
                            label="Max guests"
                            active={sort.key === 'occupancy'}
                            direction={sort.direction}
                            onSort={() => toggleSort('occupancy')}
                            align="right"
                          />
                        ) : null}
                        {columns.units ? (
                          <SortableTableHead
                            label="Physical rooms"
                            active={sort.key === 'units'}
                            direction={sort.direction}
                            onSort={() => toggleSort('units')}
                            align="right"
                          />
                        ) : null}
                        {columns.amenities ? (
                          <SortableTableHead
                            label="Amenities"
                            active={sort.key === 'amenities'}
                            direction={sort.direction}
                            onSort={() => toggleSort('amenities')}
                          />
                        ) : null}
                        {canManagePhotos && columns.photos ? (
                          <SortableTableHead
                            label="Photos"
                            active={sort.key === 'photos'}
                            direction={sort.direction}
                            onSort={() => toggleSort('photos')}
                            align="right"
                          />
                        ) : null}
                      </>
                    ) : (
                      <>
                        {columns.roomType ? (
                          <SortableTableHead
                            label="Room type"
                            active={sort.key === 'roomType'}
                            direction={sort.direction}
                            onSort={() => toggleSort('roomType')}
                          />
                        ) : null}
                        {columns.floor ? (
                          <SortableTableHead
                            label="Floor"
                            active={sort.key === 'floor'}
                            direction={sort.direction}
                            onSort={() => toggleSort('floor')}
                            align="right"
                          />
                        ) : null}
                        {columns.view ? (
                          <SortableTableHead
                            label="View"
                            active={sort.key === 'view'}
                            direction={sort.direction}
                            onSort={() => toggleSort('view')}
                          />
                        ) : null}
                        {columns.size ? (
                          <SortableTableHead
                            label="Room size"
                            active={sort.key === 'size'}
                            direction={sort.direction}
                            onSort={() => toggleSort('size')}
                            align="right"
                          />
                        ) : null}
                      </>
                    )}
                    <TableHead className="w-10">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((row) => {
                    const key = rowKey(row, view);
                    const isSelected = selected.includes(key);
                    const type = view === 'room-types' ? (row as RoomType) : null;
                    const line = view === 'rooms' ? (row as RoomLine) : null;
                    const label = type?.name ?? line?.room.name ?? '';
                    return (
                      <TableRow
                        key={key}
                        data-state={isSelected ? 'selected' : undefined}
                        className="cursor-pointer"
                        onClick={(event) => {
                          if (
                            event.target instanceof HTMLElement &&
                            event.target.closest('button,[role=checkbox],[role=menuitem]')
                          )
                            return;
                          openPeek(row);
                        }}
                      >
                        <TableCell className={rowPadding}>
                          <Checkbox
                            aria-label={`Select ${label}`}
                            checked={isSelected}
                            onCheckedChange={() => toggleRow(key)}
                          />
                        </TableCell>
                        <TableCell className={`min-w-[200px] ${rowPadding}`}>
                          <div className="flex items-center gap-3">
                            {type ? (
                              <Avatar className="size-10 rounded-md">
                                <AvatarImage
                                  src={
                                    (data.images[type.id] ?? []).find((image) => image.isPrimary)
                                      ?.url ??
                                    type.mainImageUrl ??
                                    undefined
                                  }
                                  alt=""
                                />
                                <AvatarFallback>
                                  <ImageIcon aria-hidden="true" />
                                </AvatarFallback>
                              </Avatar>
                            ) : null}
                            <div className="min-w-0">
                              <Button
                                variant="link"
                                className="h-auto justify-start p-0 text-left font-semibold"
                                onClick={() => openPeek(row)}
                              >
                                {label}
                              </Button>
                              {density !== 'compact' ? (
                                <p className="m-0 mt-1 max-w-[28rem] truncate text-xs text-muted-foreground">
                                  {type?.description ||
                                    line?.room.title ||
                                    line?.room.description ||
                                    'Details not added'}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        </TableCell>
                        {type ? (
                          <>
                            {columns.occupancy ? (
                              <TableCell className={`${rowPadding} text-right tabular-nums`}>
                                {type.maxOccupancy}
                              </TableCell>
                            ) : null}
                            {columns.units ? (
                              <TableCell className={`${rowPadding} text-right tabular-nums`}>
                                {(data.rooms[type.id] ?? []).length}
                              </TableCell>
                            ) : null}
                            {columns.amenities ? (
                              <TableCell className={rowPadding}>
                                <CompactAmenities
                                  amenities={data.roomTypeAmenities[type.id] ?? []}
                                />
                              </TableCell>
                            ) : null}
                            {canManagePhotos && columns.photos ? (
                              <TableCell className={`${rowPadding} text-right tabular-nums`}>
                                {(data.images[type.id] ?? []).length}
                              </TableCell>
                            ) : null}
                            <TableCell className={`${rowPadding} text-right`}>
                              <RowActions
                                onPeek={() =>
                                  setPeek({ kind: 'room-type', id: type.id, item: type })
                                }
                                onDetails={() => onOpenRoomTypeDetail(type)}
                                onCalendar={() =>
                                  onOpenCalendar({ kind: 'room-type', roomType: type })
                                }
                                onEdit={() => onEditRoomType(type)}
                                onDelete={() => onDeleteRoomType(type)}
                                onDuplicate={() => onDuplicateRoomType(type)}
                                onAddRoom={() => onAddRoom(type)}
                                canManageAccommodations={canManageAccommodations}
                                canManagePhotos={canManagePhotos}
                                canViewCalendar={canViewCalendar}
                              />
                            </TableCell>
                          </>
                        ) : line ? (
                          <>
                            {columns.roomType ? (
                              <TableCell className={rowPadding}>{line.roomType.name}</TableCell>
                            ) : null}
                            {columns.floor ? (
                              <TableCell className={`${rowPadding} text-right tabular-nums`}>
                                {line.room.floor ?? '—'}
                              </TableCell>
                            ) : null}
                            {columns.view ? (
                              <TableCell className={rowPadding}>
                                {line.room.viewType || '—'}
                              </TableCell>
                            ) : null}
                            {columns.size ? (
                              <TableCell className={`${rowPadding} text-right`}>
                                {line.room.roomSize || '—'}
                              </TableCell>
                            ) : null}
                            <TableCell className={`${rowPadding} text-right`}>
                              <RoomRowActions
                                room={line.room}
                                onPeek={() =>
                                  setPeek({
                                    kind: 'room',
                                    id: line.room.id,
                                    item: line.room,
                                    roomType: line.roomType,
                                  })
                                }
                                onCalendar={() =>
                                  onOpenCalendar({
                                    kind: 'room',
                                    room: line.room,
                                    roomType: line.roomType,
                                  })
                                }
                                onEdit={() => onEditRoom(line.roomType, line.room)}
                                onDelete={() => onDeleteRoom(line.roomType, line.room)}
                                canManageAccommodations={canManageAccommodations}
                                canViewCalendar={canViewCalendar}
                              />
                            </TableCell>
                          </>
                        ) : null}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <Pagination
                page={page}
                pageSize={pageSize}
                total={sortedRows.length}
                onPage={setPage}
                pageSizeOptions={pageSizes}
                onPageSize={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
                noun={view === 'room-types' ? 'room types' : 'rooms'}
              />
            </>
          )}
        </CardContent>
      </Card>
      <QuickPeek
        open={peek !== null}
        onClose={() => setPeek(null)}
        title={
          peek?.kind === 'room-type' ? peek.item.name : peek?.kind === 'room' ? peek.item.name : ''
        }
        description={
          peek?.kind === 'room-type'
            ? 'Room type details'
            : peek?.kind === 'room'
              ? `Physical room · ${peek.roomType.name}`
              : undefined
        }
        badges={
          peek?.kind === 'room-type' ? (
            <>
              <Badge variant="secondary">Room type</Badge>
              <Badge variant="outline">Up to {peek.item.maxOccupancy} guests</Badge>
              <Badge variant="muted">{(data.rooms[peek.id] ?? []).length} physical rooms</Badge>
            </>
          ) : peek?.kind === 'room' ? (
            <>
              <Badge variant="secondary">Physical room</Badge>
              {peek.item.floor !== null ? (
                <Badge variant="outline">Floor {peek.item.floor}</Badge>
              ) : null}
            </>
          ) : undefined
        }
        actions={
          peek?.kind === 'room-type' ? (
            <>
              {canManageAccommodations ? (
                <Button
                  onClick={() => {
                    onEditRoomType(peek.item);
                    setPeek(null);
                  }}
                >
                  Edit details
                </Button>
              ) : null}
              <Button
                variant="outline"
                onClick={() => {
                  onOpenRoomTypeDetail(peek.item);
                  setPeek(null);
                }}
              >
                Open full details
              </Button>
              {canViewCalendar ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    onOpenCalendar({ kind: 'room-type', roomType: peek.item });
                    setPeek(null);
                  }}
                >
                  Calendar
                </Button>
              ) : null}
              {canManagePhotos ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    onEditRoomType(peek.item);
                    setPeek(null);
                  }}
                >
                  Manage photos
                </Button>
              ) : null}
              {canManageAccommodations ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    onAddRoom(peek.item);
                    setPeek(null);
                  }}
                >
                  Add physical room
                </Button>
              ) : null}
            </>
          ) : peek?.kind === 'room' ? (
            <>
              {canManageAccommodations ? (
                <Button
                  onClick={() => {
                    onEditRoom(peek.roomType, peek.item);
                    setPeek(null);
                  }}
                >
                  Edit room
                </Button>
              ) : null}
              {canViewCalendar ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    onOpenCalendar({ kind: 'room', room: peek.item, roomType: peek.roomType });
                    setPeek(null);
                  }}
                >
                  Calendar
                </Button>
              ) : null}
              {canManageAccommodations ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    onDeleteRoom(peek.roomType, peek.item);
                    setPeek(null);
                  }}
                >
                  Delete room
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      >
        {peek?.kind === 'room-type' ? (
          <RoomTypePeek
            data={data}
            roomType={peek.item}
            canManageAccommodations={canManageAccommodations}
            canManagePhotos={canManagePhotos}
            onAddRoom={onAddRoom}
            onEditRoom={onEditRoom}
            onToggleAmenity={onToggleRoomTypeAmenity}
          />
        ) : null}
        {peek?.kind === 'room' ? (
          <RoomPeek
            data={data}
            room={peek.item}
            roomType={peek.roomType}
            canManageAccommodations={canManageAccommodations}
            customizing={
              customizingRoomAmenities[peek.id] === true ||
              (data.roomAmenities[peek.id] ?? []).length > 0
            }
            onToggleAmenity={onToggleRoomAmenity}
            onCustomize={onCustomizeRoomAmenities}
            onInherit={onInheritRoomAmenities}
          />
        ) : null}
      </QuickPeek>
    </div>
  );
}

function sortValue(
  row: RoomType | RoomLine,
  key: SortKey,
  view: 'room-types' | 'rooms',
  data: RoomManagementData,
): string | number {
  if (view === 'room-types') {
    const roomType = row as RoomType;
    switch (key) {
      case 'occupancy':
        return roomType.maxOccupancy;
      case 'units':
        return (data.rooms[roomType.id] ?? []).length;
      case 'amenities':
        return (data.roomTypeAmenities[roomType.id] ?? []).length;
      case 'photos':
        return (data.images[roomType.id] ?? []).length;
      default:
        return roomType.name;
    }
  }
  const { room, roomType } = row as RoomLine;
  switch (key) {
    case 'roomType':
      return roomType.name;
    case 'floor':
      return room.floor ?? -1000;
    case 'view':
      return room.viewType ?? '';
    case 'size':
      return room.roomSize ?? '';
    default:
      return room.name;
  }
}
function rowKey(row: RoomType | RoomLine, view: 'room-types' | 'rooms') {
  return view === 'room-types'
    ? `room-type:${(row as RoomType).id}`
    : `room:${(row as RoomLine).room.id}`;
}
function downloadCsv(headers: string[], rows: string[][], filename: string) {
  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(','))
    .join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
  toast.success('CSV exported.');
}
