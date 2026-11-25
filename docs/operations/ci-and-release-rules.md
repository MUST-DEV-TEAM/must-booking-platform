# Tests, merging and releasing: the rules we work by

Written 2026-11-25 after the first big merge (23 pull requests in four waves). It records what the owner decided and what we learned, so the next person does not have to rediscover it. Keep it short and true; change a rule here when the owner changes it.

## Why the tests were trimmed

The repository is public, so GitHub's test minutes were free. The owner wants it private. A private repository on the free GitHub plan includes **2,000 minutes a month**; paying for more is not in the budget. In November the tests used **15,610 minutes** (October 4,062). One full run costs about **33 minutes** (four API shards, web and UI, browser, real Clock staging, build), and we ran about 340 of them. The target is **under 2,000 a month**, about 60 full runs.

The repository stays **public until a whole month shows the minutes hold** (decision 2026-11-25). Then switch it to private.

## What runs when

| Event | What runs | About |
| --- | --- | --- |
| Any push, any pull request | "Build, lint and format" only | 2 minutes |
| Pull request carrying the label `full-ci` | Everything: API tests (4 shards), web and UI, browser, real Clock staging | 33 minutes |
| Started by hand (Actions, CI, Run workflow) | Everything, on the chosen branch | 33 minutes |
| Push to main (a merge) | "Build, lint and format" only; the deploy follows | 2 minutes |
| Docs-only or workflow-only change merged to main | Nothing (already so) | 0 |

- The required check **"Build, lint, and test"** stays red on a pull request until the label `full-ci` is on **and** every full job passed. So nothing merges untested.
- The same code already passed in full on its pull request, which is why main only re-runs the quick check.
- A pull request that changes only docs can still be merged by adding the label; it just runs the full set once.

## Rules

**Tests and merging**
1. Add the label `full-ci` only when the pull request is ready to merge, not on every push. Fix and check locally first (the isolated Docker test box), push, then label.
2. Never merge a pull request whose full tests are not green. Never merge to main without the owner's go while the merge deploys to the live server.
3. Merge in **waves** (a few related pull requests in one branch), not one by one: fewer full runs and fewer live deploys. When a wave's pull requests overlap, resolve the conflicts by hand in the wave branch and say what was kept.
4. Real Clock tests run against the Clock sandbox hotel only. Run them locally too whenever a change touches Clock.
5. The browser-test installer sometimes fails for reasons outside our code (apt "exit code 100"). Re-run that job; do not change code for it.

**Live server**
6. A deploy restarts the API on a small server (1 CPU, 1 GB). For one to two minutes afterwards requests can be slow. **Deploy at quiet hours, and wait about three minutes (until the server load is below 0.6) before running any live check.**
7. Live tests use the **sandbox hotel "Must Hotel"** only, with names ending in TEST, with the named test staff login. Empire Beach Resort and Luxury Premium Finese are read-only: counts and logs, never test bookings, no guest personal data in notes.
8. After every deploy: the post-deploy "Live booking check" must pass, then look at Sentry for new errors. If the check opens an alert issue, find the cause before closing it.
9. Do not run a live test and the post-deploy check at the same moment on this small server; they collide.

**Local work**
10. On localhost always use the one existing hotel and account (dev servers 3000 and 3001, dev database on 5432). Never create new hotels or accounts there. Automated tests create and delete their own throwaway data in the isolated test database only, and nothing else may share that Redis while they run.
11. Changes that matter to guests (money, availability, Clock) get a test against the real thing (Clock sandbox, a real database), not only mocks.

**Backups**
12. The database backup is run by the owner's boss on his server. The old Google Drive backups were removed on 2026-11-25. Take a fresh dump (and a copy off the server) before any large merge or migration.

## Checking the minutes (monthly, and after any big week)

```
gh api orgs/MUST-DEV-TEAM/settings/billing/usage --jq '[.usageItems[] | select(.product=="actions" and .unitType=="Minutes")] | map({month: .date[0:7], repo: .repositoryName, minutes: .quantity})'
```

- Under 1,200 by the 20th of the month: fine.
- Over 1,500: stop adding the label to small pull requests; batch them into one wave.
- Over 2,000 on a private repository: tests stop running until the next month, so switch back to public or ask the owner.

## What the November numbers showed

- Pull-request runs: 243 (every push ran the full set). Main pushes: 96. The deploy workflow: 103 runs (about 700 minutes). Scheduled checks and plugin workflows: about 100 minutes.
- Left alone on purpose: the WordPress plugin workflows (about 60 minutes a month); the plugin code is still in the repository and the owner has not asked to remove it.

## Staging (planned, not built)

Industry standard is a staging copy: a merge deploys there first, production gets one approval. The cheap version is a second Docker stack on the same server, started only when testing. The server has only about 440 MB of free memory and one CPU, so a permanent staging copy needs a bigger server (a few dollars a month more). The owner's boss decides that. Until then the sandbox hotel on the live server plays that role, and rules 6 to 9 apply.
