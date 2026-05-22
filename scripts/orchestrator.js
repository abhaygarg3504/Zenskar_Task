
import fs from "fs";
import { main as parseCsv }       from "./parseCsv.js";
import { main as validate }        from "./validate.js";
import { main as dataQuality }     from "./dataQuality.js";
import { main as transform }       from "./transform.js";
import { main as sendToApi }       from "./apiClient.js";
import { main as generateReport }  from "./report.js";
import { main as loadWarehouse }   from "./warehouseLoader.js";
import { createRun, startRun, completeRun, failRun } from "./pipelineMonitor.js";
import { readCheckpoint, writeCheckpoint, filterNewRows, getExistingHashes } from "./incrementalLoader.js";
import { closePool }               from "../config/db.js";

export async function runPipeline({
  csvFilePath,
  apiUrl,
  apiKey = "",
  mappingConfig = null,
  pipelineVersion = "1.0.0",
  dryRun = false,          // if true, skip warehouse write and API send
}) {
  const run = createRun(csvFilePath, pipelineVersion);
  let dqReport = null;

  console.log("\n══════════════════════════════════════════════════");
  console.log(`  CSV Data Platform Pipeline v${pipelineVersion}`);
  console.log(`  Run ID: ${run.runId}`);
  console.log(`  Source: ${csvFilePath}`);
  console.log("══════════════════════════════════════════════════\n");

  try {
    // ── START monitoring ────────────────────────────────────────────
    if (!dryRun) await startRun(run);

    // ── Read checkpoint ─────────────────────────────────────────────
    const checkpoint = readCheckpoint();
    console.log(`[Orchestrator] Last successful run: ${checkpoint.lastSuccessfulRun || "none (full load)"}`);

    // ── STAGE 1: Parse ───────────────────────────────────────────────
    console.log("\n[Stage 1/7] Parsing CSV...");
    const fileContent = fs.readFileSync(csvFilePath, "utf8");
    const parseResult = await parseCsv(fileContent);
    console.log(`  ✓ Parsed ${parseResult.totalRows} rows, ${parseResult.parseErrors.length} errors`);

    // ── STAGE 2: Validate ─────────────────────────────────────────────
    console.log("\n[Stage 2/7] Validating rows...");
    const validationResult = await validate(parseResult.rows, mappingConfig?.validationRules);
    console.log(`  ✓ Valid: ${validationResult.summary.valid} | Invalid: ${validationResult.summary.invalid}`);

    // ── STAGE 3: Data Quality ─────────────────────────────────────────
    console.log("\n[Stage 3/7] Running data quality checks...");
    const existingHashes = !dryRun ? await getExistingHashes() : [];
    const { report: dqReportData, enrichedRows } = await dataQuality(
      parseResult.rows,
      parseResult.headers,
      existingHashes
    );
    // dqReport = report;
    dqReport = dqReportData;
    console.log(`  ✓ Quality score: ${dqReportData.summary.qualityScore}/100`);
    console.log(`  ✓ Duplicates found: ${dqReportData.summary.duplicatesFound}`);
    if (dqReportData.schemaDrift.missingFields.length > 0) {
      console.warn(`  ⚠ Schema drift: missing fields ${dqReportData.schemaDrift.missingFields.join(", ")}`);
    }

    // ── STAGE 4: Incremental filter ───────────────────────────────────
    console.log("\n[Stage 4/7] Applying incremental filter...");
    const { newRows, skippedCount } = !dryRun
      ? await filterNewRows(enrichedRows)
      : { newRows: enrichedRows, skippedCount: 0 };
    console.log(`  ✓ New rows: ${newRows.length} | Skipped (already loaded): ${skippedCount}`);

    // ── STAGE 5: Transform ────────────────────────────────────────────
    console.log("\n[Stage 5/7] Transforming records...");
    const validNewRows = newRows.filter(r => r._isClean);
    const { customers, transformErrors } = await transform(validNewRows, mappingConfig);
    console.log(`  ✓ Transformed: ${customers.length} customers`);

    // ── STAGE 6: API Send ─────────────────────────────────────────────
    let apiResult = { results: [], summary: { total: 0, success: 0, failed: 0 } };
    if (!dryRun && customers.length > 0) {
      console.log("\n[Stage 6/7] Sending to API...");
      apiResult = await sendToApi(customers, apiUrl, apiKey);
      console.log(`  ✓ API success: ${apiResult.summary.success} | Failed: ${apiResult.summary.failed}`);
    } else {
      console.log("\n[Stage 6/7] API send skipped (dry run or no new records)");
    }

    // ── STAGE 7: Warehouse Load ───────────────────────────────────────
    let warehouseResult = { stagingLoaded: 0, factLoaded: 0 };
    if (!dryRun && newRows.length > 0) {
      console.log("\n[Stage 7/7] Loading warehouse...");
      warehouseResult = await loadWarehouse(
        newRows, customers, apiResult, run.runId, csvFilePath, pipelineVersion
      );
      console.log(`  ✓ Staging: ${warehouseResult.stagingLoaded} | Facts: ${warehouseResult.factLoaded}`);
    }

    // ── Generate report ───────────────────────────────────────────────
    const finalReport = await generateReport(parseResult, validationResult, transformErrors, apiResult);

    // ── Complete monitoring ────────────────────────────────────────────
    if (!dryRun) {
      await completeRun(run, {
        recordsInFile:     parseResult.totalRows + parseResult.parseErrors.length,
        recordsParsed:     parseResult.totalRows,
        recordsValid:      validationResult.summary.valid,
        recordsInvalid:    validationResult.summary.invalid,
        recordsNew:        newRows.length,
        recordsLoaded:     warehouseResult.factLoaded,
        recordsApiSent:    customers.length,
        recordsApiSuccess: apiResult.summary.success,
        recordsApiFailied: apiResult.summary.failed,
        parseErrorCount:   parseResult.parseErrors.length,
      }, dqReport, apiResult.summary.failed === 0 ? "success" : "partial");

      writeCheckpoint(run.runId, run.startedAt.toISOString());
    }

    console.log("\n══════════════════════════════════════════════════");
    console.log(`  Pipeline complete. Run ID: ${run.runId}`);
    console.log("══════════════════════════════════════════════════\n");

    return { runId: run.runId, report: finalReport, dqReport, warehouseResult };

  } catch (err) {
    console.error(`\n[Orchestrator] Pipeline FAILED: ${err.message}`);
    if (!dryRun) await failRun(run, err.message);
    throw err;
  } finally {
    if (!dryRun) await closePool();
  }
}

if (process.argv[1].endsWith("orchestrator.js")) {
  const [,, csvPath, apiUrl, apiKey] = process.argv;
  if (!csvPath || !apiUrl) {
    console.error("Usage: node scripts/orchestrator.js <csv-path> <api-url> [api-key]");
    process.exit(1);
  }

  runPipeline({ csvFilePath: csvPath, apiUrl, apiKey })
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}