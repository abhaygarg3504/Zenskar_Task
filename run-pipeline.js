
const fs = require("fs");
const path = require("path");

function parseCSV(fileContent) {
  const lines = fileContent
    .replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    .split("\n").filter((l) => l.trim() !== "");

  if (lines.length < 2) throw new Error("CSV must have at least a header and one row.");

  const headers = parseLine(lines[0]);
  const rows = [];
  const parseErrors = [];

  for (let i = 1; i < lines.length; i++) {
    try {
      const values = parseLine(lines[i]);
      if (values.length !== headers.length) {
        parseErrors.push(`Row ${i + 1}: column count mismatch`);
        continue;
      }
      const row = { _rowNumber: i + 1 };
      headers.forEach((h, idx) => { row[h.trim()] = values[idx] ?? ""; });
      rows.push(row);
    } catch (e) {
      parseErrors.push(`Row ${i + 1}: ${e.message}`);
    }
  }

  return { rows, parseErrors, totalRows: rows.length, headers };
}

function parseLine(line) {
  const result = [];
  let current = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuote && line[i + 1] === '"') { current += '"'; i++; }
      else inQuote = !inQuote;
    } else if (c === "," && !inQuote) { result.push(current); current = ""; }
    else current += c;
  }
  result.push(current);
  return result;
}

function validateRows(rows, rules) {
  const validRows = [], invalidRows = [];
  for (const row of rows) {
    const errors = [];
    for (const f of rules.required || []) {
      if (!row[f] || row[f].trim() === "") errors.push(`Missing required: "${f}"`);
    }
    for (const f of rules.email || []) {
      const v = row[f]?.trim();
      if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errors.push(`Bad email in "${f}": ${v}`);
    }
    errors.length === 0 ? validRows.push(row) : invalidRows.push({ row, errors });
  }
  return { validRows, invalidRows, summary: { total: rows.length, valid: validRows.length, invalid: invalidRows.length } };
}

function buildTransformFns(transformsConfig) {
  const fns = {};
  for (const [name, fnStr] of Object.entries(transformsConfig || {})) {
    try { fns[name] = new Function("value", `return (${fnStr})(value)`); } catch {}
  }
  return fns;
}

function transformRows(validRows, config) {
  const fns = buildTransformFns(config.transforms);
  const customers = [], transformErrors = [];

  for (const row of validRows) {
    try {
      const customer = {};
      for (const [key, rule] of Object.entries(config.fieldMappings || {})) {
        const raw = row[rule.from] ?? "";
        customer[key] = fns[rule.transform] ? fns[rule.transform](raw) : raw;
      }
      for (const [groupKey, groupFields] of Object.entries(config.nestedMappings || {})) {
        customer[groupKey] = {};
        for (const [key, rule] of Object.entries(groupFields)) {
          if (rule.value !== undefined) {
            customer[groupKey][key] = rule.value === "__NOW__" ? new Date().toISOString() : rule.value;
          } else {
            const raw = row[rule.from] ?? "";
            customer[groupKey][key] = fns[rule.transform] ? fns[rule.transform](raw) : raw;
          }
        }
      }
      customers.push(customer);
    } catch (e) {
      transformErrors.push({ rowNumber: row._rowNumber, error: e.message });
    }
  }
  return { customers, transformErrors };
}

async function sendWithRetry(customer, apiUrl, apiKey, maxAttempts = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const headers = { "Content-Type": "application/json" };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      const res = await fetch(apiUrl, { method: "POST", headers, body: JSON.stringify(customer) });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      return { customer, status: "success", response: await res.json(), attempts: attempt };
    } catch (e) {
      lastErr = e;
      if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 500 * attempt));
    }
  }
  return { customer, status: "failed", error: lastErr?.message, attempts: maxAttempts };
}

