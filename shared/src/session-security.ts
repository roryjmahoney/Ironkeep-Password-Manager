export const MIN_AUTO_LOCK_MINUTES = 1;
export const MAX_AUTO_LOCK_MINUTES = 60;
export const MIN_CLIPBOARD_CLEAR_SECONDS = 15;
export const MAX_CLIPBOARD_CLEAR_SECONDS = 120;
export const BACKGROUND_LOCK_GRACE_MS = 15_000;

export type SessionExpiryReason = "background" | "inactivity";

export function validateSecuritySettings(autoLockMinutes: number, clearClipboardSeconds: number): void {
  if (!Number.isInteger(autoLockMinutes) || autoLockMinutes < MIN_AUTO_LOCK_MINUTES || autoLockMinutes > MAX_AUTO_LOCK_MINUTES) {
    throw new RangeError("Auto-lock timeout is outside Ironkeep limits");
  }
  if (!Number.isInteger(clearClipboardSeconds) || clearClipboardSeconds < MIN_CLIPBOARD_CLEAR_SECONDS || clearClipboardSeconds > MAX_CLIPBOARD_CLEAR_SECONDS) {
    throw new RangeError("Clipboard timeout is outside Ironkeep limits");
  }
}

export class SessionDeadline {
  private lastActivityMs: number | null = null;
  private backgroundedAtMs: number | null = null;

  open(nowMs: number): void {
    this.lastActivityMs = nowMs;
    this.backgroundedAtMs = null;
  }

  touch(nowMs: number): void {
    if (this.lastActivityMs !== null) this.lastActivityMs = nowMs;
  }

  background(nowMs: number): void {
    if (this.lastActivityMs !== null && this.backgroundedAtMs === null) this.backgroundedAtMs = nowMs;
  }

  foreground(): void {
    this.backgroundedAtMs = null;
  }

  close(): void {
    this.lastActivityMs = null;
    this.backgroundedAtMs = null;
  }

  expiryReason(nowMs: number, autoLockMinutes: number): SessionExpiryReason | null {
    if (this.lastActivityMs === null) return null;
    const inactivityDeadline = this.lastActivityMs + autoLockMinutes * 60_000;
    const backgroundDeadline = this.backgroundedAtMs === null ? Number.POSITIVE_INFINITY : this.backgroundedAtMs + BACKGROUND_LOCK_GRACE_MS;
    if (nowMs < Math.min(inactivityDeadline, backgroundDeadline)) return null;
    return backgroundDeadline <= inactivityDeadline ? "background" : "inactivity";
  }

  remainingMs(nowMs: number, autoLockMinutes: number): number | null {
    if (this.lastActivityMs === null) return null;
    const inactivityDeadline = this.lastActivityMs + autoLockMinutes * 60_000;
    const backgroundDeadline = this.backgroundedAtMs === null ? Number.POSITIVE_INFINITY : this.backgroundedAtMs + BACKGROUND_LOCK_GRACE_MS;
    return Math.max(0, Math.min(inactivityDeadline, backgroundDeadline) - nowMs);
  }
}

export function shouldClearClipboard(expected: string, current: string): boolean {
  return expected.length > 0 && current === expected;
}
