export type PasswordStrengthScore = 0 | 1 | 2 | 3 | 4;

export interface PasswordStrength {
  score: PasswordStrengthScore;
  label: "Not rated" | "Weak" | "Fair" | "Good" | "Strong";
  color: string;
  feedback: string;
}

const COMMON_PASSWORDS = new Set([
  "12345678",
  "admin123",
  "changeme",
  "crypto123",
  "letmein",
  "password",
  "password1",
  "password123",
  "qwerty123",
  "stellar123",
  "welcome1",
]);

const SEQUENCES = [
  "0123456789",
  "9876543210",
  "abcdefghijklmnopqrstuvwxyz",
  "zyxwvutsrqponmlkjihgfedcba",
  "qwertyuiop",
  "poiuytrewq",
];

function hasPredictablePattern(password: string): boolean {
  const normalized = password.toLowerCase().replace(/\s/g, "");
  if (/(.)\1{3,}/.test(normalized)) return true;
  if (/^(.{2,8})\1+$/.test(normalized)) return true;
  if (SEQUENCES.some((sequence) => sequence.includes(normalized))) return true;
  if (normalized.length > 12) return false;
  return SEQUENCES.some((sequence) => {
    for (let index = 0; index <= sequence.length - 4; index += 1) {
      if (normalized.includes(sequence.slice(index, index + 4))) return true;
    }
    return false;
  });
}

function result(
  score: PasswordStrengthScore,
  label: PasswordStrength["label"],
  color: string,
  feedback: string,
): PasswordStrength {
  return { score, label, color, feedback };
}

export function estimatePasswordStrength(password: string): PasswordStrength {
  if (!password) {
    return result(0, "Not rated", "#636366", "Use 12+ characters or four unrelated words.");
  }

  if (password.length < 8) {
    return result(1, "Weak", "#FF453A", "Use at least 8 characters.");
  }

  const normalized = password.toLowerCase();
  if (COMMON_PASSWORDS.has(normalized)) {
    return result(1, "Weak", "#FF453A", "Avoid common passwords and wallet-related terms.");
  }

  if (hasPredictablePattern(password)) {
    return result(1, "Weak", "#FF453A", "Avoid repeated or predictable character sequences.");
  }

  const characterClasses = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9\s]/].filter((pattern) =>
    pattern.test(password),
  ).length;
  const words = password.trim().split(/\s+/).filter(Boolean);
  const uniqueRatio = new Set(normalized).size / password.length;

  if (
    (words.length >= 4 && password.length >= 20) ||
    (password.length >= 14 && characterClasses >= 3 && uniqueRatio >= 0.8)
  ) {
    return result(4, "Strong", "#30D158", "Long and difficult to guess.");
  }

  if (password.length >= 12 && characterClasses >= 3) {
    return result(3, "Good", "#64D2FF", "Good. More length would make it stronger.");
  }

  if (password.length >= 10 || characterClasses >= 3) {
    return result(2, "Fair", "#FF9F0A", "Add length or use four unrelated words.");
  }

  return result(1, "Weak", "#FF453A", "Add length and make it less predictable.");
}
