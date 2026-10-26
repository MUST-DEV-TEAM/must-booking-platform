import type { Metadata } from 'next';
import { GuestBookingManage } from './guest-booking-manage';
import '../../dashboard/dashboard.css';
export const metadata: Metadata = {
  title: 'Manage your booking',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default function Page() {
  return (
    <div className="ui-root">
      <GuestBookingManage />
    </div>
  );
}
