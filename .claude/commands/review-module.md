# /review-module

Review a module against its spec and the steering rules before it's considered done.

## Checklist
- **Traceability:** every acceptance criterion in `user-stories.md` maps to a passing test. List any AC without a test.
- **Invariants:** money in paise + Decimal math; availability/no-overbooking; GST correctness; status transitions; append-only folio/audit.
- **Security:** server-side authz on every mutation, property-scoped; PII masking/encryption; inputs zod-validated; event + audit emitted.
- **NFRs:** relevant budgets met (search/invoice/latency); mobile-first + AA; offline path if applicable.
- **Architecture:** layer rules respected; no cross-module internal imports; files not overgrown; no unapproved deps.
- **Data:** migration reversible; indexes for hot paths; seed updated.
- **Definition of Done:** every box in `rules/definition-of-done.md` satisfied.

Report findings most-severe first with file:line. Distinguish blocking (correctness/security/invariant) from non-blocking (style/cleanup).
