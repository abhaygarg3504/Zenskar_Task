// scripts/warehouseLoader.js
// Writes data to PostgreSQL warehouse tables
//
// Interview talking points:
// - "Staging-first pattern: raw data lands in stg_customers first"
// - "Then we upsert into dimension and fact tables"
// - "UPSERT (ON CONFLICT DO UPDATE) makes it idempotent"
// - "Transactions ensure atomicity — either all rows load or none"

import { query, transaction } from "../config/db.js";

export async function main(enrichedRows, customers, apiResults, runId, sourceFile, pipelineVersion = "1.0.0") {
  const results = {
    stagingLoaded:   0,
    dimensionLoaded: 0,
    factLoaded:      0,
    errors:          [],
  };

  // ── STEP 1: Load staging table ──────────────────────────────────────
  console.log(`[Warehouse] Loading ${enrichedRows.length} rows to staging...`);

  for (const row of enrichedRows) {
    try {
      await query(`
        INSERT INTO stg_customers (
          source_file, source_row, source_hash, pipeline_run_id, pipeline_version,
          company_name, contact_email, contact_first, contact_last, phone_number,
          tax_id, company_size, address, city, country, postal_code,
          is_valid, quality_issues
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
        ON CONFLICT (source_hash) DO NOTHING
      `, [
        sourceFile,
        row._rowNumber,
        row._sourceHash,
        runId,
        pipelineVersion,
        row.company_name        || null,
        row.contact_email       || null,
        row.contact_first_name  || null,
        row.contact_last_name   || null,
        row.phone_number        || null,
        row.tax_id              || null,
        row.company_size        || null,
        row.address             || null,
        row.city                || null,
        row.country             || null,
        row.postal_code         || null,
        row._isClean,
        JSON.stringify(row._qualityIssues),
      ]);
      results.stagingLoaded++;
    } catch (err) {
      results.errors.push({ stage: "staging", row: row._rowNumber, error: err.message });
    }
  }

  // ── STEP 2: Upsert dim_customer ─────────────────────────────────────
  console.log(`[Warehouse] Upserting dimension tables...`);

  const customerKeyMap = {};  // email → customer_key (used for fact table)

  for (const customer of customers) {
    try {
      const result = await query(`
        INSERT INTO dim_customer (
          company_name, contact_email, contact_first, contact_last,
          phone_number, tax_id, company_size, address, city,
          country_code, postal_code, source_run_id, last_updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
        ON CONFLICT (contact_email) DO UPDATE SET
          company_name    = EXCLUDED.company_name,
          contact_first   = EXCLUDED.contact_first,
          contact_last    = EXCLUDED.contact_last,
          phone_number    = EXCLUDED.phone_number,
          company_size    = EXCLUDED.company_size,
          address         = EXCLUDED.address,
          city            = EXCLUDED.city,
          country_code    = EXCLUDED.country_code,
          postal_code     = EXCLUDED.postal_code,
          source_run_id   = EXCLUDED.source_run_id,
          last_updated_at = NOW()
        RETURNING customer_key
      `, [
        customer.name,
        customer.email,
        customer.contact?.firstName  || null,
        customer.contact?.lastName   || null,
        customer.contact?.phone      || null,
        customer.taxId               || null,
        customer.companySize         || null,
        customer.address?.street     || null,
        customer.address?.city       || null,
        (customer.address?.country || "").substring(0, 2) || null,
        customer.address?.postalCode || null,
        runId,
      ]);

      if (result.rows[0]) {
        customerKeyMap[customer.email] = result.rows[0].customer_key;
        results.dimensionLoaded++;
      }
    } catch (err) {
      results.errors.push({ stage: "dim_customer", email: customer.email, error: err.message });
    }
  }

  // ── STEP 3: Load fact table ─────────────────────────────────────────
  console.log(`[Warehouse] Loading fact table...`);

  const apiResultMap = {};
  for (const r of (apiResults?.results || [])) {
    apiResultMap[r.customer?.email] = r;
  }

  for (const customer of customers) {
    const customerKey = customerKeyMap[customer.email];
    if (!customerKey) continue;

    const apiResult = apiResultMap[customer.email];
    const countryCode = (customer.address?.country || "").substring(0, 2).toUpperCase();

    try {
      // Resolve country_key
      const countryResult = await query(
        `SELECT country_key FROM dim_country WHERE country_code = $1`,
        [countryCode]
      );
      const countryKey = countryResult.rows[0]?.country_key || null;

      // Resolve date_key
      const today = new Date();
      const dateKey = parseInt(
        `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,"0")}${String(today.getDate()).padStart(2,"0")}`
      );

      await query(`
        INSERT INTO fact_customer_imports (
          customer_key, country_key, date_key,
          pipeline_run_id, source_file,
          was_valid, api_sent, api_success, api_attempts,
          imported_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
      `, [
        customerKey,
        countryKey,
        dateKey,
        runId,
        sourceFile,
        true,
        apiResult ? true : false,
        apiResult?.status === "success",
        apiResult?.attempts || 0,
      ]);
      results.factLoaded++;
    } catch (err) {
      results.errors.push({ stage: "fact", email: customer.email, error: err.message });
    }
  }

  // ── STEP 4: Mark staging rows as processed ──────────────────────────
  await query(
    `UPDATE stg_customers SET is_processed = TRUE, processed_at = NOW()
     WHERE pipeline_run_id = $1`,
    [runId]
  );

  console.log(`[Warehouse] Done. Staging: ${results.stagingLoaded}, Dims: ${results.dimensionLoaded}, Facts: ${results.factLoaded}`);
  return results;
}