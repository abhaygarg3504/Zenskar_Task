# CSV Customer Import Pipeline

A modular pipeline that reads customer data from a CSV file, validates and transforms each row using config-driven rules, then creates customers via a REST API — with retry handling, batch processing, and a structured final report.

---

## Table of Contents

- [How it works](#how-it-works)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Local Setup & Installation](#local-setup--installation)
- [Quick Start](#quick-start)
- [CSV Format](#csv-format)
- [Configuration — config/mapping.json](#configuration--configmappingjson)
- [When you need to touch the scripts](#when-you-need-to-touch-the-scripts)
- [API Behavior](#api-behavior)
- [Reading the Report](#reading-the-report)
- [Common Errors](#common-errors)
- [Design Notes](#design-notes)

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
csv-pipeline/
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

## Prerequisites

Before setting up the project, make sure you have the following installed on your machine:

### 1. Node.js (v18 or higher)

Check if Node.js is already installed:
```bash
node --version
```

If not installed, download it from the official site: https://nodejs.org/en/download

- **Windows/macOS**: Download the LTS installer and run it.
- **Linux (Ubuntu/Debian)**:
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
  sudo apt-get install -y nodejs
  ```

### 2. npm (comes with Node.js)

Verify npm is available:
```bash
npm --version
```

### 3. Git

To clone the repository:
```bash
git --version
```

If not installed: https://git-scm.com/downloads

---

## Local Setup & Installation

Follow these steps to get the project running on your local machine.

### Step 1 — Clone the repository

```bash
git clone https://github.com/your-org/windmill-csv-pipeline.git
cd windmill-csv-pipeline
```

> If you received the project as a ZIP file, extract it and navigate into the folder:
> ```bash
> cd windmill-csv-pipeline
> ```

### Step 2 — Install root dependencies

From the project root, install the main pipeline dependencies:

```bash
npm install
```

### Step 3 — Install mock API dependencies

The mock API is a separate Express server with its own `package.json`. Install its dependencies:

```bash
cd mock-api
npm install
cd ..
```

### Step 4 — Verify the project structure

Your directory should look like this after installation:

```
windmill-csv-pipeline/
├── node_modules/         ← installed after Step 2
├── mock-api/
│   └── node_modules/     ← installed after Step 3
├── scripts/
├── config/
├── sample-data/
└── run-pipeline.js
```

---

## Quick Start

Choose one of the three options below depending on your setup.

---

### Option A — Run locally (no Windmill, no internet needed)

This is the recommended option for local development and testing.

**You will need two terminal windows open at the same time.**

**Terminal 1 — Start the mock API server:**
```bash
cd mock-api
npm start
```

You should see:
```
Mock API running at http://localhost:3001
  POST http://localhost:3001/api/v1/customers
  API Key (Bearer): test-api-key-12345
```

Keep this terminal running.

**Terminal 2 — Run the pipeline:**
```bash
node run-pipeline.js sample-data/customers.csv http://localhost:3001/api/v1/customers test-api-key-12345
```

**Check the results:**
```bash
# View the generated report
cat report.json

# View all successfully created customers
curl http://localhost:3001/api/v1/customers
```

---

### Option B — Run on Windmill

**1. Set up a cloud mock endpoint (MockAPI.io):**
1. Go to https://mockapi.io and create a free account
2. Create a project named `csv-pipeline`
3. Add a resource called `customers` with these fields: `name`, `email`, `taxId`, `companySize`, `contact` (Object), `address` (Object), `metadata` (Object)
4. Copy your endpoint URL — it looks like: `https://XXXXXXXX.mockapi.io/api/v1/customers`

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

Refer to `flows/csv_pipeline.json` for the full binding configuration.

**3. Run the flow with these inputs:**
- `fileContent` — paste the contents of `sample-data/customers.csv`
- `apiUrl` — your MockAPI endpoint URL
- `apiKey` — leave blank (MockAPI doesn't require one by default)
- `mappingConfig` — paste the full contents of `config/mapping.json`

---

### Option C — MockAPI.io endpoint with local runner

Use this if you want to run the pipeline locally but send data to a cloud endpoint.

```bash
node run-pipeline.js sample-data/customers.csv https://YOUR_ID.mockapi.io/api/v1/customers
```

---

## Expected Output

```
 CSV Pipeline Starting...

 Step 1: Parsing CSV...
   Parsed 12 rows. Parse errors: 0

 Step 2: Validating rows...
   Valid: 9 | Invalid: 3
   ⚠ Row 8 (?): Missing required: "company_name"
   ⚠ Row 9 (Theta Corp): Bad email in "contact_email": not-an-email

 Step 3: Transforming data...
   Transformed 9 customers.

 Step 4: Sending to API...
   ✓ Acme Corp → id=1
   ✓ Beta Inc → id=2
   ...

 Final Report:
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
| `company_name` | yes | Acme Corp |
| `contact_email` | yes | john@acme.com |
| `contact_first_name` | yes | John |
| `contact_last_name` | yes | Doe |
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
| `Cannot find module` | Dependencies not installed | Run `npm install` in root and `mock-api/` |
| `EADDRINUSE: address already in use :3001` | Port 3001 is already occupied | Kill the process using port 3001 or change the port in `mock-api/server.js` |
| `ENOENT: no such file or directory` | Wrong path to CSV file | Check the file path passed to `run-pipeline.js` |

---

## Design Notes

**Config-driven** — field mappings, transforms, and validation rules all live in `mapping.json`. Changing how data is structured requires no code changes.

**Single-responsibility modules** — each script does one thing. This makes them easy to test individually and swap out without side effects.

**Fail-forward validation** — rows that fail validation are logged and skipped. The rest of the file keeps processing.

**Retry with backoff** — transient API failures don't kill the run. The pipeline gives the server time to recover before trying again.

**Batch concurrency** — sending 5 requests in parallel per batch keeps the pipeline fast without hammering the API.
