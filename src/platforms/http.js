function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 429 || (status >= 500 && status < 600);
}

export async function apiRequest({
  url,
  method = 'GET',
  headers = {},
  body,
  timeoutMs = 10000,
  retries = 2,
  backoffMs = 250
}) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
    } catch (error) {
      clearTimeout(timer);
      if (attempt < retries) {
        await sleep(backoffMs * (2 ** attempt));
        continue;
      }
      const err = new Error(error.name === 'AbortError' ? 'Request timed out' : error.message);
      err.statusCode = 0;
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    if (!response.ok) {
      if (attempt < retries && isRetryableStatus(response.status)) {
        await sleep(backoffMs * (2 ** attempt));
        continue;
      }
      const message = data?.error?.message || data?.message || text || `HTTP ${response.status}`;
      const err = new Error(message);
      err.statusCode = response.status;
      throw err;
    }

    return { data, statusCode: response.status };
  }

  throw new Error('Unreachable request failure');
}

export function assertConfigured(name, value) {
  if (!value || (typeof value === 'string' && value.trim() === '')) {
    throw new Error(`${name} is not configured`);
  }
}
