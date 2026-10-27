import type { Metadata } from 'next';

import '../dashboard/dashboard.css';
import { GuestReview } from './guest-review';

export const metadata: Metadata = {
  title: 'Rate your stay',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function Page() {
  return (
    <div className="ui-root">
      <GuestReview />
    </div>
  );
}
