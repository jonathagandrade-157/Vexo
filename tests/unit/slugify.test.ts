import { describe, expect, it } from "vitest";
import { slugify, slugifyWithSuffix } from "@/lib/utils/slugify";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("My Awesome Store")).toBe("my-awesome-store");
  });

  it("strips accents", () => {
    expect(slugify("Açaí & Cia Ltda")).toBe("acai-cia-ltda");
  });

  it("collapses punctuation and repeated separators", () => {
    expect(slugify("Loja da Maria — Presentes & Cia.")).toBe(
      "loja-da-maria-presentes-cia",
    );
  });

  it("never produces leading/trailing hyphens", () => {
    expect(slugify("--Loja--")).toBe("loja");
  });

  it("falls back to a default when nothing alphanumeric survives", () => {
    expect(slugify("   ")).toBe("loja");
    expect(slugify("...")).toBe("loja");
  });

  it("matches the DB's tenants_slug_format constraint", () => {
    const pattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    expect(slugify("Açaí & Cia Ltda 123")).toMatch(pattern);
  });
});

describe("slugifyWithSuffix", () => {
  it("appends a short suffix after the base slug", () => {
    const result = slugifyWithSuffix("My Store");
    expect(result).toMatch(/^my-store-[a-z0-9]{4}$/);
  });

  it("produces different values on repeated calls", () => {
    const a = slugifyWithSuffix("My Store");
    const b = slugifyWithSuffix("My Store");
    expect(a).not.toBe(b);
  });
});
