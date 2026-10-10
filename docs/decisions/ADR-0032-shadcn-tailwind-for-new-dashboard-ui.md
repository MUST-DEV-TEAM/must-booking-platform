# ADR-0032: shadcn/ui and Tailwind for the new dashboard UI

Status: Accepted
Date: 2026-10-09

## Context

The owner wants the dashboard UI rebuilt: first a component showcase, then new pages with demo data, and only later connected to real data. The existing `@must/ui` package is a small hand-written set of components styled with plain CSS.

## Decision

New UI is built with shadcn/ui components (Radix primitives via the `radix-ui` package, styled with Tailwind CSS v4), chosen by the owner on 2026-10-09.

- The components live in `apps/web/app/design/_ui/` and are only used under `/design` until the new pages replace the current ones.
- Tailwind is loaded only by `app/design/design.css` and scans only `app/design/`, so the live dashboard's CSS is unchanged. Links out of `/design` use full page loads so its styles never carry into live pages.
- Colors map onto the existing `--must-*` tokens, so the look stays the current green and brass. Light mode only for now; dark mode is deferred.
- `/design` is platform-owner only (`AuthRouteGuard audience="platform"`) and uses fake data.

## Consequences

`@must/ui` and the shadcn components coexist until pages migrate. When a new page goes live, its components move out of `app/design/_ui/` to a shared location and Tailwind scanning widens to match.
