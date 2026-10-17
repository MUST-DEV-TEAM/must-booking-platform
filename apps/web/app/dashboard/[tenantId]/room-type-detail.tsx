'use client';

import { useState } from 'react';
import { ArrowLeft, BedDouble, Image as ImageIcon, Users, Wifi } from 'lucide-react';

import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card';
import { Checkbox } from '../../../components/ui/checkbox';
import { EmptyPanel } from '../../../components/ui/state-panel';
import { PageHeader } from '../../../components/ui/page-header';
import { StatTile } from '../../../components/ui/stat-tile';
import { TabBar } from '../../../components/ui/tab-bar';
import { amenityIconCatalog } from './amenity-icon-catalog';
import { RoomTypeMainImageSelector } from './room-type-main-image-selector';
import { RoomTypePhotoGallery } from './room-type-photo-gallery';
import type { Amenity, Room, RoomManagementData, RoomType } from './room-management-types';

type DetailTab = 'overview' | 'rooms' | 'photos' | 'amenities';

/** Room type profile, composed from the same dashboard components as the accommodation lists. */
export function RoomTypeDetail({
  tenantId,
  propertyId,
  data,
  roomType,
  canManageAccommodations,
  canManagePhotos,
  onBack,
  onEdit,
  onAddRoom,
  onEditRoom,
  onToggleAmenity,
}: {
  tenantId: string;
  propertyId: string;
  data: RoomManagementData;
  roomType: RoomType;
  canManageAccommodations: boolean;
  canManagePhotos: boolean;
  onBack: () => void;
  onEdit: (roomType: RoomType) => void;
  onAddRoom: (roomType: RoomType) => void;
  onEditRoom: (roomType: RoomType, room: Room) => void;
  onToggleAmenity: (roomTypeId: string, amenityId: string) => void;
}) {
  const [tab, setTab] = useState<DetailTab>('overview');
  const rooms = data.rooms[roomType.id] ?? [];
  const images = data.images[roomType.id] ?? [];
  const amenities = data.roomTypeAmenities[roomType.id] ?? [];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={roomType.name}
        description="Room type profile and guest-facing setup."
        actions={
          <>
            <Button variant="outline" onClick={onBack}>
              <ArrowLeft aria-hidden="true" /> Back to accommodations
            </Button>
            {canManageAccommodations ? (
              <Button onClick={() => onEdit(roomType)}>Edit room type</Button>
            ) : null}
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Physical rooms" value={rooms.length} icon={BedDouble} />
        <StatTile
          label="Maximum occupancy"
          value={`${roomType.maxOccupancy} guests`}
          icon={Users}
          size="sm"
        />
        <StatTile label="Amenities" value={amenities.length} icon={Wifi} />
        <StatTile
          label="Photos"
          value={canManagePhotos ? images.length : '—'}
          icon={ImageIcon}
          note={canManagePhotos ? undefined : 'Requires photos.manage'}
        />
      </div>
      <TabBar
        label="Room type details"
        current={tab}
        onSelect={(next) => setTab(next as DetailTab)}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'rooms', label: 'Rooms', count: rooms.length },
          { id: 'photos', label: 'Photos', count: canManagePhotos ? images.length : undefined },
          { id: 'amenities', label: 'Amenities', count: amenities.length },
        ]}
      />
      {tab === 'overview' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Overview</CardTitle>
              <CardDescription>Capacity and guest-facing description.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Detail label="Maximum occupancy" value={`${roomType.maxOccupancy} guests`} />
              <Detail label="Physical rooms" value={String(rooms.length)} />
              <Detail label="Description" value={roomType.description || 'Not set'} />
              <Detail label="Amenities introduction" value={roomType.amenitiesIntro || 'Not set'} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>At a glance</CardTitle>
              <CardDescription>Current room type assignments.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {amenities.length ? (
                <div className="flex flex-wrap gap-2">
                  {amenities.map((amenity) => (
                    <AmenityBadge key={amenity.id} amenity={amenity} />
                  ))}
                </div>
              ) : (
                <p className="m-0 text-sm text-muted-foreground">No amenities assigned.</p>
              )}
              {rooms.slice(0, 4).map((room) => (
                <div
                  key={room.id}
                  className="flex items-center justify-between gap-3 border-t pt-3"
                >
                  <span className="text-sm font-semibold">{room.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {room.viewType || 'View not set'}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      ) : null}
      {tab === 'rooms' ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div>
              <CardTitle>Physical rooms</CardTitle>
              <CardDescription>Rooms assigned to {roomType.name}.</CardDescription>
            </div>
            {canManageAccommodations ? (
              <Button onClick={() => onAddRoom(roomType)}>Add room</Button>
            ) : null}
          </CardHeader>
          <CardContent>
            {rooms.length ? (
              <div className="divide-y rounded-lg border">
                {rooms.map((room) => (
                  <div
                    key={room.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="m-0 font-semibold">{room.name}</p>
                      <p className="m-0 mt-1 text-sm text-muted-foreground">
                        {[
                          room.title,
                          room.viewType,
                          room.floor === null ? null : `Floor ${room.floor}`,
                        ]
                          .filter(Boolean)
                          .join(' · ') || 'Room details not set'}
                      </p>
                    </div>
                    {canManageAccommodations ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onEditRoom(roomType, room)}
                      >
                        Edit room
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyPanel
                title="No rooms assigned"
                description="Add physical rooms to this room type."
              />
            )}
          </CardContent>
        </Card>
      ) : null}
      {tab === 'photos' ? (
        canManagePhotos ? (
          <div className="flex flex-col gap-4">
            <RoomTypeMainImageSelector
              tenantId={tenantId}
              propertyId={propertyId}
              roomTypeId={roomType.id}
              roomTypeName={roomType.name}
              images={images}
            />
            <RoomTypePhotoGallery
              tenantId={tenantId}
              propertyId={propertyId}
              roomTypeId={roomType.id}
              images={images}
            />
          </div>
        ) : (
          <EmptyPanel
            title="Photo access is not available"
            description="You need photos.manage to view and manage this room type's photos."
          />
        )
      ) : null}
      {tab === 'amenities' ? (
        <Card>
          <CardHeader>
            <CardTitle>Amenities</CardTitle>
            <CardDescription>Features shown with this room type.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.amenities.length ? (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {data.amenities.map((amenity) => (
                  <label
                    key={amenity.id}
                    className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                  >
                    {canManageAccommodations ? (
                      <Checkbox
                        checked={amenities.some((item) => item.id === amenity.id)}
                        onCheckedChange={() => onToggleAmenity(roomType.id, amenity.id)}
                        aria-label={amenity.name}
                      />
                    ) : null}
                    <AmenityBadge amenity={amenity} />
                  </label>
                ))}
              </div>
            ) : (
              <EmptyPanel
                title="No property amenities"
                description="Add amenities in the accommodation list first."
              />
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 border-b pb-3 last:border-b-0 last:pb-0">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="whitespace-pre-wrap text-sm">{value}</span>
    </div>
  );
}

function AmenityBadge({ amenity }: { amenity: Amenity }) {
  const Icon = amenity.icon ? amenityIconCatalog[amenity.icon].icon : null;
  return (
    <Badge variant="muted" className="gap-1.5">
      {Icon ? <Icon aria-hidden="true" className="size-3.5" /> : null}
      {amenity.name}
    </Badge>
  );
}
