'use client';

import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { DetailList } from '../../components/ui/detail-list';
import { PageHero } from '../../components/ui/page-hero';

const planned = 'Not available yet';

/**
 * The signed-in user's own page (opened from the account menu, "Profile"). The identity part is
 * real; password, sessions and personal notification choices are planned (Milestone 24, S15).
 */
export function MyAccount({
  email,
  role,
  hotelName,
}: {
  email?: string;
  role?: string;
  hotelName?: string;
}) {
  return (
    <div className="space-y-4">
      <PageHero
        eyebrow="Account"
        title="My account"
        description="Your sign-in details and personal preferences."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                { label: 'Email', value: email },
                { label: 'Role', value: role },
                { label: 'Current hotel', value: hotelName },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Security</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                { label: 'Password', value: planned },
                { label: 'Active sessions', value: planned },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Preferences</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                { label: 'Language', value: planned },
                { label: 'Notification choices', value: planned },
              ]}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
