import { HOTEL_LANGUAGES, PROPERTY_TYPES } from '@must/domain-contracts';
import { Prisma } from '@prisma/client';

/** The hotel facts a public website may show, as columns. Never the legal name, tax number or anything internal. */
export const publicProfileColumns = Prisma.raw(`
  p.chain_name AS "chainName", p.property_type AS "propertyType", p.star_rating AS "starRating",
  p.star_rating_official AS "starRatingOfficial", p.year_opened AS "yearOpened",
  p.year_renovated AS "yearRenovated", p.summary, p.description, p.languages,
  p.tourism_licence AS "tourismLicence", p.address_line_2 AS "addressLine2", p.city, p.region,
  p.postal_code AS "postalCode", p.country, p.latitude, p.longitude, p.directions,
  p.nearest_airport_code AS "nearestAirportCode", p.nearest_airport_km AS "nearestAirportKm",
  (SELECT count(*)::int FROM rooms r WHERE r.tenant_id=p.tenant_id AND r.property_id=p.id AND r.is_active) AS "roomCount"`);

export type PublicProfileRow = {
  chainName: string | null;
  propertyType: string | null;
  starRating: number | null;
  starRatingOfficial: boolean | null;
  yearOpened: number | null;
  yearRenovated: number | null;
  summary: string | null;
  description: string | null;
  languages: string[] | null;
  tourismLicence: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  directions: string | null;
  nearestAirportCode: string | null;
  nearestAirportKm: number | null;
  roomCount: number | null;
};

const regionName = (code: string) => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
};

/** What a website reads under `profile`: grouped, with codes turned into names, empty values left out as null. */
export function publicHotelProfile(row: PublicProfileRow) {
  const type = PROPERTY_TYPES.find((entry) => entry.value === row.propertyType);
  const pinned =
    typeof row.latitude === 'number' &&
    typeof row.longitude === 'number' &&
    Number.isFinite(row.latitude) &&
    Number.isFinite(row.longitude);
  return {
    chainName: row.chainName,
    propertyType: row.propertyType
      ? { code: row.propertyType, label: type?.label ?? row.propertyType }
      : null,
    starRating: row.starRating,
    /** True when the rating was issued by the national tourism authority. */
    starRatingOfficial: row.starRating ? row.starRatingOfficial === true : null,
    yearOpened: row.yearOpened,
    yearRenovated: row.yearRenovated,
    summary: row.summary,
    description: row.description,
    languages: (row.languages ?? []).map((code) => ({
      code,
      name: HOTEL_LANGUAGES.find((language) => language.code === code)?.name ?? code,
    })),
    roomCount: row.roomCount,
    tourismLicence: row.tourismLicence,
    location: {
      addressLine2: row.addressLine2,
      city: row.city,
      region: row.region,
      postalCode: row.postalCode,
      country: row.country ? { code: row.country, name: regionName(row.country) } : null,
      latitude: pinned ? row.latitude : null,
      longitude: pinned ? row.longitude : null,
      directions: row.directions,
      nearestAirport: row.nearestAirportCode
        ? { code: row.nearestAirportCode, distanceKm: row.nearestAirportKm }
        : null,
    },
  };
}
