import { describe, expect, it } from "vitest";
import { generatePassword } from "./generator.js";
import { assessPassword } from "./health.js";

describe("password tools", () => {
  it("generates requested length and selected character classes", () => {
    const password = generatePassword({ length: 32 });
    expect(password).toHaveLength(32);
    expect(password).toMatch(/[a-z]/u);
    expect(password).toMatch(/[A-Z]/u);
    expect(password).toMatch(/\d/u);
    expect(password).toMatch(/[^A-Za-z0-9]/u);
  });

  it("marks common and reused passwords", () => {
    expect(assessPassword("password", true)).toMatchObject({ level: "critical", score: 0 });
  });
});
