# CSV Customer Import Pipeline

A production-grade Node.js data pipeline that ingests customer records from CSV files, validates and transforms them, sends them to an external API, and loads them into a PostgreSQL data warehouse — with full monitoring, incremental loading, and analytics-ready views.

---

## Table of Contents

- [Overview](#overview)
- [Project Structure](#project-structure)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Database Setup](#database-setup)
- [Running the Pipeline](#running-the-pipeline)
- [Pipeline Stages](#pipeline-stages)
- [Scripts Reference](#scripts-reference)
- [Data Quality Checks](#data-quality-checks)
- [Incremental Loading](#incremental-loading)
- [Pipeline Monitoring](#pipeline-monitoring)
- [Analytics & Reporting](#analytics--reporting)
- [Windmill Flow (Optional)](#windmill-flow-optional)
- [Error Handling & Retry Logic](#error-handling--retry-logic)
- [Environment Variables](#environment-variables)

---

## Overview

This pipeline processes customer CSV files through seven sequential stages:

```
CSV File → Parse → Validate → Data Quality → Incremental Filter → Transform → API Send → Warehouse Load
```

Every run is tracked in the `pipeline_runs` table with full metrics and a data quality report stored as JSONB.

---

## Project Structure

```
project-root/
│
├── scripts/
│   ├── orchestrator.js        # Main pipeline runner — entry point
│   ├── parseCsv.js            # Stage 1: CSV parsing
│   ├── validate.js            # Stage 2: Row-level validation
│   ├── dataQuality.js         # Stage 3: Data quality checks & scoring
│   ├── transform.js           # Stage 5: Field mapping & transformation
│   ├── apiClient.js           # Stage 6: Batched API send with retry
│   ├── report.js              # Final report generation
│   ├── warehouseLoader.js     # Stage 7: PostgreSQL warehouse load
│   ├── pipelineMonitor.js     # Run tracking (create/start/complete/fail)
│   └── incrementalLoader.js   # Checkpoint & duplicate hash filtering
│
├── config/
│   ├── db.js                  # PostgreSQL connection pool
│   └── mapping.json           # Field mapping & transform rules
│
├── warehouse/
│   ├── schema.sql             # All DDL: tables, indexes, partitions, seed data
│   ├── analytics_views.sql    # Power BI-ready views
│   └── analytics_queries.sql  # Ad-hoc SQL examples
│
├── sample-data/
│   └── customers.csv          # Example CSV file
│
├── state/
│   └── last_run_timestamp.json  # Auto-generated incremental checkpoint
│
├── .env                       # Environment variables (not committed)
├── .env.example               # Template for .env
├── package.json
└── README.md
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    orchestrator.js                       │
│                                                         │
│  [1] parseCsv → [2] validate → [3] dataQuality          │
│      → [4] incrementalFilter → [5] transform            │
│          → [6] apiClient → [7] warehouseLoader          │
│                    ↓                                    │
│              pipelineMonitor  (pipeline_runs table)     │
└─────────────────────────────────────────────────────────┘
                         ↓
              PostgreSQL: customer_warehouse
        ┌──────────────────────────────────┐
        │  stg_customers                   │  ← raw staging
        │  dim_customer                    │  ← SCD upsert
        │  dim_country / dim_import_date   │  ← dimensions
        │  fact_customer_imports           │  ← partitioned fact
        │  pipeline_runs                   │  ← monitoring
        └──────────────────────────────────┘
                         ↓
              Analytics Views (Power BI ready)
```

---

## Prerequisites

- **Node.js** v18 or higher
- **PostgreSQL** v14 or higher
- **npm** v8 or higher
- Network access to your target REST API endpoint

---

## Installation

```bash
# 1. Clone the repository
git clone <your-repo-url>
cd csv-customer-pipeline

# 2. Install dependencies
npm install

# 3. Copy environment template
cp .env.example .env

# 4. Fill in your values in .env
```

**Dependencies used:**

| Package | Purpose |
|---|---|
| `pg` | PostgreSQL client (node-postgres) |
| `dotenv` | Environment variable loading |
| Node built-ins (`fs`, `crypto`, `path`) | File I/O, hashing, paths |

---

## Configuration

### `.env` file

```env
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=customer_warehouse
PG_USER=postgres
PG_PASSWORD=your_password
```

### `config/mapping.json`

Controls how CSV columns map to the customer object sent to the API:

```json
{
  "fieldMappings": {
    "name":  { "from": "company_name",  "transform": "trim" },
    "email": { "from": "contact_email", "transform": "lowercase" }
  },
  "nestedMappings": {
    "contact": {
      "firstName": { "from": "contact_first_name", "transform": "trim" },
      "phone":     { "from": "phone_number", "transform": "cleanPhone" }
    },
    "address": {
      "street":  { "from": "address",  "transform": "trim" },
      "country": { "from": "country",  "transform": "uppercase" }
    }
  },
  "validationRules": {
    "required": ["company_name", "contact_email"],
    "email":    ["contact_email"]
  },
  "transforms": {
    "trim":       "value => value?.trim() ?? ''",
    "lowercase":  "value => value?.trim().toLowerCase() ?? ''",
    "uppercase":  "value => value?.trim().toUpperCase() ?? ''",
    "cleanPhone": "value => value?.replace(/[^\\d+\\-()\\s]/g, '').trim() ?? ''"
  }
}
```

---

## Database Setup

Run the schema file against your PostgreSQL database:

```bash
psql -U postgres -d customer_warehouse -f warehouse/schema.sql
```

Then create the analytics views:

```bash
psql -U postgres -d customer_warehouse -f warehouse/analytics_views.sql
```

This creates:

- `stg_customers` — staging table with quality flags
- `dim_customer` — customer dimension with upsert on email
- `dim_country` — pre-seeded country reference table
- `dim_import_date` — date dimension (2023–2027)
- `fact_customer_imports` — partitioned fact table
- `pipeline_runs` — run monitoring and metrics
- Six analytics views (see [Analytics & Reporting](#analytics--reporting))

---

## Running the Pipeline

### Full run

```bash
node scripts/orchestrator.js path/to/customers.csv https://your-api.com/api/v1/customers YOUR_API_KEY
```

### Dry run (skip API send and warehouse write)

```bash
node scripts/orchestrator.js customers.csv https://api.example.com mykey --dry-run
```

Or set `dryRun: true` when calling `runPipeline()` programmatically:

```js
import { runPipeline } from './scripts/orchestrator.js';

await runPipeline({
  csvFilePath: 'sample-data/customers.csv',
  apiUrl:      'https://api.example.com/customers',
  apiKey:      'your-key',
  dryRun:      true,
});
```

### Expected CSV format

The CSV must contain these columns (order does not matter):

```
company_name, contact_email, contact_first_name, contact_last_name,
phone_number, tax_id, company_size, address, city, country, postal_code
```

Example row:

```csv
company_name,contact_email,contact_first_name,contact_last_name,phone_number,tax_id,company_size,address,city,country,postal_code
Acme Corp,john@acme.com,John,Doe,+1-555-0100,US123456,50-200,123 Main St,New York,US,10001
```

---

## Pipeline Stages

### Stage 1 — Parse CSV (`parseCsv.js`)

Reads raw CSV string, handles quoted fields, CRLF line endings, and column count mismatches. Returns `{ rows, headers, totalRows, parseErrors }`.

### Stage 2 — Validate Rows (`validate.js`)

Applies rules from `mapping.json`:
- **required** — fails row if field is empty
- **email** — fails row if email format is invalid
- **nonEmpty** — warns if optional field is blank

Returns `{ validRows, invalidRows, summary }`.

### Stage 3 — Data Quality (`dataQuality.js`)

Runs dataset-wide checks on all parsed rows (not just valid ones):

- SHA-256 hash per row to detect exact duplicates
- Duplicate email detection within the batch
- Cross-batch duplicate check against `stg_customers` hashes
- Schema drift detection (missing or unexpected columns)
- Null rate analysis per field (warns if > 50%)
- Country code validation against ISO list
- Phone and email format validation
- Produces a `qualityScore` (0–100) and enriches each row with `_isClean` and `_qualityIssues`

### Stage 4 — Incremental Filter (`incrementalLoader.js`)

Compares row hashes against `stg_customers` to skip already-loaded records. A `state/last_run_timestamp.json` checkpoint tracks the last successful run ID.

### Stage 5 — Transform (`transform.js`)

Maps CSV columns to the target customer object structure using `mapping.json`. Applies transform functions (`trim`, `lowercase`, `uppercase`, `cleanPhone`). Supports flat and nested output fields.

### Stage 6 — Send to API (`apiClient.js`)

Sends transformed customers to a REST API in batches of 5 (configurable). Features:
- Exponential backoff retry (default 3 attempts)
- Retries only on network errors and HTTP 429/5xx responses
- Returns per-customer success/failure status

### Stage 7 — Warehouse Load (`warehouseLoader.js`)

Loads data into PostgreSQL in three steps:
1. `stg_customers` — full staging insert with `ON CONFLICT DO NOTHING` on hash
2. `dim_customer` — upsert on `contact_email` (SCD Type 1)
3. `fact_customer_imports` — insert with foreign keys to all dimensions

---

## Scripts Reference

| Script | Description |
|---|---|
| `orchestrator.js` | Runs all 7 stages end-to-end |
| `parseCsv.js` | `main(fileContent)` → parsed rows |
| `validate.js` | `main(rows, rules)` → valid/invalid split |
| `dataQuality.js` | `main(rows, headers, existingHashes)` → quality report |
| `transform.js` | `main(validRows, mappingConfig)` → customer objects |
| `apiClient.js` | `main(customers, apiUrl, apiKey, retryAttempts, batchSize)` |
| `report.js` | `main(parseResult, validationResult, transformErrors, apiResult)` |
| `warehouseLoader.js` | `main(enrichedRows, customers, apiResults, runId, sourceFile)` |
| `pipelineMonitor.js` | `createRun`, `startRun`, `completeRun`, `failRun` |
| `incrementalLoader.js` | `readCheckpoint`, `writeCheckpoint`, `filterNewRows`, `getExistingHashes` |

---

## Data Quality Checks

The `dataQuality.js` module produces a quality report with the following sections:

```json
{
  "summary": {
    "totalRows": 100,
    "cleanRows": 87,
    "rowsWithIssues": 13,
    "duplicatesFound": 2,
    "qualityScore": 87
  },
  "schemaDrift": {
    "missingFields": [],
    "unexpectedFields": ["legacy_id"]
  },
  "nullPercentages": {
    "company_name": 0,
    "contact_email": 3.0,
    "phone_number": 42.0
  },
  "datasetIssues": [...],
  "duplicates": [...],
  "rowIssues": [
    { "rowNumber": 5, "issueTypes": ["INVALID_COUNTRY:XX", "NULL_REQUIRED:contact_email"] }
  ]
}
```

This report is also stored as JSONB in the `pipeline_runs.dq_report` column.

**Issue type codes:**

| Code | Meaning |
|---|---|
| `NULL_REQUIRED:field` | Required field is empty |
| `INVALID_EMAIL_FORMAT:value` | Email fails regex |
| `INVALID_PHONE:value` | Phone contains invalid characters |
| `INVALID_COUNTRY:code` | Country code not in ISO allowlist |
| `DUPLICATE_ROW` | Same company+email+taxId seen before |
| `DUPLICATE_EMAIL:email` | Email repeated within the batch |
| `HIGH_NULL_RATE` | Field is >50% null across all rows |
| `SCHEMA_DRIFT` | Missing or unexpected CSV columns |

---

## Incremental Loading

On every run, `incrementalLoader.js`:

1. Loads all existing `source_hash` values from `stg_customers`
2. Computes a SHA-256 hash per incoming row (`company_name|contact_email|tax_id`)
3. Filters out rows whose hash already exists in the database
4. After a successful run, writes `state/last_run_timestamp.json`

To force a full reload, delete `state/last_run_timestamp.json` before running.

---

## Pipeline Monitoring

Every run writes to the `pipeline_runs` table:

| Column | Description |
|---|---|
| `run_id` | UUID for this run |
| `status` | `running`, `success`, `partial`, `failed` |
| `records_in_file` | Total rows in source CSV |
| `records_parsed` | Successfully parsed |
| `records_valid` | Passed validation |
| `records_new` | Not seen in previous runs |
| `records_loaded` | Written to fact table |
| `records_api_success` | Successfully sent to API |
| `success_rate` | `api_success / parsed * 100` |
| `execution_time_ms` | Wall-clock duration |
| `dq_report` | Full JSON quality report |

---

## Analytics & Reporting

Six analytics views are available for Power BI or direct SQL queries:

| View | Description |
|---|---|
| `vw_pipeline_health` | All run metrics with execution time |
| `vw_daily_import_volume` | Daily import counts and success rates |
| `vw_customer_by_country` | Customer distribution by country with validity rate |
| `vw_validity_summary` | Data quality trend over time |
| `vw_company_size_distribution` | Customer breakdown by company size |
| `vw_pipeline_success_trend` | Daily aggregate of pipeline runs |

Example queries are in `warehouse/analytics_queries.sql`.

---

## Windmill Flow (Optional)

A `flow.json` is included to run this pipeline as a Windmill workflow with five steps: parse → validate → transform → API → report. Each step is an independent script with typed inputs via `flow_input` and `results.<step_id>`.

To use it, paste each script's content into the corresponding step in the Windmill editor and provide `fileContent`, `apiUrl`, `apiKey`, and `mappingConfig` as flow inputs.

---

## Error Handling & Retry Logic

- **Parse errors** — logged per row; malformed rows are skipped, rest continue
- **Validation failures** — invalid rows collected and reported; pipeline continues with valid rows
- **Transform errors** — per-row, pipeline continues with remaining rows
- **API failures** — exponential backoff (500ms → 1s → 2s); only retries on network errors, 429, and 5xx responses; 4xx client errors are not retried
- **Warehouse errors** — per-row, other rows continue; errors collected in `warehouseResult.errors`
- **Pipeline crash** — `failRun()` updates `pipeline_runs` with `status = 'failed'` and the error message

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PG_HOST` | `localhost` | PostgreSQL server host |
| `PG_PORT` | `5432` | PostgreSQL port |
| `PG_DATABASE` | `customer_warehouse` | Target database name |
| `PG_USER` | `postgres` | Database user |
| `PG_PASSWORD` | _(empty)_ | Database password |

Create a `.env.example` in your repo root with these keys (values blank) so new contributors know what to fill in.

---

## License

MIT