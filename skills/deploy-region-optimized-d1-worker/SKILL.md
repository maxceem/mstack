---
name: deploy-region-optimized-d1-worker
description: Deploy a Cloudflare D1 database and Worker with benchmark-guided placement for a requested region. Use when the user explicitly asks to create or deploy a D1-backed Worker in WEUR, EEUR, APAC, OC, WNAM, or ENAM; retry D1 creation against p50 and p90 placement tables; configure and verify the Worker near the accepted D1 colo; or inspect the baked D1-to-Worker measurements.
---

# Deploy Region-Optimized D1 Worker

Provision a D1 primary in an acceptable physical colo, then place and deploy the Worker using the selected p50 or p90 provider region for that colo.

## Required reference

Read [references/placement-data.json](references/placement-data.json) before planning or executing a deployment. Treat it as the source of truth for region names, p50 and p50→p90 performance tables, measurements, and Worker placement regions.

Use [scripts/placement-plan.mjs](scripts/placement-plan.mjs) instead of manually transcribing the table:

```bash
node <skill-dir>/scripts/placement-plan.mjs --region apac --base-name app-db --pretty
node <skill-dir>/scripts/placement-plan.mjs --region apac --colo ICN --attempt 1 --base-name app-db --pretty
node <skill-dir>/scripts/placement-plan.mjs --region apac --colo HKG --attempt 11 --base-name app-db --pretty
```

Replace `<skill-dir>` with this skill directory. In Claude Code, `${CLAUDE_SKILL_DIR}` resolves it.

## Safety boundary

Act only when the user explicitly requested deployment. Cloud deployment creates billable remote resources and deletion destroys data.

- Never delete a D1 database that this run did not create.
- Before the first attempt, list D1 databases and stop for user direction if the intended name already exists.
- Track every database UUID created during this run. Before deleting a rejected attempt, verify that its exact name still maps to the tracked UUID, then delete that exact name.
- Do not print, persist, or commit tokens or secret values.
- Do not apply migrations or production data until a D1 attempt is accepted.
- Preserve unrelated Wrangler settings and bindings.

## Deployment workflow

### 1. Normalize the request

Require a D1 location hint: `weur`, `eeur`, `apac`, `oc`, `wnam`, or `enam`. Use the official hint spelling; Eastern North America is `enam`.

Construct the database name as `<base-name>-<region>`, for example `orders-enam` or `orders-apac`. Keep the Worker name independent unless the user requests matching names.

Determine:

- Worker project directory and Wrangler config
- deployment environment, if any
- D1 binding name
- migration or schema command
- database base name
- requested D1 region

If one of these cannot be discovered safely, ask only for the missing value.

### 2. Preflight

1. Read the project instructions and Wrangler config.
2. Check current Wrangler v4 syntax with `wrangler --version` and relevant `--help` output. Prefer the project-local Wrangler; install the current version only when unavailable.
3. Run `wrangler whoami` and confirm the intended Cloudflare account.
4. Run `wrangler d1 list --json` and ensure the target database name does not exist.
5. Run the project's tests and `wrangler deploy --dry-run` before creating remote resources when feasible.
6. Generate the regional plan with the bundled script and record both performance tables.

Do not combine `--jurisdiction` with this workflow. A jurisdiction overrides the D1 location hint.

### 3. Create and observe D1, up to 20 attempts

Use two phases:

- Attempts 1–10: accept only colos in the p50→p90 table and use that row's p90 Worker placement.
- Attempts 11–20: accept any colo in the p50 table and use that row's p50 Worker placement.

If attempts 1–10 produce no p50→p90 colo, report the phase transition and continue automatically with the p50 phase.

For attempts 1 through 20:

1. Create the database with the requested hint and without automatically editing project config:

   ```bash
   wrangler d1 create <database-name> --location=<region> --update-config=false
   ```

2. Capture the returned database UUID and add it to the run's tracked-resource list.
3. Observe the primary location using remote write statements, because a read can be served by a D1 read replica:

   ```bash
   wrangler d1 execute <database-name> --remote --command \
     "CREATE TABLE IF NOT EXISTS __d1_placement_probe (id INTEGER PRIMARY KEY); INSERT OR REPLACE INTO __d1_placement_probe (id) VALUES (1);" \
     --json
   ```

