// scripts/incrementalLoader.js
// Incremental / checkpoint loading
//
// Interview talking points:
// - "Only processes records newer than the last successful run"
// - "Uses source hash to detect already-loaded records — idempotent"
// - "If the pipeline reruns, it won't double-load data"
// - "This is how CDC (Change Data Capture) thinking works in practice"

import fs   from "fs";
import path from "path";
import { query } from "../config/db.js";

const CHECKPOINT_FILE = path.resolve("state/last_run_timestamp.json");

export function readCheckpoint() {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      const raw = fs.readFileSync(CHECKPOINT_FILE, "utf8");
      return JSON.parse(raw);
    }
  } catch {
    console.warn("[Incremental] Could not read checkpoint. Full load will run.");
  }
  return { lastSuccessfulRun: null, lastRunId: null };
}

export function writeCheckpoint(runId, timestamp) {
  const state = {
    lastSuccessfulRun: timestamp,
    lastRunId:         runId,
    updatedAt:         new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(CHECKPOINT_FILE), { recursive: true });
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(state, null, 2));
  console.log(`[Incremental] Checkpoint saved: ${timestamp}`);
}

// Filter out rows that were already loaded (by source hash)
// This makes the pipeline IDEMPOTENT — safe to re-run
export async function filterNewRows(enrichedRows) {
  if (enrichedRows.length === 0) return { newRows: [], skippedCount: 0 };

  const hashes = enrichedRows.map(r => r._sourceHash).filter(Boolean);

  if (hashes.length === 0) return { newRows: enrichedRows, skippedCount: 0 };

  // Check which hashes already exist in staging
  const result = await query(
    `SELECT source_hash FROM stg_customers WHERE source_hash = ANY($1)`,
    [hashes]
  );

  const existingHashes = new Set(result.rows.map(r => r.source_hash));
  const newRows        = enrichedRows.filter(r => !existingHashes.has(r._sourceHash));
  const skippedCount   = enrichedRows.length - newRows.length;

  if (skippedCount > 0) {
    console.log(`[Incremental] Skipped ${skippedCount} already-loaded rows.`);
  }

  return { newRows, skippedCount };
}

// Get existing hashes for DQ duplicate detection
export async function getExistingHashes() {
  try {
    const result = await query(`SELECT source_hash FROM stg_customers`);
    return result.rows.map(r => r.source_hash);
  } catch {
    return [];
  }
}