async function sendCustomers(customers, apiUrl, apiKey) {
  const results = [];
  for (let i = 0; i < customers.length; i += 5) {
    const batch = customers.slice(i, i + 5);
    const batchResults = await Promise.all(batch.map(c => sendWithRetry(c, apiUrl, apiKey)));
    results.push(...batchResults);
  }
  const success = results.filter(r => r.status === "success").length;
  return { results, summary: { total: customers.length, success, failed: customers.length - success } };
}

async function run() {
  const csvFile = process.argv[2] || "sample-data/customers.csv";
  const apiUrl  = process.argv[3] || "http://localhost:3001/api/v1/customers";
  const apiKey  = process.argv[4] || "test-api-key-12345";

  console.log("CSV Pipeline Starting...");
  console.log(`CSV: ${csvFile}`);
  console.log(`API URL: ${apiUrl}\n`);

  const fileContent = fs.readFileSync(path.resolve(csvFile), "utf-8");
  const mappingConfig = JSON.parse(fs.readFileSync(path.resolve("config/mapping.json"), "utf-8"));

  console.log("Step 1: Parsing CSV...");
  const parseResult = parseCSV(fileContent);
  console.log(`Parsed ${parseResult.totalRows} rows. Parse errors: ${parseResult.parseErrors.length}`);

  console.log("Step 2: Validating rows...");
  const validationResult = validateRows(parseResult.rows, mappingConfig.validationRules);
  console.log(`Valid: ${validationResult.summary.valid} | Invalid: ${validationResult.summary.invalid}`);

  if (validationResult.invalidRows.length > 0) {
    for (const item of validationResult.invalidRows) {
      console.log(`Row ${item.row._rowNumber} (${item.row.company_name || "?"}): ${item.errors.join("; ")}`);
    }
  }

  console.log("Step 3: Transforming data...");
  const { customers, transformErrors } = transformRows(validationResult.validRows, mappingConfig);
  console.log(`   Transformed ${customers.length} customers. Transform errors: ${transformErrors.length}`);

  console.log("Step 4: Sending to API...");
  const apiResult = await sendCustomers(customers, apiUrl, apiKey);
  console.log(`   API success: ${apiResult.summary.success} | failed: ${apiResult.summary.failed}`);

  for (const r of apiResult.results) {
    if (r.status === "failed") {
      console.log(`${r.customer.name}: ${r.error}`);
    } else {
      console.log(`${r.customer.name} → id=${r.response?.id}`);
    }
  }
  console.log("Final Report:");
  console.log("─".repeat(40));
  console.log(`Rows in file:        ${parseResult.totalRows + parseResult.parseErrors.length}`);
  console.log(`Successfully parsed: ${parseResult.totalRows}`);
  console.log(`Passed validation:   ${validationResult.summary.valid}`);
  console.log(`Failed validation:   ${validationResult.summary.invalid}`);
  console.log(`API success:         ${apiResult.summary.success}`);
  console.log(`API failed:          ${apiResult.summary.failed}`);
  console.log("─".repeat(40));

  const successRate = ((apiResult.summary.success / parseResult.totalRows) * 100).toFixed(1);
  console.log(`Overall success rate: ${successRate}%\n`);

  const report = {
    generatedAt: new Date().toISOString(),
    parseResult,
    validationSummary: validationResult.summary,
    apiSummary: apiResult.summary,
    errors: [
      ...parseResult.parseErrors.map(e => ({ stage: "parse", error: e })),
      ...validationResult.invalidRows.map(i => ({ stage: "validation", rowNumber: i.row._rowNumber, errors: i.errors })),
      ...transformErrors.map(e => ({ stage: "transform", ...e })),
      ...apiResult.results.filter(r => r.status === "failed").map(r => ({ stage: "api", name: r.customer.name, error: r.error })),
    ],
  };

  fs.writeFileSync("report.json", JSON.stringify(report, null, 2));
  console.log("Report saved to: report.json\n");
}

run().catch(console.error);
