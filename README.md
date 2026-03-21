# Windmill CSV Customer Import Pipeline

A modular pipeline that reads customer data from a CSV file, validates and transforms each row using config-driven rules, then creates customers via a REST API — with retry handling, batch processing, and a structured final report.

---

## How it works

```
CSV File
   │
   ▼
parseCsv      →  reads rows, handles quoted fields and encoding
   │
   ▼
validate      →  checks required fields and email format (rules from config)
   │ valid rows only
   ▼
transform     →  maps CSV columns to customer object shape (driven by mapping.json)
   │
   ▼
apiClient     →  POSTs to API in batches of 5, retries failed requests up to 3×
   │
   ▼
report        →  aggregates everything into a structured JSON report
```

Each module has one job. They talk to each other via plain JSON. Swapping, testing, or rewriting one module doesn't touch the others.

---

## Project Structure

```
windmill-csv-pipeline/
│
├── scripts/
│   ├── parseCsv.js       ← CSV parsing only (no validation, no transformation)
│   ├── validate.js       ← validation only (rules pulled from config)
│   ├── transform.js      ← transformation engine (mapping pulled from config)
│   ├── apiClient.js      ← API calls with retry + batching
│   └── report.js         ← aggregates results into a report
│
├── config/
│   └── mapping.json      ← the main config: field mappings, transforms, validation rules
│
├── flows/
│   └── csv_pipeline.json ← Windmill flow export
│
├── mock-api/
│   ├── server.js         ← local Express mock API (for testing without MockAPI.io)
│   └── package.json
│
├── sample-data/
│   └── customers.csv     ← 12 test records, includes intentional errors
│
├── docs/
│   ├── setup-guide.md
│   ├── developer-guide.md
│   └── user-guide.md
│
└── run-pipeline.js       ← standalone runner, no Windmill needed
```

---

## Quick Start

### Option A — Run locally (no Windmill needed)

**Requirements:** Node.js 18+, two terminal windows.

**Terminal 1 — start the mock API:**
```bash
cd mock-api
npm install
npm start
```

You should see:
```
Mock API running at http://localhost:3001
  POST http://localhost:3001/api/v1/customers
  API Key (Bearer): test-api-key-12345
```

**Terminal 2 — run the pipeline:**
```bash
node run-pipeline.js sample-data/customers.csv http://localhost:3001/api/v1/customers test-api-key-12345
```

**Check results:**
```bash
cat report.json

# or view created customers directly
curl http://localhost:3001/api/v1/customers
```

---

### Option B — Run on Windmill
 

**1. Set up a cloud mock endpoint (MockAPI.io):**
1. Go to https://mockapi.io and create a free account
2. Create a project named `csv-pipeline`
3. Add a resource called `customers` with fields: `name`, `email`, `taxId`, `companySize`, `contact` (Object), `address` (Object), `metadata` (Object)
4. Copy your endpoint — it looks like: `https://XXXXXXXX.mockapi.io/api/v1/customers`

**2. Create the Windmill flow:**
1. Go to **Flows → New Flow**
2. Add 5 steps as inline JavaScript scripts in this order:

| Step | Script file | Key input |
|------|-------------|-----------|
| a | parseCsv.js | `fileContent` ← `flow_input.fileContent` |
| b | validate.js | `rows` ← `results.a.rows` |
| c | transform.js | `validRows` ← `results.b.validRows` |
| d | apiClient.js | `customers` ← `results.c.customers` |
| e | report.js | `parseResult` ← `results.a`, etc. |

Refer to `flows/csv_pipeline.json` for the full binding config.

