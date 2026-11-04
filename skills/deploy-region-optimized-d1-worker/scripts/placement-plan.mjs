#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.resolve(scriptDir, "../references/placement-data.json");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const data = JSON.parse(await readFile(dataPath, "utf8"));

  if (args.selfTest) {
    selfTest(data);
    console.log("placement data: ok");
    return;
  }

  if (args.help) {
    printHelp();
    return;
  }

  if (!args.region) throw new Error("--region is required");
  const regionKey = args.region.toLowerCase();
  const region = data.regions[regionKey];
  if (!region) {
    throw new Error(`Unsupported region ${args.region}. Use one of: ${Object.keys(data.regions).join(", ")}`);
  }

  const p50Rows = region.rows
    .filter((row) => row.p50Acceptable)
    .sort((left, right) => left.p50Ms - right.p50Ms);
  const p50P90Rows = region.rows
    .filter((row) => row.p50P90Acceptable)
    .sort((left, right) => left.p90Ms - right.p90Ms);
  const result = {
    region: regionKey,
    regionLabel: region.label,
    databaseName: args.baseName ? databaseName(args.baseName, regionKey) : undefined,
    databaseSuffix: region.databaseSuffix,
    metrics: data.source.metrics,
    unit: data.source.unit,
    acceptance: data.source.acceptance,
    performanceTables: {
      p50: p50Rows.map((row) => ({
        d1Colo: row.d1Colo,
        p50Ms: row.p50Ms,
        workerPlacement: row.p50WorkerPlacement,
        expectedWorkerColo: row.p50ExpectedWorkerColo
      })),
      p50P90: p50P90Rows.map((row) => ({
        d1Colo: row.d1Colo,
        p50GateMs: row.p50Ms,
        p90Ms: row.p90Ms,
        workerPlacement: row.p90WorkerPlacement,
        expectedWorkerColo: row.p90ExpectedWorkerColo
      }))
    }
  };

  if (args.attempt) {
    const strict = phaseForAttempt(args.attempt) === "p50-p90";
    result.attempt = args.attempt;
    result.phase = strict ? "p50-p90" : "p50";
    result.selectedMetric = strict ? "p90" : "p50";
    result.acceptedColos = (strict ? p50P90Rows : p50Rows).map((row) => row.d1Colo);
  }

  if (args.colo) {
    if (!args.attempt) throw new Error("--attempt is required with --colo");
    const colo = args.colo.toUpperCase();
    const row = region.rows.find((candidate) => candidate.d1Colo === colo);
    const strict = result.phase === "p50-p90";
    const acceptable = strict ? row?.p50P90Acceptable ?? false : row?.p50Acceptable ?? false;
    Object.assign(result, {
      observedColo: colo,
      measured: Boolean(row),
      acceptable,
      p50Ms: row?.p50Ms,
      p90Ms: row?.p90Ms,
      p50Acceptable: row?.p50Acceptable ?? false,
      p50P90Acceptable: row?.p50P90Acceptable ?? false,
      workerPlacement: acceptable
        ? strict ? row?.p90WorkerPlacement : row?.p50WorkerPlacement
        : undefined,
      expectedWorkerColo: acceptable
        ? strict ? row?.p90ExpectedWorkerColo : row?.p50ExpectedWorkerColo
        : undefined
    });
  }

  const json = JSON.stringify(result, null, args.pretty ? 2 : 0);
  process.stdout.write(`${json}\n`);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--region") args.region = nextValue(argv, ++index, arg);
    else if (arg === "--colo") args.colo = nextValue(argv, ++index, arg);
    else if (arg === "--base-name") args.baseName = nextValue(argv, ++index, arg);
    else if (arg === "--attempt") {
      args.attempt = Number(nextValue(argv, ++index, arg));
      if (!Number.isInteger(args.attempt) || args.attempt < 1 || args.attempt > 20) {
        throw new Error("--attempt must be an integer from 1 through 20");
      }
    }
    else if (arg === "--pretty") args.pretty = true;
    else if (arg === "--self-test") args.selfTest = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function nextValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function databaseName(baseName, region) {
  const normalized = baseName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) throw new Error("--base-name must contain letters or digits");
  if (normalized.endsWith(`-${region}`)) return normalized;
  return `${normalized}-${region}`;
}

