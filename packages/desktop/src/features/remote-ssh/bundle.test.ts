import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeRemoteBackendFixture } from "../../../test-utils/remote-backend.js";
import { loadRemoteBackendManifest, selectRemoteBackendBundle } from "./bundle.js";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "omp-remote-bundle-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("remote backend manifest v2", () => {
  it("rejects legacy manifests, unsupported targets, and unpinned or mismatched asset URLs", async () => {
    const fixture = await writeRemoteBackendFixture(directory);
    const manifest = await loadRemoteBackendManifest(directory);
    await expect(selectRemoteBackendBundle(manifest, "win32-x64")).rejects.toThrow("does not support win32-x64");
    await writeFile(path.join(directory, "manifest.json"), JSON.stringify({ ...fixture.manifest, schemaVersion: 1 }));
    await expect(loadRemoteBackendManifest(directory)).rejects.toThrow("Remote backend bundle is unavailable");
    fixture.manifest.targets["linux-x64"].sdk.url = fixture.manifest.targets["darwin-arm64"].sdk.url;
    await writeFile(path.join(directory, "manifest.json"), JSON.stringify(fixture.manifest));
    await expect(loadRemoteBackendManifest(directory)).rejects.toThrow("pinned Release target asset");
  });

  it("verifies the selected target's lock and all common uploads", async () => {
    await writeRemoteBackendFixture(directory);
    const manifest = await loadRemoteBackendManifest(directory);
    await writeFile(path.join(directory, "targets", "darwin-arm64", "package-lock.json"), "corrupt");
    await selectRemoteBackendBundle(manifest, "linux-x64");
    await expect(selectRemoteBackendBundle(manifest, "darwin-arm64")).rejects.toThrow("targets/darwin-arm64/package-lock.json");
    await writeFile(path.join(directory, "packages", "server.tgz"), "corrupt");
    await expect(selectRemoteBackendBundle(manifest, "linux-x64")).rejects.toThrow("packages/server.tgz");
  });
  it("accepts the complete generated workspace bundle and checks both plugin archives", async () => {
    await writeRemoteBackendFixture(directory);
    const manifest = await loadRemoteBackendManifest(directory);
    expect(Object.keys(manifest.files)).toEqual([
      "packages/highlight.tgz",
      "packages/protocol.tgz",
      "packages/relay.tgz",
      "packages/client.tgz",
      "packages/plugin.tgz",
      "packages/qqbot.tgz",
      "packages/server.tgz",
      "packages/cli.tgz",
    ]);
    const bundle = await selectRemoteBackendBundle(manifest, "linux-x64");
    expect(bundle.files.map((file) => file.relativePath)).toEqual(
      expect.arrayContaining(["packages/plugin.tgz", "packages/qqbot.tgz"]),
    );
    for (const name of ["plugin", "qqbot"]) {
      await writeFile(path.join(directory, "packages", `${name}.tgz`), "corrupt");
      await expect(selectRemoteBackendBundle(manifest, "linux-x64")).rejects.toThrow(
        `packages/${name}.tgz`,
      );
      await writeFile(path.join(directory, "packages", `${name}.tgz`), `Workspace package: ${name}`);
    }
  });

});
