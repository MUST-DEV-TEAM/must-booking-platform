import { expect, test } from '@playwright/test';

import {
  cleanupE2EData,
  capturedEmailLink,
  closeE2EDatabase,
  createInvitation,
  createRoleTemplate,
  credentials,
  currentTenant,
  login,
  membershipCount,
  promoteToPlatformAdmin,
  resetSignupRateLimit,
  signup,
  verifyEmail,
} from './support';

test.beforeEach(async () => {
  await resetSignupRateLimit();
});

test.afterEach(async () => {
  await cleanupE2EData();
});

test.afterAll(async () => {
  await closeE2EDatabase();
});

test('signup, verification, login, and tenant/platform redirects run against the app', async ({
  browser,
}) => {
  const tenantAccount = credentials('tenant');
  const tenantContext = await browser.newContext();
  const tenantPage = await tenantContext.newPage();

  try {
    await signup(tenantPage, tenantAccount);
    await verifyEmail(tenantPage, tenantAccount);
    await expect(tenantPage.getByRole('heading', { name: 'Choose a workspace' })).toBeVisible();

    const signedOutTenantContext = await browser.newContext();
    const signedOutTenantPage = await signedOutTenantContext.newPage();
    try {
      await login(signedOutTenantPage, tenantAccount);
      await expect(signedOutTenantPage).toHaveURL(/\/dashboard$/);
      await expect(
        signedOutTenantPage.getByRole('heading', { name: 'Choose a workspace' }),
      ).toBeVisible();
    } finally {
      await signedOutTenantContext.close();
    }

    const platformAccount = credentials('platform');
    const platformSignupContext = await browser.newContext();
    const platformSignupPage = await platformSignupContext.newPage();
    try {
      await signup(platformSignupPage, platformAccount);
      await verifyEmail(platformSignupPage, platformAccount);
      const platformTenant = await currentTenant(platformSignupPage);
      await promoteToPlatformAdmin(platformTenant.tenantId, platformAccount.email);
    } finally {
      await platformSignupContext.close();
    }

    const platformLoginContext = await browser.newContext();
    const platformLoginPage = await platformLoginContext.newPage();
    try {
      await login(platformLoginPage, platformAccount);
      await expect(platformLoginPage).toHaveURL(/\/platform$/);
      await expect(
        platformLoginPage.getByRole('heading', { name: 'Platform operations' }),
      ).toBeVisible();
    } finally {
      await platformLoginContext.close();
    }
  } finally {
    await tenantContext.close();
  }
});

test('forgot-password follows the captured email link and signs in with the new password', async ({
  browser,
}) => {
  const account = credentials('reset');
  const signupContext = await browser.newContext();
  const signupPage = await signupContext.newPage();
  const updatedPassword = `${account.password}-updated`;

  try {
    await signup(signupPage, account);
    await verifyEmail(signupPage, account);

    await signupPage.goto('/forgot-password');
    await signupPage.getByLabel('Email address').fill(account.email);
    await signupPage.getByRole('button', { name: 'Send reset link' }).click();
    await expect(signupPage.getByRole('heading', { name: 'Check your inbox.' })).toBeVisible();

    const resetLink = await capturedEmailLink(
      account.email,
      'Reset your MUST Booking password',
      '/reset-password',
    );

    await signupPage.goto(resetLink);
    await signupPage.getByRole('textbox', { name: /^New password/ }).fill(updatedPassword);
    await signupPage.getByRole('textbox', { name: /^Confirm new password/ }).fill(updatedPassword);
    await signupPage.getByRole('button', { name: 'Reset password' }).click();
    await expect(
      signupPage.getByRole('heading', { name: 'Access restored safely.' }),
    ).toBeVisible();

    const loginContext = await browser.newContext();
    const loginPage = await loginContext.newPage();
    try {
      await login(loginPage, { ...account, password: updatedPassword });
      await expect(loginPage).toHaveURL(/\/dashboard$/);
      await expect(loginPage.getByRole('heading', { name: 'Choose a workspace' })).toBeVisible();
    } finally {
      await loginContext.close();
    }
  } finally {
    await signupContext.close();
  }
});

test('staff invitation activation creates the invited account in the browser', async ({
  browser,
}) => {
  const owner = credentials('invite-owner');
  const invitee = credentials('invite-activate');
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();

  try {
    await signup(ownerPage, owner);
    await verifyEmail(ownerPage, owner);
    const tenant = await currentTenant(ownerPage);
    const roleTemplateId = await createRoleTemplate(tenant.tenantId, tenant.propertyId);
    const token = await createInvitation(ownerPage, {
      ...tenant,
      roleTemplateId,
      email: invitee.email,
    });

    const inviteeContext = await browser.newContext();
    const inviteePage = await inviteeContext.newPage();
    try {
      await inviteePage.goto(`/staff-invitation?token=${encodeURIComponent(token)}`);
      await expect(
        inviteePage.getByRole('heading', { name: 'Join your hotel team.' }),
      ).toBeVisible();
      await inviteePage.getByLabel('Email address').fill(invitee.email);
      await inviteePage.getByLabel(/^Password/).fill(invitee.password);
      await inviteePage.getByLabel(/^Confirm password/).fill(invitee.password);
      await inviteePage.getByRole('button', { name: 'Create account & accept invitation' }).click();
      await expect(
        inviteePage.getByRole('heading', { name: 'Welcome to the team.' }),
      ).toBeVisible();
      await expect(inviteePage.getByText('Go to sign in')).toBeVisible();
    } finally {
      await inviteeContext.close();
    }
  } finally {
    await ownerContext.close();
  }
});

test('staff invitation acceptance grants access to an existing signed-in account', async ({
  browser,
}) => {
  const owner = credentials('invite-owner-existing');
  const existingUser = credentials('invite-existing');
  const ownerContext = await browser.newContext();
  const existingContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const existingPage = await existingContext.newPage();

  try {
    await signup(ownerPage, owner);
    await verifyEmail(ownerPage, owner);
    const tenant = await currentTenant(ownerPage);
    const roleTemplateId = await createRoleTemplate(tenant.tenantId, tenant.propertyId);

    await signup(existingPage, existingUser);
    await verifyEmail(existingPage, existingUser);

    const token = await createInvitation(ownerPage, {
      ...tenant,
      roleTemplateId,
      email: existingUser.email,
    });
    await existingPage.goto(`/staff-invitation?token=${encodeURIComponent(token)}`);
    await expect(
      existingPage.getByText(`You're signed in as ${existingUser.email}.`),
    ).toBeVisible();
    await existingPage.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(existingPage.getByRole('heading', { name: 'Welcome to the team.' })).toBeVisible();
    await expect(existingPage.getByText('Continue to workspace')).toBeVisible();
    await expect.poll(() => membershipCount(existingPage)).toBe(2);
  } finally {
    await ownerContext.close();
    await existingContext.close();
  }
});