function phaseForAttempt(attempt) {
  return attempt <= 10 ? "p50-p90" : "p50";
}

function selfTest(data) {
  const regionEntries = Object.entries(data.regions);
  if (JSON.stringify(data.source.metrics) !== JSON.stringify(["p50", "p90"])) {
    throw new Error("Expected p50 and p90 metrics");
  }
  if (regionEntries.length !== 6) throw new Error(`Expected 6 regions, found ${regionEntries.length}`);
  if (databaseName("orders", "apac") !== "orders-apac") throw new Error("database suffix was not added");
  if (databaseName("orders-apac", "apac") !== "orders-apac") throw new Error("database suffix was duplicated");
  if (phaseForAttempt(1) !== "p50-p90" || phaseForAttempt(10) !== "p50-p90") {
    throw new Error("Attempts 1-10 must use the p50-p90 phase");
  }
  if (phaseForAttempt(11) !== "p50" || phaseForAttempt(20) !== "p50") {
    throw new Error("Attempts 11-20 must use the p50 phase");
  }

  for (const [regionKey, region] of regionEntries) {
    if (region.databaseSuffix !== `-${regionKey}`) {
      throw new Error(`${regionKey}: databaseSuffix must be -${regionKey}`);
    }
    if (!region.rows.length) throw new Error(`${regionKey}: measurements are empty`);

    const seen = new Set();
    for (const row of region.rows) {
      if (seen.has(row.d1Colo)) throw new Error(`${regionKey}: duplicate colo ${row.d1Colo}`);
      seen.add(row.d1Colo);
      if (!Number.isFinite(row.p50Ms) || !Number.isFinite(row.p90Ms)) {
        throw new Error(`${regionKey}/${row.d1Colo}: missing p50 or p90`);
      }
      for (const field of ["p50WorkerPlacement", "p90WorkerPlacement"]) {
        if (!/^(aws|azure|gcp):[a-z0-9-]+$/.test(row[field])) {
          throw new Error(`${regionKey}/${row.d1Colo}: invalid ${field}`);
        }
      }
      for (const field of ["p50ExpectedWorkerColo", "p90ExpectedWorkerColo"]) {
        if (!/^[A-Z0-9]{3}$/.test(row[field])) {
          throw new Error(`${regionKey}/${row.d1Colo}: invalid ${field}`);
        }
      }
    }

    const p50Accepted = selectAcceptableRows(region.rows, "p50Ms", data.source.acceptance);
    const p50P90Accepted = selectAcceptableRows(p50Accepted, "p90Ms", data.source.acceptance);
    for (const row of region.rows) {
      const expectedP50 = p50Accepted.includes(row);
      const expectedP50P90 = p50P90Accepted.includes(row);
      if (row.p50Acceptable !== expectedP50) {
        throw new Error(`${regionKey}/${row.d1Colo}: invalid p50Acceptable`);
      }
      if (row.p50P90Acceptable !== expectedP50P90) {
        throw new Error(`${regionKey}/${row.d1Colo}: invalid p50P90Acceptable`);
      }
    }
  }
}

function selectAcceptableRows(rows, metric, acceptance) {
  const preferred = rows.filter((row) => row[metric] < acceptance.preferredThresholdMs);
  if (preferred.length) return preferred;
  const best = Math.min(...rows.map((row) => row[metric]));
  return rows.filter((row) => row[metric] <= best + acceptance.fallbackDeltaFromBestMs);
}

function printHelp() {
  console.log(`Usage:
  placement-plan.mjs --region <region> [--base-name <name>] [--pretty]
  placement-plan.mjs --region <region> --colo <colo> --attempt <1-20> [--base-name <name>] [--pretty]
  placement-plan.mjs --self-test

Attempts 1-10 use the p50-p90 table. Attempts 11-20 use the p50 table.
Regions: weur, eeur, apac, oc, wnam, enam`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
