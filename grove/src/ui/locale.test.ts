import { describe, expect, it } from "vitest";
import { pickLocale, primarySubtag } from "./locale";

const available = ["en", "de"];

describe("pickLocale", () => {
  it("takes the first preferred language on offer", () => {
    expect(pickLocale(available, ["de-AT", "de", "en-US", "en"])).toBe("de");
    expect(pickLocale(available, ["fr-FR", "en-GB"])).toBe("en");
  });

  it("matches a regional tag to its primary subtag", () => {
    expect(pickLocale(available, ["de-AT"])).toBe("de");
    expect(pickLocale(["en", "de-CH"], ["de"])).toBe("de-CH");
    expect(pickLocale(available, ["DE"])).toBe("de");
  });

  it("falls back to English when nothing matches", () => {
    expect(pickLocale(available, ["ja", "fr"])).toBe("en");
    expect(pickLocale(available, [])).toBe("en");
  });

  it("lets ?lang= override the browser, when it names a language we have", () => {
    expect(pickLocale(available, ["en"], "de")).toBe("de");
    expect(pickLocale(available, ["en"], "de-AT")).toBe("de");
    expect(pickLocale(available, ["de"], "ja")).toBe("de");
    expect(pickLocale(available, ["de"], "")).toBe("de");
    expect(pickLocale(available, ["de"], null)).toBe("de");
  });

  it("prefers an exact tag over a primary-subtag match", () => {
    expect(pickLocale(["en", "pt", "pt-BR"], ["pt-BR"])).toBe("pt-BR");
    expect(pickLocale(["en", "pt-BR", "pt"], ["pt"])).toBe("pt");
  });

  it("primarySubtag", () => {
    expect(primarySubtag("de-AT")).toBe("de");
    expect(primarySubtag("EN")).toBe("en");
    expect(primarySubtag("")).toBe("");
  });
});
