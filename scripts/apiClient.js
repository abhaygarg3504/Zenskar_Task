export async function main(
  customers,
  apiUrl,
  apiKey = "",
  retryAttempts = 3,
  batchSize = 5
) {

  if (!Array.isArray(customers)) {
    throw new Error("customers must be an array.");
  }

  if (!apiUrl) {
    throw new Error("apiUrl is required.");
  }

  const results = [];

  
// Instead of sending all requests at once,
// we process them in batches to avoid API overload
  for (let i = 0; i < customers.length; i += batchSize) {
    const batch = customers.slice(i, i + batchSize);
    // Promise.all is used here to send requests in parallel within a batch
  // This improves performance while still keeping control over concurrency
    const batchResults = await Promise.all(
      batch.map((customer) =>
        sendWithRetry(customer, apiUrl, apiKey, retryAttempts)
      )
    );

    results.push(...batchResults);
  }

  const success = results.filter((r) => r.status === "success").length;
  const failed = results.filter((r) => r.status === "failed").length;

  return {
    results,
    summary: {
      total: customers.length,
      success,
      failed,
    },
  };
}

// Retry mechanism is added to handle failures like network issues or server downtime
async function sendWithRetry(customer, apiUrl, apiKey, maxAttempts) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await sendCustomer(customer, apiUrl, apiKey);

      return {
        customer,
        status: "success",
        response,
        attempts: attempt,
      };
    } catch (err) {
      lastError = err;

      const isLastAttempt = attempt === maxAttempts;
      const isRetryable = isRetryableError(err);

      if (isLastAttempt || !isRetryable) break;

    // Exponential backoff helps reduce pressure on API and gives time for transient issues to resolve
      await sleep(500 * Math.pow(2, attempt - 1));
    }
  }

  return {
    customer,
    status: "failed",
    error: lastError?.message || "Unknown error",
    attempts: maxAttempts,
  };
}


async function sendCustomer(customer, apiUrl, apiKey) {
  const headers = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const res = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(customer),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new APIError(`HTTP ${res.status}: ${res.statusText}. Body: ${body}`, res.status);
  }

  return await res.json();
}

function isRetryableError(err) {
  if (err instanceof APIError) {
    return err.statusCode === 429 || err.statusCode >= 500;
  }
  return true;
}

class APIError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = "APIError";
    this.statusCode = statusCode;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