**3. Run the flow with these inputs:**
- `fileContent` — paste the contents of `sample-data/customers.csv`
- `apiUrl` — your MockAPI endpoint URL
- `apiKey` — leave blank (MockAPI doesn't require one by default)
- `mappingConfig` — paste the full contents of `config/mapping.json`

---

### Option C — MockAPI.io endpoint with local runner

```bash
node run-pipeline.js sample-data/customers.csv https://YOUR_ID.mockapi.io/api/v1/customers
```

---

## Expected Output

```
🚀 CSV Pipeline Starting...

📄 Step 1: Parsing CSV...
   Parsed 12 rows. Parse errors: 0

✅ Step 2: Validating rows...
   Valid: 9 | Invalid: 3
   ⚠ Row 8 (?): Missing required: "company_name"
   ⚠ Row 9 (Theta Corp): Bad email in "contact_email": not-an-email

🔄 Step 3: Transforming data...
   Transformed 9 customers.

📡 Step 4: Sending to API...
   ✓ Acme Corp → id=1
   ✓ Beta Inc → id=2
   ...

📊 Final Report:
────────────────────────────────────────
  Rows in file:        12
  Successfully parsed: 12
  Passed validation:   9
  Failed validation:   3
  API success:         9
  API failed:          0
────────────────────────────────────────
  Overall success rate: 75.0%
```

---

## CSV Format

Your file must include a header row. Required columns are marked below:

| Column | Required | Example |
|--------|----------|---------|
| `company_name` | ✅ | Acme Corp |
| `contact_email` | ✅ | john@acme.com |
| `contact_first_name` | ✅ | John |
| `contact_last_name` | ✅ | Doe |
| `phone_number` | no | +1-555-0100 |
| `address` | no | 123 Business St |
| `city` | no | New York |
| `country` | no | USA |
| `postal_code` | no | 10001 |
| `tax_id` | no | TAX-123456 |
| `company_size` | no | 50-100 |

A few things to keep in mind:
- Column names are case-sensitive
- Save the file as UTF-8
- Fields containing commas must be wrapped in quotes: `"Smith, John"`
- Email addresses are auto-lowercased
- Country codes are auto-uppercased
- Phone numbers are auto-cleaned (non-numeric characters stripped, except `+ - ( ) spaces`)

---

## Configuration — config/mapping.json

This is the only file you need to touch for most changes. No script edits required.

### Flat field mappings

```json
"fieldMappings": {
  "name":  { "from": "company_name",  "transform": "trim" },
  "email": { "from": "contact_email", "transform": "lowercase" }
}
```

To add a new field, just add a new entry:
```json
"website": { "from": "website_url", "transform": "lowercase" }
```

### Nested objects (contact, address, metadata)

```json
"nestedMappings": {
  "contact": {
    "firstName": { "from": "contact_first_name", "transform": "trim" }
  }
}
```

Static values (same for every row):
```json
"metadata": {
  "source":     { "value": "csv_import" },
  "importedAt": { "value": "__NOW__" }
}
```

`__NOW__` inserts the current ISO timestamp automatically.

### Validation rules

```json
"validationRules": {
  "required": ["company_name", "contact_email"],
  "email":    ["contact_email"],
  "nonEmpty": ["contact_first_name", "contact_last_name"]
}
```

| Rule | Effect |
|------|--------|
| `required` | Row rejected if field is missing or blank |
| `email` | Row rejected if field is not a valid email |
| `nonEmpty` | Row rejected if field is present but empty |

### Transforms

```json
"transforms": {
  "trim":       "value => value?.trim() ?? ''",
  "lowercase":  "value => value?.trim().toLowerCase() ?? ''",
  "uppercase":  "value => value?.trim().toUpperCase() ?? ''",
  "cleanPhone": "value => value?.replace(/[^\\d+\\-()\\s]/g, '').trim() ?? ''"
}
```

Add a custom one:
```json
"titleCase": "value => value?.split(' ').map(w => w[0]?.toUpperCase() + w.slice(1).toLowerCase()).join(' ') ?? ''"
```

Then reference it anywhere in `fieldMappings` or `nestedMappings`:
```json
"city": { "from": "city", "transform": "titleCase" }
```

---

## When you need to touch the scripts

Most changes are config-only. The cases below are exceptions:

| What you want to change | File to edit |
|------------------------|-------------|
| New validation type (e.g. phone format) | `scripts/validate.js` |
| Different CSV delimiter (semicolons, tabs) | `scripts/parseCsv.js` |
| Retry count or batch size defaults | `scripts/apiClient.js` |
| Transform that calls an external service | `scripts/transform.js` |

---

## API Behavior

- Customers are sent in batches of 5 (concurrent within each batch)
- Failed requests retry up to 3 times with exponential backoff: 500ms → 1s → 2s
- Retries happen on HTTP 429 (rate limit) and HTTP 5xx (server errors)
- Client errors (HTTP 4xx, except 429) are not retried
- Invalid rows are skipped and logged — valid rows always continue processing

---

## Reading the Report

After each run, `report.json` is written to the project root:

```json
{
  "summary": {
    "totalRowsInFile": 12,
    "successfullyParsed": 12,
    "passedValidation": 9,
    "failedValidation": 3,
    "apiSuccess": 9,
    "apiFailed": 0
  },
  "errors": [
    {
      "stage": "validation",
      "rowNumber": 8,
      "errors": ["Missing required: \"company_name\""]
    }
  ],
  "successfulCustomers": [
    { "name": "Acme Corp", "email": "john.doe@acme.com", "id": "1" }
  ]
}
```

The `errors` array tells you which rows failed and why, so you can fix them and re-run.

---

## Common Errors

| Message | Cause | Fix |
|---------|-------|-----|
| `Missing required: "company_name"` | Column is blank | Add the company name |
| `Bad email in "contact_email"` | Missing `@` or domain | Correct the email |
| `column count mismatch` | Unescaped comma in a field | Wrap that field in quotes |
| `HTTP 429` | API rate limit hit | Pipeline retries automatically |
| `HTTP 500` | API server error | Pipeline retries automatically |

---

## Design Notes

**Config-driven** — field mappings, transforms, and validation rules all live in `mapping.json`. Changing how data is structured requires no code changes.

**Single-responsibility modules** — each script does one thing. This makes them easy to test individually and swap out without side effects.

**Fail-forward validation** — rows that fail validation are logged and skipped. The rest of the file keeps processing.

**Retry with backoff** — transient API failures don't kill the run. The pipeline gives the server time to recover before trying again.

**Batch concurrency** — sending 5 requests in parallel per batch keeps the pipeline fast without hammering the API.
