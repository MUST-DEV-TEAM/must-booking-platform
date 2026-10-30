# Milestone 31: Delivery pipeline and website connector

Status: **Opened 2026-10-30.** Owner-approved plan; Phase 0 done the same day except task 3 (to be proven on the next plugin bump) and task 6a (vulnerable libraries). Evidence is recorded per row; nothing here changes Empire's website look.

## Goal

Two linked improvements, agreed with the owner on 2026-10-30:

1. **A faster, safer delivery pipeline.** A change should reach production in about 6-8 minutes instead of about 15, docs should cost nothing, and nothing should reach `main` or a live site without passing the tests.
2. **A connector for many websites.** The WordPress plugin becomes a general connector (connection to MUST, Elementor widgets, money display) with no look of its own, so one product serves many hotel websites, WordPress or not.

## Owner decisions (2026-10-30)

| # | Decision | Outcome |
| --- | --- | --- |
| 1 | Staging copy of the system | **No.** Protection comes from backups, automatic rollback, the live test booking and the version watchdog. |
| 2 | Who may merge to `main` | The owner and Denis (GitHub `deniszio`). Pull request and passing checks required; no force-pushes; emergency override for the owner. |
| 3 | Deploy timing | Normally an early-morning window (04:00 Albania time). "Merge now" from the owner deploys immediately. |
| 4 | Alerts | Recorded in GitHub (Issues and run pages) only. No assignment, no mentions, no email. |
| 5 | Empire's website | The current look is **final**. Nothing about it switches. Every plugin change is verified on `new.empirebeachresort.al`, the live site. |
| 6 | Plugin design | Hello Elementor stays the theme. No starter theme. The plugin keeps the connection, the Elementor widgets and the money logic and has no look of its own; each website's look is its own Elementor design and code. |
| 7 | Websites we build | Next.js and TypeScript for new custom sites; WordPress plus the connector where a hotel uses WordPress. The hotel starting next week is expected to be WordPress. |
| 8 | Separation | Separate the connector inside this repository first (own folder, version, release). Move it to its own repository after the Public API ([Milestone 26](26-public-api.md)) is frozen. |

## Findings behind the plan (read-only inventory, 2026-10-30)

- Plugin PHP by area: connection and shared code about 178 KB (`src/Core`), the four Elementor widgets and the currency switcher about 81 KB, the booking/checkout/confirmation pages about 161 KB, and two areas that look like leftovers of the old standalone booking engine: a local database layer about 285 KB (`src/Database`, payments, pricing rules, housekeeping) and an engine about 149 KB (`src/Engine`, emails and abuse protection).
- 16 plugin files use WordPress's own database; 7 use the MUST API client. **Whether the database layer and engine are still reached at runtime is not yet proven.** Task 13 proves it before anything is removed.
- The repository is public. On 2026-10-30 `main` had no branch protection, secret scanning was off, and dependency alerts were off.
- The plugin release started at merge, in parallel with the tests, and was not gated by them.
- Every push to `main` ran the full tests and a deploy, including documentation-only pushes.
- **2026-10-30, after enabling Dependabot alerts:** open advisories on libraries we use: `undici` (several high and medium, fixed in 8.12.2: cache poisoning, TLS certificate validation bypass, denial of service), `multer` (high, fixed in 2.5.0), `qs` (medium, 6.16.1), `fast-uri` (medium and low, 3.1.9). Dependabot opened PR #401 for `undici`; its updates for `multer` and `qs` failed, which usually means they are indirect dependencies that need an override in the lockfile. Not yet assessed for real exposure; `undici` is used for the API's outgoing requests.
- The test run takes about 11-12 minutes in one job; the browser and Clock jobs take about 3 minutes each.

## Tasks (in order)

Phase 0 (this week): small, safe, no behaviour change.

| # | Task | Status |
| --- | --- | --- |
| 1 | Documentation, markdown and workflow-only pushes to `main` skip the tests and the deploy | **Done 2026-10-30** (PR #399; verified: merging #399 and #400 started no CI run and no deploy) |
| 2 | Secret scanning with push protection, dependency alerts and automatic security updates | **Done 2026-10-30** (settings applied and read back through the GitHub API) |
| 3 | Plugin release starts only after the CI run for the same commit passes | Merged 2026-10-30 (PR #399). **Not yet proven live:** it acts only on the next plugin version bump; the version watchdog flags a missed release within 12 hours |
| 4 | Lock `main`: pull request and required checks, merge limited to the owner and Denis, no force-pushes | **Done 2026-10-30** (branch protection applied and read back: pull request, the three test jobs required, no force-pushes or deletions, merge limited to the owner and `zoidenis`, owner override kept) |
| 5 | Alerts without assignment or mentions | **Done 2026-10-30** (PR #399) |
| 6 | Cancel outdated pull-request runs; cache the test browser | **Done 2026-10-30** (PR #399) |
| 6a | Fix the known vulnerable libraries the new alerts found (see Findings) | In progress: Dependabot PR #401 (`undici`); `multer`, `qs` and `fast-uri` need a manual fix because Dependabot could not update them |

Phase 1 (next 1-2 weeks): faster and more trustworthy.

| # | Task | Status |
| --- | --- | --- |
| 7 | Fix the two unit tests that need `WEB_APP_URL` in a fresh checkout, make the platform-audit e2e independent of leftover data, add a one-command local setup | Planned |
| 8 | Run the tests as parallel groups, each with its own database | Planned |
| 9 | Run and deploy only what changed (docs, plugin, web, API) | Planned |
| 10 | Build the images once and deploy the tested build | Planned |
| 11 | Deploy window with a "deploy now" label and a visible list of pending changes | Planned |
| 12 | Database-change safety check in CI; weekly pipeline report | Planned |

Phase 2: separate the connector inside this repository.

| # | Task | Status |
| --- | --- | --- |
| 13 | Prove which plugin areas are unused at runtime on Empire (browser tests as evidence), then list connector, widgets, pages and leftovers | Planned |
| 14 | Write the connector's rules: what it offers, what it never does (no pricing logic, no look), stable widget names | Planned |
| 15 | Move currency arithmetic to the API so prices arrive already converted; the plugin only prints them | Planned |
| 16 | Give the connector its own folder, version and release pipeline | Planned |
| 17 | Remove the code proven unused in Task 13 | Planned |
| 18 | Compatibility safeguard: admin notice when the plugin is too old for the API; dashboard list of connector versions per hotel | Planned |

Phase 3: many websites (needs its own plan before work starts).

| # | Task | Status |
| --- | --- | --- |
| 19 | Small TypeScript client for the existing public endpoints (for sites we build) | Planned |
| 20 | [Milestone 26](26-public-api.md): per-hotel keys, versioned interface, documentation | Planned |
| 21 | Embeddable booking blocks and a hosted booking page in the hotel's colours | Planned |
| 22 | Move the connector into its own repository once the interface is frozen | Planned |
| 23 | Next.js website kit for custom sites | Planned |

## Open points

- Whether `main` should also require a second approver. Not planned: the owner's pull requests would then need Denis for every merge.
- The exact time zone handling of the deploy window (Albania time, 04:00) is decided at Task 11.
