# Runbook — Backup Restore Drill

Satisfies **00-platform T-19** and the standing requirement in
[`security.md`](../../.claude/rules/security.md) ("periodic restore test") and
[`non-functional-requirements.md`](../../.claude/rules/non-functional-requirements.md)
("daily backup success ≥ 99%; documented restore procedure with periodic drill").

**An untested backup is not a backup.** The failure modes that matter — a rotated
encryption key, a truncated upload, a dump that will not restore, a missing
extension — are all invisible until someone actually restores. This drill makes
them visible on a schedule instead of during an incident.

---

## Cadence & ownership

| | |
|---|---|
| **Frequency** | Monthly, and before any migration that drops or rewrites a table |
| **Owner** | Whoever holds the on-call/admin rota |
| **Duration** | ~10 minutes |
| **Evidence** | Paste the drill output into the ops log with the date |

---

## What is backed up

The scheduled job (`daily-backup` in [`scripts/worker.ts`](../../scripts/worker.ts),
02:30 Asia/Kolkata — deliberately before the 03:00 night-audit window, so a
restore point exists for the day just closed) writes:

- **Database** — `pg_dump --format=custom` over `DIRECT_URL`
  (a transaction-mode pooler cannot serve a consistent dump — see [ADR-0005](../architecture/adr/0005-managed-postgres-and-direct-url.md))
- **Encryption** — AES-256-GCM client-side, using `PII_ENCRYPTION_KEY`, before
  the bytes leave the process
- **Target** — `s3://$BACKUP_TARGET_BUCKET` in an India region when credentials
  exist; otherwise the encrypted local directory (FR-25)
- **Retention** — `BACKUP_RETENTION_DAYS` (default 30), enforced on every run
- **Record** — one `BackupRun` row per attempt, success *or* failure (FR-24),
  with an administrator alert either way

> **Region guard.** `resolveBackupTarget` throws if a *live* target is configured
> outside `ap-south-*`. DPDP data residency ([`compliance.md`](../../.claude/rules/compliance.md))
> is enforced in code, not left to whoever fills in the bucket name.

---

## Procedure

### 1. Confirm backups are actually running

```bash
npx prisma studio   # inspect BackupRun, or:
```
```sql
SELECT "startedAt", status, target, "sizeBytes", error
FROM "BackupRun" ORDER BY "startedAt" DESC LIMIT 10;
```

**Expect:** a `SUCCESS` row per day, non-null `sizeBytes`, and a size in the same
ballpark as previous days. A run stuck in `RUNNING` means the worker died
mid-backup — investigate before continuing.

### 2. Produce a fresh artifact (optional)

```bash
npm run backup:now
```

### 3. Create a throwaway database

Never drill into the live database. On a managed host, create a scratch database
(or a separate project); locally:

```bash
createdb woodpecker_drill
```

### 4. Run the drill

```bash
RESTORE_DRILL_URL="postgresql://user:pass@host:5432/woodpecker_drill" \
  npm run restore:drill
```

Or against a specific artifact:

```bash
RESTORE_DRILL_URL="…" npm run restore:drill -- .backups/woodpecker-2026-07-21….dump.enc
```

Without `RESTORE_DRILL_URL` the script runs **decrypt-only** — still useful, as
it proves the key opens the artifact, but it does not exercise `pg_restore`.

### 5. Read the result

```
Restore drill
  artifact: .backups/woodpecker-2026-07-21T02-30-00-000Z.dump.enc
  decrypted: 4823914 bytes
  restoring…
  verified: organizations=1 users=6 properties=2 auditLogs=1284

Drill PASSED in 8431ms.
```

### 6. Clean up

```bash
dropdb woodpecker_drill
```

---

## Acceptance criteria

The drill **passes** only if all of these hold:

- [ ] The artifact decrypts with the current `PII_ENCRYPTION_KEY`
- [ ] `pg_restore` completes without fatal errors
- [ ] The restored database reports **≥ 1 organisation** and **≥ 1 user**
- [ ] Row counts are plausible against production
- [ ] Total elapsed time is within the recovery-time expectation

---

## Failure playbook

| Symptom | Cause | Action |
|---|---|---|
| `DECRYPTION FAILED` | `PII_ENCRYPTION_KEY` rotated without re-encrypting existing artifacts | **Every stored backup is unrecoverable.** Restore the previous key from the secret manager, then re-encrypt. Treat as a Sev-1 — you currently have no usable backups. |
| `pg_restore: extension "btree_gist" does not exist` | Target lacks the extensions from migration `20260721120000_platform_init` | `CREATE EXTENSION btree_gist; CREATE EXTENSION pg_trgm;` on the target first |
| Verification finds 0 users | Dump was truncated or taken against the wrong database | Check `BackupRun.sizeBytes` trend; a sudden drop points at the bad run |
| Trigger errors on `AuditLog` | The append-only trigger is restored along with the table | Expected. `pg_restore` loads data before triggers; if it reorders, restore with `--disable-triggers` |
| No artifacts found | The worker is not running, or `BACKUP_MODE=live` with incomplete credentials silently fell back | Check for `backup.live_requested_without_credentials` in the logs |

---

## Related

- [`security.md`](../../.claude/rules/security.md) — backup & recovery policy
- [`deployment-and-infra.md`](../architecture/deployment-and-infra.md) — DR topology, PITR
- [`observability.md`](../architecture/observability.md) — alerting on backup failure
- [`ADR-0005`](../architecture/adr/0005-managed-postgres-and-direct-url.md) — why the dump uses `DIRECT_URL`
