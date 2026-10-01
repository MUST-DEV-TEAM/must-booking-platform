/**
 * Every component exported from @must/ui must have an entry here, so the style guide cannot
 * silently fall behind the library (enforced by styleguide.test.tsx).
 *
 * - `documented`: shown on the style guide page, in the named section.
 * - `planned`: exists in the library but is not shown yet; `reason` says why and is displayed
 *   under "Planned" on the page.
 */
export type CoverageEntry =
  { status: 'documented'; section: string } | { status: 'planned'; reason: string };

export const styleguideCoverage: Record<string, CoverageEntry> = {
  Button: { status: 'documented', section: 'Form controls' },
  TextInput: { status: 'documented', section: 'Form controls' },
  NavigationSectionTabBar: { status: 'documented', section: 'Form controls' },
  NavigationSectionTabItem: { status: 'documented', section: 'Form controls' },
  NavigationPagination: { status: 'documented', section: 'Form controls' },
  Badge: { status: 'documented', section: 'Feedback' },
  StatusBadge: { status: 'documented', section: 'Feedback' },
  Alert: { status: 'documented', section: 'Feedback' },
  StatePanel: { status: 'documented', section: 'Feedback' },
  Card: { status: 'documented', section: 'Text and layout' },
  Heading: { status: 'documented', section: 'Text and layout' },
  Text: { status: 'documented', section: 'Text and layout' },
  Stack: { status: 'documented', section: 'Text and layout' },
  AppShell: {
    status: 'planned',
    reason: 'Page-level shell; needs a full-page preview rather than a specimen.',
  },
  SidebarNavigation: {
    status: 'planned',
    reason: 'Part of the app shell; shown in the live dashboard.',
  },
  MobileDrawerNavigation: {
    status: 'planned',
    reason: 'Part of the app shell; needs a phone-width preview.',
  },
};
