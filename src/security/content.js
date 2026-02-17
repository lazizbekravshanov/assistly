const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /\+?\d[\d\s\-()]{7,}\d/g;

export function scanContentSafety(text = '') {
  const flags = [];
  if (EMAIL.test(text)) flags.push('contains_email');
  if (PHONE.test(text)) flags.push('contains_phone');
  if (/\b(ignore previous instructions|disregard all prior rules)\b/i.test(text)) {
    flags.push('prompt_injection_phrase');
  }

  return {
    safe: flags.length === 0,
    flags
  };
}
