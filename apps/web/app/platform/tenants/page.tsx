import { redirect } from 'next/navigation';

/** The old tenants list now lives under Hotels. */
export default function LegacyTenantsPage() {
  redirect('/platform/hotels');
}
