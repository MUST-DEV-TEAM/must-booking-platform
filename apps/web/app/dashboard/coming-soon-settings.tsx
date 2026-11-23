'use client';

import { ComingSoonCard } from '../../components/ui/coming-soon-card';

const exampleRow =
  'flex flex-wrap items-center justify-between gap-2 border-b py-2 last:border-b-0';

/**
 * Settings screens that are designed but not working yet (the owner wants to see the whole system's
 * look first). Each says what it will do and shows a labelled example; none has a working button.
 */

/** Policies: the cancellation and prepayment policy library (G-98). */
export function CancellationPoliciesSoon({ freeDays }: { freeDays: number }) {
  return (
    <ComingSoonCard
      title="Cancellation and prepayment policies"
      description={`Today the rule is one number: free cancellation up to ${freeDays} ${freeDays === 1 ? 'day' : 'days'} before arrival (set in Booking rules). After that the whole stay is charged.`}
      bullets={[
        'Make ready-made policies such as Flexible, Moderate and Non-refundable.',
        'Choose a free window in days or hours, and what is charged after it: the first night, a percentage, a fixed amount or the whole stay.',
        'Set what happens on a no-show.',
        'Choose how much guests pay when they book, per rate plan.',
        'Guests read the policy of the rate they picked, on the booking page and in their email.',
      ]}
      example="Example, not active"
    >
      <div className="flex flex-col">
        {[
          ['Flexible', 'Free until 1 day before arrival, then the first night'],
          ['Moderate', 'Free until 7 days before arrival, then 50% of the stay'],
          ['Non-refundable', 'Nothing is refunded. Guests pay the whole stay when they book'],
        ].map(([name, rule]) => (
          <div key={name} className={exampleRow}>
            <span className="font-medium">{name}</span>
            <span className="text-muted-foreground">{rule}</span>
          </div>
        ))}
      </div>
    </ComingSoonCard>
  );
}

/** Team and roles, Invitations: pending, expired and accepted invitations (G-85). */
export function InvitationsSoon() {
  return (
    <ComingSoonCard
      title="Invitations"
      description="Invitations you send are kept in a list, so a wrong address is never left open."
      bullets={[
        'See every invitation: waiting, expired or accepted.',
        'Send an invitation again, or withdraw it.',
        'An invitation is valid for 7 days.',
      ]}
    >
      <div className="flex flex-col">
        {[
          ['ana@example.com', 'Front desk', 'Waiting · expires in 5 days'],
          ['marko@example.com', 'Finance', 'Expired 2 days ago'],
          ['elira@example.com', 'Manager', 'Accepted'],
        ].map(([email, role, state]) => (
          <div key={email} className={exampleRow}>
            <span className="font-medium">{email}</span>
            <span className="text-muted-foreground">{role}</span>
            <span className="text-muted-foreground">{state}</span>
          </div>
        ))}
      </div>
    </ComingSoonCard>
  );
}

/** Team and roles, Security: two-step sign-in (G-89) and ownership transfer (G-87). */
export function SecuritySoon() {
  return (
    <div className="grid gap-4 lg:grid-cols-2 [&>*]:h-full">
      <ComingSoonCard
        title="Two-step sign-in"
        description="A second check with an authenticator app, on top of the password."
        bullets={[
          'Each person can switch it on for their own account.',
          'The owner can require it for everyone. It is off by default.',
          'When it is required, each person sets it up the next time they sign in.',
          'Sign a person out of all devices, for example when suspending them.',
        ]}
      />
      <ComingSoonCard
        title="Ownership"
        description="There is always exactly one owner of the account."
        bullets={[
          'The owner picks an admin to take over.',
          'The admin accepts by email, and both are told.',
          'The previous owner becomes an admin, and the change is recorded in the audit log.',
        ]}
      />
    </div>
  );
}

/** Plan and usage: changing the plan and billing (issue #543). */
export function PlanChangeSoon() {
  return (
    <div className="grid gap-4 lg:grid-cols-2 [&>*]:h-full">
      <ComingSoonCard
        title="Ask to change your plan"
        description="For now, plan changes go through MUST."
        bullets={[
          'Pick the plan you want and add a note.',
          'MUST gets the request, and the owner is emailed when it is done.',
        ]}
      />
      <ComingSoonCard
        title="Billing and invoices"
        description="Available when paid plans start."
        bullets={[
          'Billing company, tax number and billing email.',
          'Your card, kept by Stripe.',
          'Invoices and cancellation.',
        ]}
      />
    </div>
  );
}
