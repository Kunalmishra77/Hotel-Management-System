# /create-spec

Author or upgrade a module spec bundle in `specs/NN-<module>/`.

## Steps
1. Read `CLAUDE.md` + relevant `.claude/rules/*` + the module's row in `rules/scope.md` + its slice of `prisma/schema.prisma`.
2. Produce the 4 files (structure defined in `specs/README.md`):
   - `requirements.md` — EARS functional + referenced NFRs + data owned + dependencies.
   - `user-stories.md` — stories with Given/When/Then acceptance criteria (numbered AC-N).
   - `design.md` — technical design: schema slice, server actions/queries, components, events emitted/consumed, integration adapters, sequence for the hard flows.
   - `tasks.md` — ordered, checkboxed, small tasks; each cites the ACs it satisfies and ends at Definition of Done.
3. Keep everything consistent with steering rules. If a rule is missing/ambiguous, note it and propose the rule change — do not invent conflicting behavior.
4. Self-check against `specs/README.md` quality bar (no TBDs, ACs testable, tasks traceable).

Output only the 4 files. Do not write feature code.
