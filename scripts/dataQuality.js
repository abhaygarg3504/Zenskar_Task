
import crypto from "crypto";

const VALID_COUNTRY_CODES = new Set([
  "US","GB","CA","AU","DE","FR","IN","SG","AE","NL","JP","CN",
  "BR","MX","ZA","NG","KE","PK","BD","PH","ID","TH","VN","MY",
  "IT","ES","PT","SE","NO","DK","FI","CH","AT","BE","IE","NZ",
  "AR","CL","CO","PE","EG","SA","QA","KW","BH","OM","JO","LB",
  "IL","TR","PL","CZ","HU","RO","BG","HR","SK","SI","EE","LV","LT"
]);

const EXPECTED_SCHEMA_FIELDS = [
  "company_name", "contact_email", "contact_first_name",
  "contact_last_name", "phone_number", "tax_id",
  "company_size", "address", "city", "country", "postal_code"
];

// Regex patterns
const PHONE_RE  = /^[\d\s\+\-\(\)\.]{7,20}$/;
const EMAIL_RE  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function main(rows, headers, existingHashes = []) {
  const startTime = Date.now();

  const issues       = [];
  const rowIssues    = {};  // rowNumber → [issues]
  const seenHashes   = new Set(existingHashes);
  const duplicates   = [];
  const seenEmails   = new Map();

  // ── 1. Schema drift detection ──────────────────────────────────────
  const missingFields   = EXPECTED_SCHEMA_FIELDS.filter(f => !headers.includes(f));
  const unexpectedFields = headers.filter(f => !EXPECTED_SCHEMA_FIELDS.includes(f) && f !== "_rowNumber");

  if (missingFields.length > 0) {
    issues.push({
      type: "SCHEMA_DRIFT",
      severity: "HIGH",
      message: `Missing expected fields: ${missingFields.join(", ")}`,
      missingFields,
    });
  }
  if (unexpectedFields.length > 0) {
    issues.push({
      type: "SCHEMA_DRIFT",
      severity: "LOW",
      message: `Unexpected fields found: ${unexpectedFields.join(", ")}`,
      unexpectedFields,
    });
  }

  const nullCounts = {};
  for (const field of EXPECTED_SCHEMA_FIELDS) nullCounts[field] = 0;

  for (const row of rows) {
    const rowNum = row._rowNumber;
    rowIssues[rowNum] = [];

    const hashInput = [
      row.company_name,
      row.contact_email,
      row.tax_id,
    ].join("|").toLowerCase().trim();
    const rowHash = crypto.createHash("sha256").update(hashInput).digest("hex");
    row._sourceHash = rowHash;

    if (seenHashes.has(rowHash)) {
      duplicates.push({ rowNumber: rowNum, company: row.company_name, hash: rowHash });
      rowIssues[rowNum].push("DUPLICATE_ROW");
    } else {
      seenHashes.add(rowHash);
    }

    const emailKey = (row.contact_email || "").toLowerCase().trim();
    if (emailKey) {
      if (seenEmails.has(emailKey)) {
        rowIssues[rowNum].push(`DUPLICATE_EMAIL:${emailKey}`);
      } else {
        seenEmails.set(emailKey, rowNum);
      }
    }

    for (const field of EXPECTED_SCHEMA_FIELDS) {
      const val = row[field];
      if (val === undefined || val === null || String(val).trim() === "") {
        nullCounts[field]++;
        if (["company_name", "contact_email"].includes(field)) {
          rowIssues[rowNum].push(`NULL_REQUIRED:${field}`);
        }
      }
    }

    const country = (row.country || "").trim().toUpperCase();
    if (country && !VALID_COUNTRY_CODES.has(country)) {
      rowIssues[rowNum].push(`INVALID_COUNTRY:${country}`);
    }

    const phone = (row.phone_number || "").trim();
    if (phone && !PHONE_RE.test(phone)) {
      rowIssues[rowNum].push(`INVALID_PHONE:${phone}`);
    }

    const email = (row.contact_email || "").trim();
    if (email && !EMAIL_RE.test(email)) {
      rowIssues[rowNum].push(`INVALID_EMAIL_FORMAT:${email}`);
    }
  }

  const nullPercentages = {};
  const nullWarnings    = [];
  for (const [field, count] of Object.entries(nullCounts)) {
    const pct = rows.length > 0 ? (count / rows.length) * 100 : 0;
    nullPercentages[field] = Math.round(pct * 100) / 100;
    if (pct > 50) {
      nullWarnings.push({
        type: "HIGH_NULL_RATE",
        severity: pct > 80 ? "HIGH" : "MEDIUM",
        field,
        nullPct: nullPercentages[field],
        message: `Field "${field}" is ${nullPercentages[field]}% null`,
      });
    }
  }
  issues.push(...nullWarnings);

  const rowIssueList = Object.entries(rowIssues)
    .filter(([, v]) => v.length > 0)
    .map(([rowNumber, issueTypes]) => ({ rowNumber: Number(rowNumber), issueTypes }));

  const totalRowsWithIssues = rowIssueList.length;
  const qualityScore = rows.length > 0
    ? Math.round(((rows.length - totalRowsWithIssues) / rows.length) * 100)
    : 100;

  const report = {
    generatedAt:        new Date().toISOString(),
    executionTimeMs:    Date.now() - startTime,
    summary: {
      totalRows:          rows.length,
      cleanRows:          rows.length - totalRowsWithIssues,
      rowsWithIssues:     totalRowsWithIssues,
      duplicatesFound:    duplicates.length,
      qualityScore,
    },
    schemaDrift: {
      missingFields,
      unexpectedFields,
    },
    nullPercentages,
    datasetIssues:  issues,
    duplicates,
    rowIssues:      rowIssueList,
  };

  const enrichedRows = rows.map(r => ({
    ...r,
    _sourceHash:   r._sourceHash,
    _qualityIssues: rowIssues[r._rowNumber] || [],
    _isClean:      (rowIssues[r._rowNumber] || []).length === 0,
  }));

  return { report, enrichedRows };
}