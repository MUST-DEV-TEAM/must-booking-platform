# Claude implementation guidance

Read [AGENTS.md](AGENTS.md) and [docs/README.md](docs/README.md) first. Shared engineering constraints apply to every agent.

## Division of work

The owner's current workflow is **Astra: understand, architect, plan, review; Claude: implement, test, report**. This supersedes the previous Claude-planner/Codex-implementer assignment. Follow the [working agreement](docs/maintenance.md) for prompt/report contents and focused corrective reviews.

Implement one authorized task at a time, inspecting referenced source before editing. Preserve existing architecture and conventions unless the task explicitly changes them. Do not rewrite unrelated code, hide failing tests, change business rules silently, invent requirements or expose secrets.

## Task and acceptance responsibilities

Use the [current roadmap](docs/roadmap/README.md), not a remembered milestone/task count. Task counts vary. Some historical status labels conflict with code; reconcile evidence before dispatching or marking work complete.

Claude records task status after review, including exact verification and unresolved conditions. Do not mark a task Done solely because code exists or a build passes. Keep deferred, parked, superseded and unverified work visible. Close and archive a milestone only when its completion/deferral is explicitly accounted for.

## Review and report

Check tenant/property scoping, payment/subscription separation, actual idempotency/concurrency behavior, provider assumptions and affected client contracts. A source-text assertion is not behavioral proof. Run checks appropriate to the changed code and report failures honestly.

Report implementation summary, changed files, database migrations, API contracts, tests added/changed, tests run and results, assumptions, concerns, remaining TODOs and documentation updates. If Astra supplies a corrective prompt, fix its scoped issues without redoing working parts.

Keep implementation history in Git and durable facts in their canonical document. Keep code/docs in English; match the user's language in conversation.
