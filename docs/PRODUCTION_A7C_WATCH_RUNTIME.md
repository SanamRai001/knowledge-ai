# Knowledge AI — Production Hardening A7C Watch Runtime

Date: **2026-09-20**

## Verdict

# ✅ A7C COMPLETE

A7C cuts the normal Watch runtime and production scheduler over to PostgreSQL when:

`KNOWLEDGE_AI_PERSISTENCE_MODE=postgres`

while preserving the historical file-backed Watch runtime for local development and Phase 5 regression coverage.

## Authoritative workflow

`35518107862`

Both workflow jobs passed:

- `quality` — full Phase 0–8 product regression suite, TypeScript, build, unseen benchmark, live Gemini benchmark
- `Production A2 PostgreSQL` — A2 through A7C PostgreSQL runtime proofs

## Runtime behavior verified

- normal Watch HTTP rule creation persists to PostgreSQL
- normal Watch evaluation persists WatchEvaluation, WatchAlert, and rule state to PostgreSQL
- alert acknowledge lifecycle is PostgreSQL-backed
- natural-language WatchDraft preview/save is PostgreSQL-backed
- WatchDraft → WatchRule linkage survives process/pool reconstruction
- account isolation remains authoritative
- production scheduler creates durable PostgreSQL WatchJobs
- due jobs are atomically claimed
- two workers cannot claim the same ready job
- completed jobs retain evaluation linkage
- stale RUNNING jobs are requeued after lease expiry
- schedule fingerprint uniqueness remains database-enforced
- PostgreSQL production Watch execution does not mutate `data/watch.json`

## Compatibility boundary

File mode remains intentionally supported.

The production runtime selector changes behavior only when PostgreSQL persistence mode is explicitly enabled.

## Next

**Production Hardening A7D — Living Knowledge + Actions runtime PostgreSQL cutover**

Priority:

1. route structured knowledge projection into PostgreSQL
2. route effective company-state reads through PostgreSQL
3. route Action proposals/audit through PostgreSQL
4. use the existing A3 confirmed-action transaction for production confirmation
5. preserve Action idempotency and stale-state protection
6. keep file mode and historical Phase 3/4 gates green
