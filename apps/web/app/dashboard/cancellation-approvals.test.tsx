// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardQueryProvider } from './query-provider';
import {
  CancellationPreview,
  type CancellationEvidence,
} from '../../components/ui/cancellation-preview';
import { CancellationDialog } from './cancellation-dialog';
import { ApprovalPanel, ApprovalsQueue, type Approval } from './approvals';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const evidence: CancellationEvidence = {
  bookingId: 'booking',
  reference: 'B1-100',
  version: 1,
  status: 'CONFIRMED',
  ratePlan: 'Flexible',
  timezone: 'Europe/Tirane',
  cutoffAt: '2030-07-08T22:00:00.000Z',
  isFree: true,
  currency: 'EUR',
  paid: '100.00',
  alreadyRefunded: '10.00',
  penalty: '0.00',
  eligible: '90.00',
  method: 'PAY_AT_PROPERTY',
  legacyPolicy: true,
  previewHash: 'hash',
};
const request: Approval = {
  id: 'request',
  bookingId: 'booking',
  requesterId: 'requester',
  requesterName: 'Ada Staff',
  version: 1,
  status: 'Pending',
  createdAt: '2026-10-19T10:00:00Z',
  reasonCategory: 'guest_request',
  priority: 'high',
  details: 'Travel plans changed',
  payload: { evidence, refundAmount: '90.00', input: { refund: 'eligible', notifyGuest: true } },
};
let root: Root | undefined;
async function mount(node: ReactNode) {
  const host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  await act(async () => root!.render(<DashboardQueryProvider>{node}</DashboardQueryProvider>));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});
const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text)!;
async function write(selector: string, value: string) {
  const el = document.querySelector<HTMLTextAreaElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
describe('B1 confirmation, refund preview, queue and review panel', () => {
  it('shows policy, local deadline, existing refunds and the amount before confirmation', async () => {
    await mount(<CancellationPreview evidence={evidence} refundAmount="90.00" />);
    expect(document.body.textContent).toContain('Europe/Tirane');
    expect(document.body.textContent).toContain('09/07/2030, 00:00:00');
    for (const text of [
      'Flexible',
      'Paid',
      'Penalty',
      'Already refunded',
      'Refund to issue',
      '90.00 EUR',
      'Cancellation terms are taken from the current rate plan.',
    ])
      expect(document.body.textContent).toContain(text);
  });
  it('defaults to eligible refund and submits an exception when cancel permission is missing', async () => {
    const fetch = vi.fn(
      async (_url: string, options?: RequestInit) =>
        new Response(
          JSON.stringify(
            options?.method === 'POST' ? { ok: true, request: { id: 'request' } } : evidence,
          ),
        ),
    );
    vi.stubGlobal('fetch', fetch);
    const close = vi.fn();
    await mount(
      <CancellationDialog
        tenantId="tenant"
        propertyId="hotel"
        bookingId="booking"
        open
        onOpenChange={close}
        canCancel={false}
        canRefund={false}
      />,
    );
    expect(document.body.textContent).toContain('Normal');
    expect(button('Submit request').disabled).toBe(true);
    expect(document.body.textContent).toContain('90.00 EUR');
    await write('textarea', 'Guest called reception');
    await act(async () => button('Submit request').click());
    const sent = fetch.mock.calls.find((c) => c[1]?.method === 'POST');
    expect(JSON.parse(sent?.[1]?.body as string)).toMatchObject({
      refund: 'eligible',
      notifyGuest: true,
      previewHash: 'hash',
      expectedVersion: 1,
      details: 'Guest called reception',
    });
    expect(close).toHaveBeenCalledWith(false);
  });
  it('shows the queue, opens evidence, and keeps decision disabled until a note is written', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ items: [request], count: 1 }))),
    );
    await mount(<ApprovalsQueue tenantId="tenant" propertyId="hotel" />);
    expect(document.querySelector('[aria-label="Filter by priority"]')).not.toBeNull();
    expect(document.body.textContent).toContain('High');
    expect(document.body.textContent).toContain('19/10/2026');
    expect(document.querySelector('[aria-label="Filter by age"]')).not.toBeNull();
    await act(async () => button('Review request').click());
    expect(document.body.textContent).toContain('Travel plans changed');
    expect(button('Approve').disabled).toBe(true);
    expect(button('Reject').disabled).toBe(true);
  });
  it('requires the note and sends rejection; failed approval keeps the evidence and error visible', async () => {
    const decide = vi.fn().mockRejectedValue(new Error('Clock cancellation needs review'));
    await mount(<ApprovalPanel request={request} onClose={() => {}} onDecide={decide} />);
    await write('textarea', 'Policy reviewed');
    await act(async () => button('Approve').click());
    expect(decide).toHaveBeenCalledWith('Approved', 'Policy reviewed');
    expect(
      [...document.querySelectorAll('[role="alert"]')].map((e) => e.textContent).join(' '),
    ).toContain('Clock cancellation needs review');
    await act(async () => button('Reject').click());
    expect(decide).toHaveBeenCalledWith('Rejected', 'Policy reviewed');
  });
  it('shows a persisted Self-approved badge and read-only note on a decided request', async () => {
    const decided = {
      ...request,
      status: 'Approved',
      selfApproved: true,
      decisionNote: 'Sole reviewer on duty',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ items: [], count: 0, decisions: [decided] })),
      ),
    );
    await mount(<ApprovalsQueue tenantId="tenant" propertyId="hotel" />);
    expect(document.body.textContent).toContain('Self-approved');
    await act(async () => button('View decision').click());
    expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe(
      'Sole reviewer on duty',
    );
    expect(document.querySelector<HTMLTextAreaElement>('textarea')?.readOnly).toBe(true);
    expect(button('Approve')).toBeUndefined();
    expect(button('Reject')).toBeUndefined();
  });
  it('renders the empty queue', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ items: [], count: 0 }))),
    );
    await mount(<ApprovalsQueue tenantId="tenant" propertyId="hotel" />);
    expect(document.body.textContent).toContain('No pending requests');
  });
});

it.each([true, false])(
  'Clock unknown terms default to zero and require explicit acknowledgement (refund capability=%s)',
  async (canRefund) => {
    const fetch = vi.fn(
      async (_url: string, options?: RequestInit) =>
        new Response(
          JSON.stringify(
            options?.method === 'POST'
              ? { ok: true }
              : {
                  ...evidence,
                  policySource: 'CLOCK_PMS',
                  cutoffAt: null,
                  isFree: false,
                  eligible: '0.00',
                  legacyPolicy: false,
                },
          ),
        ),
    );
    vi.stubGlobal('fetch', fetch);
    await mount(
      <CancellationDialog
        tenantId="t"
        propertyId="p"
        bookingId="b"
        open
        onOpenChange={vi.fn()}
        canCancel
        canRefund={canRefund}
      />,
    );
    expect(document.body.textContent).toContain('Cancellation terms are managed in Clock');
    expect(document.body.textContent).not.toContain('Outside the free-cancellation policy');
    const confirm = () => button(canRefund ? 'Cancel reservation' : 'Submit request');
    await write('textarea', 'Reviewed the Clock policy');
    expect(confirm().disabled).toBe(true);
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('[aria-label="Confirm Clock cancellation terms"]')!
        .click(),
    );
    expect(confirm().disabled).toBe(false);
    await act(async () => confirm().click());
    const sent = fetch.mock.calls.find((c) => c[1]?.method === 'POST');
    expect(JSON.parse(sent![1]!.body as string)).toMatchObject({
      refund: 'none',
      clockTermsConfirmed: true,
    });
  },
);
