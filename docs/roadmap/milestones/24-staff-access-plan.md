# Milestone 24 — Staff and access plan (decided 2026-10-17)

Decisions by the owner: (1) the hotel owner, and later a manager, creates staff directly and **chooses the password himself**, with a "generate a strong password" button; invitation by email stays as a second option. (2) Staff belong **per hotel**. (3) Claude plans and builds the backend, Codex builds the screens against the contract below, Claude verifies both together.

## What exists (verified in code)

- `PropertyRoleTemplate` (BUILT_IN or CUSTOM, per hotel) with a list of capabilities; `PropertyStaffAssignment` (one role per person per hotel); `PropertyStaffCapabilityOverride` (grant or deny one capability for one person).
- API: `GET/POST properties/:id/role-templates`, `PUT properties/:id/staff/:userId`, `PUT/DELETE .../staff/:userId/capabilities/:key`, `POST tenants/:id/staff-invitations`.
- All of it is guarded by the roles Owner and Admin, not by capabilities. Only 11 coarse capabilities exist.

## Permission catalog (built 2026-10-17, 21 permissions)

Only permissions that something enforces are listed; a permission that did nothing would mislead. Source of truth: `apps/api/src/tenancy/capability-catalog.ts`.

| Area | Keys | Enforced on |
| --- | --- | --- |
| Bookings | `bookings.view`, `bookings.create`, `bookings.edit`, `bookings.cancel` | list, search, detail; staff-created bookings; check/resend payment link; cancel |
| Calendar | `calendar.view`, `calendar.block` | availability and board reads; creating and removing blocks |
| Guests | `guests.view`, `guests.merge` | directory and duplicates; dismiss and merge |
| Payments | `payments.view`, `payments.record`, `payments.refund` | payment history; marking paid at the hotel; refunds |
| Accommodations | `accommodations.manage`, `photos.manage` | room types, rooms, amenities (changes); photos |
| Rates | `rates.manage` | rate plans and rules (changes) |
| Reports | `reports.view` | reports |
| Settings | `settings.manage` | hotel emails, notifications, review links and other settings routes that already allow staff |
| Staff | `staff.view`, `staff.create`, `staff.manage_roles`, `staff.manage_permissions`, `staff.suspend` | staff list, add staff, roles, a person's role and extras, suspend |

Left out until a feature exists: guest editing and export, report export, view-only settings, rooms and rates (reading rooms and rates stays open to any staff because booking needs it). Inventory and Settings pages stay Owner/Admin only in the menu.

Migration `20261017100000_staff_access` turns the old coarse permissions into these without changing anyone's access (`bookings.manage` became view, create, edit, cancel and record payments; `guests.manage` view and merge; `staff.invite` view and add; and so on) and deletes the old keys.

Built-in roles for new hotels: **Property Manager** all 21; **Front Desk** bookings (all four), calendar view, guests view and merge, record payments; **Finance** payments view and refund, bookings view (the payments screen is built from bookings), reports view.

## Rules (enforced by the server, shown by the UI)

1. Nobody can grant, give to a role, or create a staff member with a permission they do not have themselves.
2. Built-in roles cannot be edited or deleted; custom roles can be copied from any role.
3. A role that has members cannot be deleted (409 with the member count).
4. Only the Owner can create or change an Admin; the Owner cannot be removed, suspended or downgraded.
5. Suspending a person blocks their access to this hotel immediately (their other hotels and their account stay); their history stays.
6. Every create, role change, permission change and suspend is written to the audit log with who did it.
7. Passwords: at least 12 characters, one letter and one digit; the server stores only a hash; the password is never logged or returned.

## API contract (Claude builds, Codex codes against it)

All under `/api/tenants/:tenantId/properties/:propertyId`. Errors are `{ message }` with 400/403/404/409.

| Method and path | Body | Response |
| --- | --- | --- |
| `GET capabilities/catalog` | none | `[{ group: string, key: string, label: string, description: string }]` in display order |
| `GET role-templates` | none | `[{ id, name, kind: 'BUILT_IN'\|'CUSTOM', description: string\|null, capabilities: string[], memberCount: number }]` |
| `POST role-templates` | `{ name, description?, capabilities: string[], copyFromId? }` | the created role (same shape) |
| `PUT role-templates/:id` | `{ name?, description?, capabilities?: string[] }` | the updated role; 409 for built-in |
| `DELETE role-templates/:id` | none | 204; 409 if built-in or has members |
| `POST staff` | `{ firstName, lastName?, email, password, roleTemplateId, extraCapabilities?: string[], deniedCapabilities?: string[] }` | 201 `{ userId }`; 409 if the email already belongs to staff of this hotel |
| `PATCH staff/:userId/status` | `{ status: 'ACTIVE'\|'SUSPENDED' }` | 204 |
| `GET staff` | none | existing list, each item gains `firstName`, `lastName`, `status`, `lastActiveAt` (latest audited action by that person), `createdAt`, `createdByEmail` (nullable) |
| `GET staff/:userId/effective-capabilities` | none | `[{ key, granted: boolean, source: 'role'\|'extra'\|'denied'\|'none' }]` |

Not changed: invitation by email (`POST tenants/:tenantId/staff-invitations`) stays as the second way to add staff.

## Screens (Codex, after reading this file)

- Staff list: remove the "Hotel scope" column; rename "Role template" to **Role** and "Overrides" to **Extra permissions**; add Status and Last active columns and a Suspended tab; keep selector, bulk bar, quick peek.
- **Add staff** button opens a dialog with two tabs: **Create account** (name, email, role, password with show/hide, **Generate strong password**, copy, strength hint, optional extra permissions) and **Send invitation** (the existing invite). After creating, show a confirmation with the email and a Copy button for the password, once.
- **Roles** tab: list of roles with member counts; role editor as a permissions matrix grouped by area (checkboxes), built-in locked with a "Copy as custom role" action; delete blocked with the member count shown.
- Staff detail: effective permissions grouped by area with the source of each (Role / Extra / Denied), an editor for extras and denials, hotels, recent activity (audit), Suspend / Reactivate.
- New shared components as needed (`PasswordField` with generator, `PermissionMatrix`), built in `components/ui`.

## Status (2026-10-17)

Backend built and verified by Claude: migration applied locally, `StaffAccessService`, capability-based routes, 6 new end-to-end tests (create with chosen password and sign-in, roles, effective permissions, suspend, the grant-only-what-you-hold rule) and the existing staff, capability and page-visibility tests updated. Codex's C4 screens run against it without changes; checked in a browser: Add staff with a generated password, one-time copy, and the new person signing in to a Front Desk dashboard.

Known gaps: the invitation route (`POST tenants/:id/staff-invitations`) is still Owner/Admin only because it is not scoped to one hotel; "Last active" counts audited actions only; the Payments page still shows "Mark as paid" to people without `payments.record` (the server refuses); direct creation refuses an email that already has an account (use an invitation).
