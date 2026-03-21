
export async function main(fileContent) {
  if (!fileContent || typeof fileContent !== "string") {
    throw new Error("Invalid input: fileContent must be a non-empty string.");
  }

  const lines = fileContent
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim() !== "");

  if (lines.length < 2) {
    throw new Error("CSV must have at least a header row and one data row.");
  }

  const headers = parseCSVLine(lines[0]);
  const rows = [];
  const parseErrors = [];

  for (let i = 1; i < lines.length; i++) {
    try {
      const values = parseCSVLine(lines[i]);

      if (values.length !== headers.length) {
        parseErrors.push(
          `Row ${i + 1}: column count mismatch (expected ${headers.length}, got ${values.length})`
        );
        continue;
      }

      const row = {};
      headers.forEach((header, idx) => {
        row[header.trim()] = values[idx] ?? "";
      });

      rows.push({ _rowNumber: i + 1, ...row });
    } catch (err) {
      parseErrors.push(`Row ${i + 1}: ${err.message}`);
    }
  }

  return {
    rows,
    parseErrors,
    totalRows: rows.length,
    headers,
  };
}

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let insideQuote = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (insideQuote && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        insideQuote = !insideQuote;
      }
    } else if (char === "," && !insideQuote) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}
