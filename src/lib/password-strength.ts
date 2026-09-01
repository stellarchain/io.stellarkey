export type PasswordStrengthScore = 0 | 1 | 2 | 3 | 4;

export interface PasswordStrength {
  score: PasswordStrengthScore;
  label: "Not rated" | "Weak" | "Fair" | "Good" | "Strong";
  color: string;
  feedback: string;
}

export interface NewVaultPasswordValidation {
  valid: boolean;
  message: string | null;
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

const WALLET_TERMS = new Set([
  "crypto",
  "lumens",
  "mnemonic",
  "password",
  "phrase",
  "private",
  "recovery",
  "secret",
  "seed",
  "stellar",
  "stellarkey",
  "vault",
  "wallet",
  "xlm",
]);

interface OfflineGuessabilityEstimator {
  check(password: string): { score: number };
}

let offlineGuessabilityEstimatorPromise: Promise<OfflineGuessabilityEstimator> | null = null;

function loadOfflineGuessabilityEstimator(): Promise<OfflineGuessabilityEstimator> {
  offlineGuessabilityEstimatorPromise ??= Promise.all([
    import("@zxcvbn-ts/core"),
    import("@zxcvbn-ts/language-common"),
  ]).then(([{ ZxcvbnFactory }, { adjacencyGraphs, dictionary }]) =>
    new ZxcvbnFactory({ graphs: adjacencyGraphs, dictionary }),
  );
  return offlineGuessabilityEstimatorPromise;
}

function hasWalletTheme(password: string): boolean {
  const terms = password.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return terms.filter((term) => WALLET_TERMS.has(term)).length >= 2;
}

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

function estimateStructuralStrength(password: string): PasswordStrength {
  if (!password) {
    return result(0, "Not rated", "#636366", "Use 12+ characters or four unrelated words.");
  }

  const normalized = password.toLowerCase();
  if (COMMON_PASSWORDS.has(normalized)) {
    return result(1, "Weak", "#FF453A", "Avoid common passwords and wallet-related terms.");
  }

  if (password.length < 12) {
    return result(1, "Weak", "#FF453A", "Use at least 12 characters.");
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

export function estimatePasswordStrength(password: string): PasswordStrength {
  const structural = estimateStructuralStrength(password);
  if (!password || structural.score <= 1) return structural;

  if (hasWalletTheme(password)) {
    return result(1, "Weak", "#FF453A", "Avoid wallet-related terms and predictable phrases.");
  }

  return structural;
}

async function estimatePasswordStrengthWithGuessability(
  password: string,
): Promise<PasswordStrength> {
  const structural = estimatePasswordStrength(password);
  if (!password || structural.score <= 1) return structural;

  let guessabilityScore: number;
  try {
    guessabilityScore = (await loadOfflineGuessabilityEstimator()).check(password).score;
  } catch {
    return result(
      1,
      "Weak",
      "#FF453A",
      "Password safety check is unavailable. Reload and try again.",
    );
  }

  if (guessabilityScore <= 1) {
    return result(1, "Weak", "#FF453A", "Avoid common passwords and predictable phrases.");
  }

  if (guessabilityScore === 2 && structural.score > 2) {
    return result(2, "Fair", "#FF9F0A", "Add length or use four unrelated words.");
  }

  return structural;
}

export function validateNewVaultPassword(password: string): NewVaultPasswordValidation {
  if (password.normalize("NFC") !== password) {
    return {
      valid: false,
      message: "Use a Unicode-normalized password. Retype accented characters directly.",
    };
  }
  const strength = estimatePasswordStrength(password);
  if (password.length < 12) {
    return { valid: false, message: "Password must be at least 12 characters." };
  }
  if (strength.score < 3) {
    return { valid: false, message: strength.feedback || "Use a Good or Strong password." };
  }
  return { valid: true, message: null };
}

export async function validateNewVaultPasswordWithGuessability(
  password: string,
): Promise<NewVaultPasswordValidation> {
  const immediate = validateNewVaultPassword(password);
  if (!immediate.valid) return immediate;

  const strength = await estimatePasswordStrengthWithGuessability(password);
  if (strength.score < 3) {
    return { valid: false, message: strength.feedback || "Use a Good or Strong password." };
  }
  return { valid: true, message: null };
}
