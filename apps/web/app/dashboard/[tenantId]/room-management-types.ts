import { amenityIcons, amenityIconLabel } from './amenity-icon-catalog';
import type { AmenityIcon } from './amenity-icon-catalog';

export type Property = { id: string; name: string };
export { amenityIcons, amenityIconLabel };
export type { AmenityIcon };
export type Amenity = { id: string; name: string; icon: AmenityIcon | null };
export type Room = {
  id: string;
  name: string;
  title: string | null;
  roomSize: string | null;
  rules: string | null;
  description: string | null;
  floor: number | null;
  viewType: string | null;
};
export type RoomType = {
  id: string;
  name: string;
  description: string | null;
  amenitiesIntro: string | null;
  mainImageUrl: string | null;
  galleryImageUrls: string[];
  maxOccupancy: number;
};
export type RoomTypeImage = { id: string; url: string; sortOrder: number; isPrimary: boolean };
export type RoomManagementData = {
  roomTypes: RoomType[];
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
  maxOccupancy: string;
};
export type RoomForm = {
  name: string;
  title: string;
  roomSize: string;
  rules: string;
  description: string;
  floor: string;
  viewType: string;
};

export const emptyRoomTypeForm: RoomTypeForm = {
  name: '',
  description: '',
  amenitiesIntro: '',
  maxOccupancy: '2',
};
export const emptyRoomForm: RoomForm = {
  name: '',
  title: '',
  roomSize: '',
  rules: '',
  description: '',
  floor: '',
  viewType: '',
};
