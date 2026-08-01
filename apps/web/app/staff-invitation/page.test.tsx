import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import StaffInvitationPage from './page';

describe('Staff invitation page', () => {
  it('renders the shared auth shell while resolving an invitation', () => {
    const markup = renderToStaticMarkup(createElement(StaffInvitationPage));

    expect(markup).toContain('Run every stay');
    expect(markup).toContain('invited to join');
    expect(markup).toContain('SECURE INVITATION');
    expect(markup).toContain('Checking your invitation');
    expect(markup).toContain('Terms &amp; Conditions');
    expect(markup).toContain('Privacy Policy');
  });
});
