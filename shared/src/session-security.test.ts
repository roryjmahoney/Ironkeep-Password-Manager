import { describe, expect, it } from "vitest";
import { BACKGROUND_LOCK_GRACE_MS, SessionDeadline, shouldClearClipboard, validateSecuritySettings } from "./session-security.js";

describe("session security", () => {
  it("expires after inactivity and resets only on explicit activity", () => {
    const deadline = new SessionDeadline();
    deadline.open(1_000);
    expect(deadline.expiryReason(60_999, 1)).toBeNull();
    deadline.touch(50_000);
    expect(deadline.expiryReason(109_999, 1)).toBeNull();
    expect(deadline.expiryReason(110_000, 1)).toBe("inactivity");
  });

  it("uses the shorter background grace and preserves it until foregrounded", () => {
    const deadline = new SessionDeadline();
    deadline.open(1_000);
    deadline.background(2_000);
    expect(deadline.remainingMs(2_000, 5)).toBe(BACKGROUND_LOCK_GRACE_MS);
    expect(deadline.expiryReason(2_000 + BACKGROUND_LOCK_GRACE_MS, 5)).toBe("background");
    deadline.foreground();
    expect(deadline.expiryReason(2_000 + BACKGROUND_LOCK_GRACE_MS, 5)).toBeNull();
  });

  it("validates settings and clears only the clipboard value Ironkeep wrote", () => {
    expect(() => validateSecuritySettings(1, 15)).not.toThrow();
    expect(() => validateSecuritySettings(0, 30)).toThrow(RangeError);
    expect(() => validateSecuritySettings(5, 121)).toThrow(RangeError);
    expect(shouldClearClipboard("secret", "secret")).toBe(true);
    expect(shouldClearClipboard("secret", "newer value")).toBe(false);
  });
});
