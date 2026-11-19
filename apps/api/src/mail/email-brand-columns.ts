import { Prisma } from '@prisma/client';

/**
 * The hotel facts every email needs beyond the basics, as SQL columns, so each email query adds them in one
 * line. `emailBrandExtra` is for queries on properties alone; `emailBrandExtraP` is for joins where the
 * property table is `p`.
 */
export const emailBrandExtra = Prisma.raw(
  'legal_name AS "legalName", tax_number AS "taxNumber", latitude, longitude, directions',
);
export const emailBrandExtraP = Prisma.raw(
  'p.legal_name AS "legalName", p.tax_number AS "taxNumber", p.latitude, p.longitude, p.directions',
);
