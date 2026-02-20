const PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /ignore\s+(all\s+)?prior\s+instructions/i,
  /disregard\s+(all\s+)?prior\s+(rules|instructions|prompts)/i,
  /reveal\s+(system\s+prompt|api\s+key|passphrase|secret|credentials)/i,
  /forget\s+(all\s+)?(previous|prior|your)\s+(instructions|rules|context)/i,
  /override\s+(all\s+)?(safety|security|previous|prior)\s*(filters|rules|instructions)?/i,
  /you\s+are\s+now\s+(a|an|in)\s+/i,
  /new\s+instructions?\s*:/i,
  /system\s*:\s*/i,
  /\]\s*\}\s*\{?\s*"?role"?\s*:\s*"?system/i
];

export function hasInjectionRisk(text = '') {
  return PATTERNS.some((pattern) => pattern.test(text));
}
