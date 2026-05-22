import { query } from "../config/db.js";
import crypto from "crypto";

export function createRun(sourceFile, pipelineVersion = "1.0.0") {
  return {
    runId:           crypto.randomUUID(),
    pipelineVersion,
    sourceFile,
    startedAt:       new Date(),
    metrics:         {},
  };
}

export async function startRun(run) {
  await query(`
    INSERT INTO pipeline_runs (
      run_id, pipeline_version, source_file, started_at, status
    ) VALUES ($1, $2, $3, $4, 'running')
    ON CONFLICT (run_id) DO NOTHING
  `, [run.runId, run.pipelineVersion, run.sourceFile, run.startedAt]);

  console.log(`[Monitor] Pipeline run started: ${run.runId}`);
  return run;
}

export async function completeRun(run, metrics, dqReport, status = "success") {
  const completedAt      = new Date();
  const executionTimeMs  = completedAt - run.startedAt;

  const {
    recordsInFile    = 0,
    recordsParsed    = 0,
    recordsValid     = 0,
    recordsInvalid   = 0,
    recordsNew       = 0,
    recordsLoaded    = 0,
    recordsApiSent   = 0,
    recordsApiSuccess = 0,
    recordsApiFailied = 0,
    parseErrorCount  = 0,
  } = metrics;

  const successRate = recordsParsed > 0
    ? Math.round((recordsApiSuccess / recordsParsed) * 10000) / 100
    : 0;

  await query(`
    UPDATE pipeline_runs SET
      completed_at        = $1,
      execution_time_ms   = $2,
      records_in_file     = $3,
      records_parsed      = $4,
      records_valid       = $5,
      records_invalid     = $6,
      records_new         = $7,
      records_loaded      = $8,
      records_api_sent    = $9,
      records_api_success = $10,
      records_api_failed  = $11,
      success_rate        = $12,
      parse_error_count   = $13,
      status              = $14,
      dq_report           = $15
    WHERE run_id = $16
  `, [
    completedAt,
    executionTimeMs,
    recordsInFile,
    recordsParsed,
    recordsValid,
    recordsInvalid,
    recordsNew,
    recordsLoaded,
    recordsApiSent,
    recordsApiSuccess,
    recordsApiFailied,
    successRate,
    parseErrorCount,
    status,
    JSON.stringify(dqReport || {}),
    run.runId,
  ]);

  console.log(`[Monitor] Run ${run.runId} completed in ${executionTimeMs}ms — status: ${status}`);
  return { runId: run.runId, executionTimeMs, successRate, status };
}

export async function failRun(run, errorMessage) {
  const completedAt = new Date();
  await query(`
    UPDATE pipeline_runs SET
      completed_at = $1,
      execution_time_ms = $2,
      status = 'failed',
      error_message = $3
    WHERE run_id = $4
  `, [completedAt, completedAt - run.startedAt, errorMessage, run.runId]);

  console.error(`[Monitor] Run ${run.runId} FAILED: ${errorMessage}`);
}