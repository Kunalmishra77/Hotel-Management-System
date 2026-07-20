# Definition of Done

A `tasks.md` item is **done** only when every box below is true. "It compiles" / "it renders" is not done.

## Functional
- [ ] Meets its spec's acceptance criteria (`user-stories.md`), verified by tests mapped to those criteria.
- [ ] Business invariants upheld (`business-rules.md`) — money, availability, GST, status transitions.
- [ ] Edge/error cases handled (empty, concurrent, invalid, unauthorized, offline where relevant).

## Quality
- [ ] `npm run typecheck`, `npm run lint`, `npm run test` all pass; relevant e2e green.
- [ ] Domain logic unit-tested (≥90% domain coverage); action integration-tested.
- [ ] No file over ~300 lines doing multiple jobs; module public surface respected.

## Security & compliance
- [ ] Authn + server-side authz (property-scoped) enforced; deny-by-default.
- [ ] Inputs zod-validated; outputs PII-safe; no secret/PII in logs.
- [ ] Mutation emits domain event + writes audit record.
- [ ] PII handled per `compliance.md` (masking/encryption/region).

## NFR
- [ ] Meets relevant budgets in `non-functional-requirements.md` (latency/search/invoice).
- [ ] Mobile-first + accessible (AA); works on phone viewport; offline path if applicable.

## Data
- [ ] Prisma migration written + reversible; seed updated if needed; indexes for hot paths.
- [ ] Money in paise; time zone-correct.

## Docs & traceability
- [ ] Spec updated if reality diverged; ADR added for any notable decision.
- [ ] Non-obvious "why" documented in code.

## Review
- [ ] Self-review done; PR description links the spec + lists what was verified and how.
