export function readRequestBody(req, { maxBytes = 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    let settled = false;

    function finishError(error) {
      if (settled) return;
      settled = true;
      reject(error);
    }

    function finishSuccess(value) {
      if (settled) return;
      settled = true;
      resolve(value);
    }

    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        const error = new Error('Payload too large');
        error.code = 'payload_too_large';
        finishError(error);
        req.destroy(error);
        return;
      }
      body += chunk;
    });

    req.on('end', () => finishSuccess(body));
    req.on('error', finishError);
  });
}
