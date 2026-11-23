import { afterEach, describe, expect, it, vi } from "vitest";
import { reconcileToken, synchronizeAppearance, switchSingleToken } from "../scripts/sync-service.mjs";

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
      prototypeToken: {
        name: "Prototype", texture: { src: "prototype.webp" }, ring: { subject: { texture: "prototype.webp" } },
      },
      getDependentTokens: () => [...scenes.values()].map((scene) => ({
        id: "t", parent: scene, name: scene.id,
        texture: { src: `${scene.id}.webp` }, ring: { subject: { texture: `${scene.id}.webp` } },
      })),
      update: vi.fn().mockResolvedValue(undefined),
    };

    const config = { artMode, b: { src: "new.webp", name: "Armored" } };
    await expect(synchronizeAppearance(actor, config, "b")).rejects.toBe(failure);

    for (const scene of scenes.values()) {
      expect(scene.updateEmbeddedDocuments).toHaveBeenLastCalledWith(
        "Token", [{ _id: "t", [field]: `${scene.id}.webp`, name: scene.id }], { atfInternal: true, animate: false },
      );
    }
    expect(actor.update).toHaveBeenCalledWith(
      { [`prototypeToken.${field}`]: "prototype.webp", "prototypeToken.name": "Prototype" }, { atfInternal: true },
    );
    expect(console.error).toHaveBeenCalledWith(expect.any(String), "rollback failed", expect.any(Error));
  });

  it("logs a failed single-token rollback while preserving the original failure", async () => {
    stubFoundry();
    const failure = new Error("initial write failed");
    const token = {
      _source: { name: "Original", ring: { subject: { texture: null } } },
      ring: { subject: { texture: "previous-render.webp" } },
      update: vi.fn().mockRejectedValueOnce(failure).mockRejectedValueOnce(new Error("rollback failed")),
    };

    const config = { artMode: "ring-subject", b: { src: "new.webp", name: "  Armored " } };
    await expect(switchSingleToken(token, config, "b")).rejects.toBe(failure);

    expect(token.update).toHaveBeenNthCalledWith(
      1, { "ring.subject.texture": "new.webp", name: "Armored" }, expect.any(Object),
    );
    expect(token.update).toHaveBeenLastCalledWith(
      { "ring.subject.texture": null, name: "Original" }, { atfInternal: true, animate: false },
    );
    expect(console.error).toHaveBeenCalledWith(expect.any(String), "rollback failed", expect.any(Error));
  });
});

it.each([undefined, "", "  "])("leaves a token's name alone when the configured name is %j", async (name) => {
  stubFoundry();
  const token = { name: "Original", texture: { src: "old.webp" }, update: vi.fn() };
  await switchSingleToken(token, { artMode: "standard", a: { src: "new.webp", name } }, "a");
  expect(token.update).toHaveBeenCalledWith({ "texture.src": "new.webp" }, expect.any(Object));
});

it("reconciles a new linked token's name even when it already has the active image", async () => {
  stubFoundry();
  const actor = { id: "actor", prototypeToken: { texture: { src: "a.webp" } } };
  const config = { enabled: true, artMode: "standard", a: { src: "a.webp", name: "Normal" }, b: { src: "b.webp" } };
  game.settings.get = () => ({ actors: { [actor.id]: config } });
  const token = { actor, isLinked: true, name: "Old", texture: { src: "a.webp" }, update: vi.fn() };

  await reconcileToken(token);
  expect(token.update).toHaveBeenCalledExactlyOnceWith({ name: "Normal" }, { atfInternal: true, animate: false });
});
