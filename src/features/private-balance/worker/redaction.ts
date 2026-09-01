const SENSITIVE_PATTERNS = [
  /S[A-Z0-9]{55}/g, // Stellar secret key (S...)
  /\b[0-9]{18,}\b/g, // Field elements and witness values
  /[0-9a-fA-F]{64}/g, // 32-byte hex keys
];

export function redactSensitiveData(text: string): string {
  let out = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    out = out.replace(pattern, '[REDACTED]');
  }
  return out;
}
