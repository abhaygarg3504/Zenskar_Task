
export async function main(
  parseResult,
  validationResult,
  transformErrors = [],
  apiResult
) {
  const now = new Date().toISOString();

  const rowErrors = [];

  for (const err of parseResult?.parseErrors || []) {
    rowErrors.push({ stage: "parse", message: err });
  }

  for (const item of validationResult?.invalidRows || []) {
    rowErrors.push({
      stage: "validation",
      rowNumber: item.row._rowNumber,
      company: item.row.company_name || "(unknown)",
      errors: item.errors,
    });
  }

  for (const err of transformErrors || []) {
    rowErrors.push({
      stage: "transform",
      rowNumber: err.rowNumber,
      error: err.error,
    });
  }
  for (const result of apiResult?.results || []) {
    if (result.status === "failed") {
      rowErrors.push({
        stage: "api",
        company: result.customer?.name || "(unknown)",
        error: result.error,
        attempts: result.attempts,
      });
    }
  }

  const totalInput   = parseResult?.totalRows ?? 0;
  const totalValid   = validationResult?.summary?.valid ?? 0;
  const totalInvalid = validationResult?.summary?.invalid ?? 0;
  const apiSuccess   = apiResult?.summary?.success ?? 0;
  const apiFailed    = apiResult?.summary?.failed ?? 0;

  const report = {
    generatedAt: now,
    summary: {
      totalRowsInFile:   totalInput + (parseResult?.parseErrors?.length ?? 0),
      successfullyParsed: totalInput,
      passedValidation:  totalValid,
      failedValidation:  totalInvalid,
      sentToAPI:         totalValid,
      apiSuccess,
      apiFailed,
      overallSuccess:    apiSuccess,
      overallFailed:     totalInvalid + apiFailed + transformErrors.length,
    },
    errors: rowErrors,
    successfulCustomers: (apiResult?.results || [])
      .filter((r) => r.status === "success")
      .map((r) => ({
        name:  r.customer?.name,
        email: r.customer?.email,
        id:    r.response?.id,
      })),
  };

  console.log("CSV Pipeline Report");
  console.log(`Parsed rows:         ${report.summary.successfullyParsed}`);
  console.log(`Passed validation:   ${report.summary.passedValidation}`);
  console.log(`Failed validation:   ${report.summary.failedValidation}`);
  console.log(`API success:         ${report.summary.apiSuccess}`);
  console.log(`API failed:          ${report.summary.apiFailed}`);
  console.log(`Total errors:        ${rowErrors.length}`);

  if (rowErrors.length > 0) {
    console.log("\n--- Error Details ---");
    for (const err of rowErrors) {
      console.log(JSON.stringify(err));
    }
  }

  return report;
}
