import { afterEach, describe, expect, it, vi } from "vitest";
import { synchronizeAppearance, switchSingleToken } from "../scripts/sync-service.mjs";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFoundry(scenes = new Map()) {
  vi.stubGlobal("foundry", {
    utils: { getProperty: (object, path) => path.split(".").reduce((value, key) => value?.[key], object) },
  });
  vi.stubGlobal("game", { scenes, settings: { get: () => "fade" } });
  vi.spyOn(console, "error").mockImplementation(() => {});
}

describe("appearance rollback", () => {
  it.each([
    ["standard", "texture.src"],
    ["ring-subject", "ring.subject.texture"],
  ])("restores other scenes and the prototype after a failed %s rollback", async (artMode, field) => {
    const failure = new Error("initial write failed");
    const scenes = new Map(["s1", "s2", "s3"].map((id) => [id, {
      id,
      tokens: new Set(["t"]),
      updateEmbeddedDocuments: vi.fn().mockResolvedValue([]),
    }]));
    scenes.get("s3").updateEmbeddedDocuments.mockRejectedValueOnce(failure);
    scenes.get("s1").updateEmbeddedDocuments
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("rollback failed"));
    stubFoundry(scenes);
    const actor = {
      prototypeToken: { texture: { src: "prototype.webp" }, ring: { subject: { texture: "prototype.webp" } } },
      getDependentTokens: () => [...scenes.values()].map((scene) => ({
        id: "t", parent: scene,
        texture: { src: `${scene.id}.webp` }, ring: { subject: { texture: `${scene.id}.webp` } },
      })),
      update: vi.fn().mockResolvedValue(undefined),
    };

    await expect(synchronizeAppearance(actor, { artMode, b: { src: "new.webp" } }, "b")).rejects.toBe(failure);

    for (const scene of scenes.values()) {
      expect(scene.updateEmbeddedDocuments).toHaveBeenLastCalledWith(
        "Token", [{ _id: "t", [field]: `${scene.id}.webp` }], { atfInternal: true, animate: false },
      );
    }
    expect(actor.update).toHaveBeenCalledWith(
      { [`prototypeToken.${field}`]: "prototype.webp" }, { atfInternal: true },
    );
    expect(console.error).toHaveBeenCalledWith(expect.any(String), "rollback failed", expect.any(Error));
  });

  it("logs a failed single-token rollback while preserving the original failure", async () => {
    stubFoundry();
    const failure = new Error("initial write failed");
    const token = {
      texture: { src: "old.webp" },
      update: vi.fn().mockRejectedValueOnce(failure).mockRejectedValueOnce(new Error("rollback failed")),
    };

    await expect(switchSingleToken(token, { artMode: "standard", b: { src: "new.webp" } }, "b")).rejects.toBe(failure);

    expect(token.update).toHaveBeenLastCalledWith(
      { "texture.src": "old.webp" }, { atfInternal: true, animate: false },
    );
    expect(console.error).toHaveBeenCalledWith(expect.any(String), "rollback failed", expect.any(Error));
  });
});
