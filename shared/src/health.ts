import type { LoginItem } from "./models.js";

const COMMON_PASSWORDS = new Set([
  "123456", "12345678", "123456789", "password", "password1", "qwerty",
  "qwerty123", "admin", "letmein", "welcome", "iloveyou", "monkey", "dragon",
]);

export type PasswordHealthLevel = "critical" | "weak" | "fair" | "strong";

export interface PasswordHealthResult {
  level: PasswordHealthLevel;
  score: number;
  findings: string[];
}

function hasSequence(password: string): boolean {
  const normalized = password.toLowerCase();
  const sequences = ["abcdefghijklmnopqrstuvwxyz", "0123456789", "qwertyuiop", "asdfghjkl"];
  return sequences.some((sequence) => {
    for (let index = 0; index <= sequence.length - 4; index += 1) {
      if (normalized.includes(sequence.slice(index, index + 4))) return true;
    }
    return false;
  });
}

export function assessPassword(password: string, reused = false): PasswordHealthResult {
  const findings: string[] = [];
  let score = Math.min(55, password.length * 3);
  const classes = [/[a-z]/u, /[A-Z]/u, /\d/u, /[^A-Za-z0-9]/u].filter((pattern) => pattern.test(password)).length;
  score += classes * 10;
  if (password.length < 12) findings.push("Shorter than 12 characters");
  if (classes < 3) findings.push("Uses too few character types");
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    findings.push("Commonly guessed password");
    score = 0;
  }
  if (/(.)\1{2,}/u.test(password)) {
    findings.push("Contains repeated characters");
    score -= 15;
  }
  if (hasSequence(password)) {
    findings.push("Contains a predictable sequence");
    score -= 20;
  }
  if (reused) {
    findings.push("Reused in this vault");
    score -= 35;
  }
  score = Math.max(0, Math.min(100, score));
  const level: PasswordHealthLevel = score < 30 ? "critical" : score < 55 ? "weak" : score < 80 ? "fair" : "strong";
  return { level, score, findings };
}

export function assessVaultPasswords(logins: LoginItem[]): Map<string, PasswordHealthResult> {
  const counts = new Map<string, number>();
  for (const login of logins) counts.set(login.password, (counts.get(login.password) ?? 0) + 1);
  return new Map(logins.map((login) => [login.id, assessPassword(login.password, (counts.get(login.password) ?? 0) > 1)]));
}
