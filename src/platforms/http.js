export async function apiRequest({ url, method = 'GET', headers = {}, body }) {
  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const message = data?.error?.message || data?.message || text || `HTTP ${response.status}`;
    const err = new Error(message);
    err.statusCode = response.status;
    throw err;
  }

  return { data, statusCode: response.status };
}

export function assertConfigured(name, value) {
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
}
