import { amenityIcons, amenityIconLabel } from './amenity-icon-catalog';
import type { AmenityIcon } from './amenity-icon-catalog';

export type Property = { id: string; name: string };
export { amenityIcons, amenityIconLabel };
export type { AmenityIcon };
export type Amenity = { id: string; name: string; icon: AmenityIcon | null };
export type CreateAmenity = (name: string, icon: AmenityIcon | null) => Promise<Amenity>;
export type Room = {
  id: string;
  name: string;
  title: string | null;
  roomSize: string | null;
  rules: string | null;
  effectiveRules?: string | null;
  rulesSource?: 'room' | 'room-type' | null;
  description: string | null;
  floor: number | null;
  viewType: string | null;
  images?: RoomTypeImage[];
  photoSource?: 'room' | 'room_type' | 'none';
  isActive: boolean;
};
export type RoomType = {
  id: string;
  name: string;
  description: string | null;
  amenitiesIntro: string | null;
  rules?: string | null;
  effectiveRules?: string | null;
  rulesSource?: 'room-type' | null;
  mainImageUrl: string | null;
  galleryImageUrls: string[];
  maxOccupancy: number;
  status: 'DRAFT' | 'PUBLISHED' | 'HIDDEN';
  categoryId?: string | null;
  categoryName?: string | null;
  readiness?: {
    checks: Array<{
      key:
        | 'basicInfo'
        | 'occupancy'
        | 'rateRule'
        | 'rooms'
        | 'availabilitySource'
        | 'photos'
        | 'inventoryConflict';
      label: string;
      complete: boolean;
      fixLabel: string;
    }>;
    completeCount: number;
    missingCount: number;
    isComplete: boolean;
    firstFix: { key: string; label: string } | null;
  };
};
export type RoomCategory = {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  storefrontVisible: boolean;
  roomCount: number;
  updatedAt?: string;
};
export type AccommodationActivity = {
  id: string;
  actorUserId: string | null;
  actorName: string | null;
  action: string;
  targetType: string;
  targetId: string;
  targetName: string | null;
  details: Record<string, unknown>;
  createdAt: string;
};
export type RoomTypeImage = { id: string; url: string; sortOrder: number; isPrimary: boolean };
export type RoomManagementData = {
  roomTypes: RoomType[];
  categories: RoomCategory[];
  activity: AccommodationActivity[];
  amenities: Amenity[];
  rooms: Record<string, Room[]>;
  images: Record<string, RoomTypeImage[]>;
  roomTypeAmenities: Record<string, Amenity[]>;
  roomAmenities: Record<string, Amenity[]>;
};
export type RoomTypeForm = {
  name: string;
  description: string;
  amenitiesIntro: string;
  rules: string;
  maxOccupancy: string;
  status: 'DRAFT' | 'PUBLISHED' | 'HIDDEN';
  categoryId: string;
};
export type RoomForm = {
  name: string;
  title: string;
  roomSize: string;
  rules: string;
  description: string;
  floor: string;
  viewType: string;
  isActive: boolean;
};

export const emptyRoomTypeForm: RoomTypeForm = {
  name: '',
  description: '',
  amenitiesIntro: '',
  rules: '',
  maxOccupancy: '2',
  status: 'PUBLISHED',
  categoryId: '',
};
export const emptyRoomForm: RoomForm = {
  name: '',
  title: '',
  roomSize: '',
  rules: '',
  description: '',
  floor: '',
  viewType: '',
  isActive: true,
};
