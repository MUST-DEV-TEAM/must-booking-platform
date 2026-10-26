export const reportNames = {
  overview: "Manager's flash",
  reservations: 'Reservations',
  revenue: 'Revenue & payments',
  occupancy: 'Occupancy & stay',
  accommodation: 'Accommodation',
  guests: 'Guests',
  pricing: 'Pricing & inventory',
  operations: 'Operations',
  quality: 'Data quality',
} as const;
export type ReportKind = keyof typeof reportNames;
export type ReportQuery = {
  report: ReportKind;
  from?: string;
  to?: string;
  comparison?: string;
  group?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
  direction?: string;
  detail?: string;
  rowBasis?: string;
  roomTypeId?: string;
  roomId?: string;
  ratePlanId?: string;
  status?: string;
  paymentMethod?: string;
  source?: string;
  bookingMode?: string;
  currency?: string;
};
export type ReportCell = string | number | boolean | null;
export type ReportRow = { id: string; [key: string]: ReportCell };
export type ReportColumn = {
  key: string;
  label: string;
  type: 'text' | 'number' | 'money' | 'percent' | 'date' | 'link';
  money?: boolean;
};
export type ReportDefinition = {
  key: string;
  label: string;
  formula: string;
  dateBasis: string;
  currencyBasis: string;
  money: boolean;
  source: string;
  limitations: string;
};
export type ReportWorkspace = {
  meta: {
    tenantId: string;
    propertyId: string;
    source: string;
    timezone: string;
    today: string;
    asOf: string;
    fingerprint: string;
    basis: string;
    moneyVisible: boolean;
    staffActivityVisible: boolean;
    hasData: boolean;
    warnings: string[];
    dateBases: Record<string, string>;
    coverage: { unknownNightlyBookings: number; invalidStays: number; supplyKnown: boolean };
    definitions: ReportDefinition[];
    drilldowns: Record<string, ReportQuery>;
  };
  query: ReportQuery;
  summary: Record<string, unknown>;
  series: ReportRow[];
  seriesColumns: ReportColumn[];
  columns: ReportColumn[];
  rows: ReportRow[];
  pagination: { page: number; pageSize: number; total: number; pages: number };
  comparison: {
    from: string;
    to: string;
    hasData: boolean;
    summary: Record<string, unknown> | null;
    series: ReportRow[];
  } | null;
  facets: {
    roomTypes: { value: string; label: string }[];
    rooms: { value: string; label: string; roomTypeId: string }[];
    ratePlans: { value: string; label: string }[];
    currencies: string[];
    sources: string[];
    bookingMode: string;
  };
};
export type ViewConfiguration = {
  query: ReportQuery;
  columns: string[];
  metrics: string[];
  display: 'table' | 'chart';
  chartMetric: string;
};
export type ReportView = {
  id: string;
  name: string;
  visibility: 'private' | 'team';
  ownerUserId: string;
  version: number;
  updatedAt: string;
  canEdit?: boolean;
  configuration: ViewConfiguration;
};
export type ReportExport = {
  exportId: string;
  filename: string;
  contentType: string;
  content: string;
  rowCount: number;
  asOf: string;
  fingerprint: string;
};
