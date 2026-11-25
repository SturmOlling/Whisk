import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopConfig from "./DesktopConfig.ts";

const defaultInput = {
  dirname: "/repo/apps/desktop/dist-electron",
  homeDirectory: "/Users/alice",
  platform: "darwin",
  processArch: "arm64",
  appVersion: "0.0.22",
  appPath: "/Applications/Whisk.app/Contents/Resources/app.asar",
  isPackaged: false,
  resourcesPath: "/Applications/Whisk.app/Contents/Resources",
  runningUnderArm64Translation: false,
} satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

const layerEnvironment = (
  overrides: Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> = {},
  env: Record<string, string | undefined> = {},
) =>
  DesktopEnvironment.layer({
    ...defaultInput,
    ...overrides,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(NodeServices.layer, NodePath.layerPosix, DesktopConfig.layerTest(env)),
    ),
  );

const makeEnvironment = (
  overrides: Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> = {},
  env: Record<string, string | undefined> = {},
) => DesktopEnvironment.DesktopEnvironment.pipe(Effect.provide(layerEnvironment(overrides, env)));

describe("DesktopEnvironment", () => {
  it.effect("uses the packaged Windows server sidecar as the backend root", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment({
        platform: "win32",
        isPackaged: true,
        appPath: "/install/resources/app.asar",
        resourcesPath: "/install/resources",
      });

      assert.equal(environment.appRoot, "/install/resources/app.asar");
      assert.equal(environment.serverRoot, "/install/resources/server.asar");
      assert.equal(
        environment.backendEntryPath,
        "/install/resources/server.asar/apps/server/dist/bin.mjs",
      );
      assert.equal(
        environment.clientAssetsDir,
        "/install/resources/server.asar/apps/server/dist/client",
      );
    }),
  );

  it.effect("keeps implicit development state separate from production state", () =>
    Effect.gen(function* () {
      const development = yield* makeEnvironment(
        {},
        { VITE_DEV_SERVER_URL: "http://localhost:5173" },
      );
      const production = yield* makeEnvironment(
        { isPackaged: true },
        { T3CODE_HOME: "/upstream/home" },
      );

      assert.equal(development.stateDir, "/Users/alice/.whisk-app/dev");
      assert.equal(production.stateDir, "/Users/alice/.whisk-app/userdata");
      assert.equal(development.displayName, "Whisk (Dev)");
      assert.equal(production.displayName, "Whisk");
      assert.equal(development.appUserModelId, "io.github.sturmolling.whisk.dev");
      assert.equal(production.appUserModelId, "io.github.sturmolling.whisk");
      assert.equal(
        development.linuxDesktopEntryName,
        "io.github.sturmolling.whisk.Development.desktop",
      );
      assert.equal(production.linuxDesktopEntryName, "io.github.sturmolling.whisk.desktop");
    }),
  );

  it.effect("uses WHISK_HOME for packaged apps and T3CODE_HOME for Vite development", () =>
    Effect.gen(function* () {
      const homes = { WHISK_HOME: "/whisk/home", T3CODE_HOME: "/development/home" };
      const production = yield* makeEnvironment({ isPackaged: true }, homes);
      const development = yield* makeEnvironment(
        {},
        { ...homes, VITE_DEV_SERVER_URL: "http://localhost:5173" },
      );

      assert.equal(production.baseDir, "/whisk/home");
      assert.equal(production.stateDir, "/whisk/home/userdata");
      assert.equal(development.baseDir, "/development/home");
      assert.equal(development.stateDir, "/development/home/userdata");
    }),
  );
});
