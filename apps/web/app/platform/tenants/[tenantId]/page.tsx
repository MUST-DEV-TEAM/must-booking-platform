import { redirect } from 'next/navigation';

/** The old tenant page now lives under Hotels. */
export default async function LegacyTenantPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  redirect(`/platform/hotels/${encodeURIComponent(tenantId)}`);
}
