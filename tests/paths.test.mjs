import { describe, expect, it } from "vitest";
import { cacheBustPath, normalizePath, samePath } from "../scripts/paths.mjs";

describe("normalizePath", () => {
  it("returns empty string for non-strings / falsy", () => {
    expect(normalizePath(undefined)).toBe("");
    expect(normalizePath(null)).toBe("");
    expect(normalizePath(42)).toBe("");
    expect(normalizePath("")).toBe("");
  });

  it("ignores ATF's numeric cache query but preserves meaningful URL components", () => {
    expect(normalizePath("tokens/a.webp?12345")).toBe("tokens/a.webp");
    expect(normalizePath("tokens/a.webp?12345#frag")).toBe("tokens/a.webp#frag");
    expect(normalizePath("https://images.test/token?form=armored&signature=abc")).toBe(
      "https://images.test/token?form=armored&signature=abc",
    );
    expect(normalizePath("tokens/a.webp#frag")).toBe("tokens/a.webp#frag");
  });

  it("decodes percent-encoding", () => {
    expect(normalizePath("worlds/my%20world/a.webp")).toBe("worlds/my world/a.webp");
    expect(normalizePath("tokens/hero%23armored.webp")).toBe("tokens/hero%23armored.webp");
    expect(normalizePath("tokens/hero%3Farmored.webp")).toBe("tokens/hero%3Farmored.webp");
  });

  it("normalizes backslashes and trailing slashes", () => {
    expect(normalizePath("worlds\\x\\a.webp")).toBe("worlds/x/a.webp");
    expect(normalizePath("tokens/dir/")).toBe("tokens/dir");
  });
});

describe("samePath", () => {
  it("treats differently-encoded references to one file as equal", () => {
    expect(samePath("worlds/x/a.webp?2", "worlds/x/a.webp")).toBe(true);
    expect(samePath("worlds/my%20world/a.webp", "worlds/my world/a.webp")).toBe(true);
  });

  it("is false for different files and for empty inputs", () => {
    expect(samePath("a.webp", "b.webp")).toBe(false);
    expect(samePath("", "")).toBe(false);
    expect(samePath(undefined, "a.webp")).toBe(false);
  });

  it("distinguishes images selected by query strings or fragments", () => {
    expect(samePath("https://images.test/token?form=a", "https://images.test/token?form=b")).toBe(false);
    expect(samePath("tokens/a.svg#front", "tokens/a.svg#back")).toBe(false);
    expect(samePath("tokens/hero%23armored.webp", "tokens/hero#armored.webp")).toBe(false);
    expect(samePath("tokens/a.svg#view?123", "tokens/a.svg#view")).toBe(false);
    expect(samePath("https://images.test/token?key=x?123", "https://images.test/token?key=x")).toBe(false);
  });
});

describe("cacheBustPath", () => {
  it("refreshes only ATF's numeric query without decoding filenames", () => {
    const src = "tokens/hero%23armored.webp";
    expect(cacheBustPath(src, 123)).toBe(`${src}?123`);
    expect(cacheBustPath(`${src}?123`, 456)).toBe(`${src}?456`);
    expect(cacheBustPath(`${src}#view`, 456)).toBe(`${src}?456#view`);
    expect(samePath(cacheBustPath(src, 123), src)).toBe(true);
  });

  it("leaves existing URL parameters untouched, including signed URLs", () => {
    const src = "https://images.test/hero%23armored.webp?form=b&signature=a%2Bb#view";
    expect(cacheBustPath(src, 123)).toBe(src);
  });

  it("returns empty for missing src", () => {
    expect(cacheBustPath("")).toBe("");
    expect(cacheBustPath(undefined)).toBe("");
  });
});
