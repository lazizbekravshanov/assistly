const PATTERNS = [
  /ignore\s+previous\s+instructions/i,
  /disregard\s+all\s+prior\s+rules/i,
  /reveal\s+(system\s+prompt|api\s+key|passphrase)/i
];

export function hasInjectionRisk(text = '') {
  return PATTERNS.some((pattern) => pattern.test(text));
}
