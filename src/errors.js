export function apiError(code, message, details = null) {
  return {
    ok: false,
    error: {
      code,
      message,
      details
    }
  };
}

