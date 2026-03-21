export async function main(rows, validationRules) {
  if (!Array.isArray(rows)) {
    throw new Error("rows must be an array.");
  }

  const rules = validationRules || {
    required: ["company_name", "contact_email"],
    email: ["contact_email"],
    nonEmpty: ["contact_first_name", "contact_last_name"],
  };

  const validRows = [];
  const invalidRows = [];

  for (const row of rows) {
    const errors = validateRow(row, rules);

    if (errors.length === 0) {
      validRows.push(row);
    } else {
      invalidRows.push({ row, errors });
    }
  }

  return {
    validRows,
    invalidRows,
    summary: {
      total: rows.length,
      valid: validRows.length,
      invalid: invalidRows.length,
    },
  };
}

function validateRow(row, rules) {
  const errors = [];

  for (const field of rules.required || []) {
    if (!row[field] || row[field].trim() === "") {
      errors.push(`Missing required field: "${field}"`);
    }
  }

  for (const field of rules.email || []) {
    const val = row[field]?.trim();
    if (val && !isValidEmail(val)) {
      errors.push(`Invalid email format in field "${field}": "${val}"`);
    }
  }

  for (const field of rules.nonEmpty || []) {
    if (row[field] !== undefined && row[field].trim() === "") {
      errors.push(`Field "${field}" must not be empty.`);
    }
  }

  return errors;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
