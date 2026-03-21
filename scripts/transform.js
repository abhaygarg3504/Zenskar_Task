export async function main(validRows, mappingConfig) {
  if (!Array.isArray(validRows)) {
    throw new Error("validRows must be an array.");
  }

  const config = mappingConfig || getDefaultConfig();

  const transformFns = buildTransformFunctions(config.transforms || {});

  const customers = [];
  const transformErrors = [];

  for (const row of validRows) {
    try {
      const customer = transformRow(row, config, transformFns);
      customers.push(customer);
    } catch (err) {
      transformErrors.push({
        rowNumber: row._rowNumber,
        error: err.message,
      });
    }
  }

  return { customers, transformErrors };
}

function transformRow(row, config, transformFns) {
  const customer = {};

  for (const [targetKey, rule] of Object.entries(config.fieldMappings || {})) {
    const rawValue = row[rule.from] ?? "";
    customer[targetKey] = applyTransform(rawValue, rule.transform, transformFns);
  }

  for (const [groupKey, groupFields] of Object.entries(config.nestedMappings || {})) {
    customer[groupKey] = {};

    for (const [targetKey, rule] of Object.entries(groupFields)) {
      if (rule.value !== undefined) {
        customer[groupKey][targetKey] =
          rule.value === "__NOW__" ? new Date().toISOString() : rule.value;
      } else {
        const rawValue = row[rule.from] ?? "";
        customer[groupKey][targetKey] = applyTransform(rawValue, rule.transform, transformFns);
      }
    }
  }

  return customer;
}

function applyTransform(value, transformName, transformFns) {
  if (!transformName || !transformFns[transformName]) return value;

  try {
    return transformFns[transformName](value);
  } catch {
    return value;
  }
}

function buildTransformFunctions(transformsConfig) {
  const fns = {};

  for (const [name, fnString] of Object.entries(transformsConfig)) {
    try {
      fns[name] = new Function("value", `return (${fnString})(value)`);
    } catch {
      console.warn(`Warning: Could not build transform function "${name}"`);
    }
  }

  return fns;
}

function getDefaultConfig() {
  return {
    fieldMappings: {
      name:        { from: "company_name",       transform: "trim" },
      email:       { from: "contact_email",      transform: "lowercase" },
      taxId:       { from: "tax_id",             transform: "trim" },
      companySize: { from: "company_size",        transform: "trim" },
    },
    nestedMappings: {
      contact: {
        firstName: { from: "contact_first_name", transform: "trim" },
        lastName:  { from: "contact_last_name",  transform: "trim" },
        phone:     { from: "phone_number",        transform: "cleanPhone" },
      },
      address: {
        street:     { from: "address",     transform: "trim" },
        city:       { from: "city",        transform: "trim" },
        country:    { from: "country",     transform: "uppercase" },
        postalCode: { from: "postal_code", transform: "trim" },
      },
      metadata: {
        source:     { value: "csv_import" },
        importedAt: { value: "__NOW__" },
      },
    },
    transforms: {
      trim:       "value => value?.trim() ?? ''",
      lowercase:  "value => value?.trim().toLowerCase() ?? ''",
      uppercase:  "value => value?.trim().toUpperCase() ?? ''",
      cleanPhone: "value => value?.replace(/[^\\d+\\-()\\s]/g, '').trim() ?? ''",
    },
  };
}