4. Parse the result metadata. Prefer entries where `meta.served_by_primary` is `true`; for write statements, accept metadata without that field only when `served_by_colo` and `served_by_region` are present.
5. Repeat the write observation up to three times for transient missing metadata. Normalize the colo and region to uppercase. Require one consistent primary colo and require `served_by_region` to equal the requested region.
6. Run the planner for the observed colo with `--attempt <number>`. Accept only when `acceptable` is `true`, and retain its `phase`, `workerPlacement`, and `expectedWorkerColo`.
7. If rejected:
   - report the attempt number, phase, observed colo, baked best p50 and p90, and that phase's accepted colos;
   - delete exactly the database created in this attempt with `wrangler d1 delete <database-name> --skip-confirmation`;
   - verify it no longer appears in `wrangler d1 list --json`;
   - wait for deletion propagation if the same name cannot yet be recreated.
8. If accepted, keep the database and end both retry phases.

Treat the consistent write metadata as the required D1 colo verification. Do not configure or deploy the Worker until both the requested D1 region and an accepted primary colo are verified.

If all 20 attempts are rejected, leave no rejected database from this run, report both phases and all observed colos, and ask whether the user wants another 10-attempt p50→p90 phase followed by a 10-attempt p50 phase.

### 4. Configure the accepted database

For the accepted D1:

1. Drop the probe table:

   ```bash
   wrangler d1 execute <database-name> --remote --command \
     "DROP TABLE IF EXISTS __d1_placement_probe;" --json
   ```

2. Update the selected Wrangler environment's D1 binding with the accepted database name and UUID.
3. Apply the project's migrations or schema initialization to the accepted database.
4. Run `wrangler types` when the project uses generated Worker binding types.

Never point the Worker at a rejected database UUID.

### 5. Place and deploy the Worker

Use the accepted attempt's exact `workerPlacement` from the planner:

```jsonc
{
  "placement": {
    "region": "aws:eu-west-2"
  }
}
```

Set `placement.region`; do not also set `placement.mode`, `placement.host`, or `placement.hostname`.

Run the project's validation, then:

```bash
wrangler deploy --dry-run
wrangler deploy
```

Pass the discovered config and environment flags consistently to every Wrangler command.

### 6. Verify Worker placement and report

After deployment:

1. Run the application's smoke test or request a deployed route known to execute the Worker.
2. Send three uncached requests after deployment propagation and parse each `CF-Placement` response header as `^(local|remote)-([A-Z0-9]{3})$`. Require all three placement colos to be present, identical, and equal to the accepted attempt's `expectedWorkerColo`.
3. Do not use `request.cf.colo` or the `CF-Ray` suffix as Worker placement evidence; they can describe the request/ingress colo instead.
4. If `CF-Placement` is missing, inconsistent, or reports another colo, recheck the deployed Wrangler config and exact `placement.region`, then stop and report the verification failure. Do not claim a successful placement.
5. Confirm the Wrangler config contains the accepted database UUID and exact `placement.region`.
6. Report:
   - D1 name, UUID, region hint, and observed primary colo
   - attempt count, accepted phase, and rejected colos
   - baked best p50 and p90 values for the accepted D1 colo
   - selected metric, Worker placement region, and expected and observed Worker placement colos
   - migration, validation, deploy, and smoke-test results

If any later safe D1 primary-location verification no longer reports the accepted colo, stop and report the inconsistency. Do not introduce an application-data write solely for this check or delete a database that now contains migrated or production data.

## Acceptance policy

Both tables use the same per-region rule with full-precision values:

- If any measured colo is below 10 ms for the table's metric, accept every colo below 10 ms.
- Otherwise accept every colo at most the metric's best value plus 1 ms.

The p50 table is calculated across every measured colo:

- WEUR: `CDG`, `LHR`, `AMS`, `MAD`
- EEUR: `WAW`, `MXP`, `FRA`, `ARN`
- APAC: `ICN`, `KIX`, `NRT`, `HKG`
- OC: `SYD`, `MEL`, `AKL`
- WNAM: `LAX`
- ENAM: `IAD`, `ORD`

The p50→p90 table first keeps only p50-table colos, then applies the same rule to their p90 values:

- WEUR: `CDG`
- EEUR: `WAW`, `MXP`, `FRA`, `ARN`
- APAC: `ICN`, `KIX`
- OC: `MEL`, `SYD`
- WNAM: `LAX`
- ENAM: `IAD`

D1 location hints are probabilistic, while the accepted Worker placement is deterministic configuration derived from the observed D1 colo.
