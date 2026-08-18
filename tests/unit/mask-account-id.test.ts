import { describe, expect, it } from "vitest";
import { maskAccountId } from "@/features/payments/mask";

describe("maskAccountId", () => {
  it("returns an em dash for null (never connected)", () => {
    expect(maskAccountId(null)).toBe("—");
  });

  it("masks a long account id, keeping only the last 4 characters", () => {
    expect(maskAccountId("123456789012")).toBe("********9012");
  });

  it("fully masks an id 4 characters or shorter", () => {
    expect(maskAccountId("1234")).toBe("****");
    expect(maskAccountId("12")).toBe("**");
  });
});
