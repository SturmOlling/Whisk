import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { vi } from "vite-plus/test";

import * as DesktopConfig from "./DesktopConfig.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopLegacyLocalStorage from "./DesktopLegacyLocalStorage.ts";

vi.mock("electron", () => ({}));

it.effect("ignores V1 Local Storage in t3code and T3 Code (Alpha)", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const appDataDirectory = yield* fs.makeTempDirectoryScoped({ prefix: "whisk-local-storage-" });
    for (const name of ["t3code", "T3 Code (Alpha)"]) {
      const leveldb = path.join(appDataDirectory, name, "Local Storage", "leveldb");
      yield* fs.makeDirectory(leveldb, { recursive: true });
      yield* fs.writeFileString(path.join(leveldb, "000001.log"), "old local storage");
    }
    const userDataPath = path.join(appDataDirectory, "whisk-desktop");
    yield* fs.makeDirectory(userDataPath);
    const readDirectory = vi.fn(fs.readDirectory);
    const environment = DesktopEnvironment.layer({
      dirname: "/install/resources/app.asar/dist-electron",
      homeDirectory: appDataDirectory,
      platform: "linux",
      processArch: "x64",
      appVersion: "1.0.0",
      appPath: "/install/resources/app.asar",
      isPackaged: true,
      resourcesPath: "/install/resources",
      runningUnderArm64Translation: false,
    }).pipe(Layer.provide(DesktopConfig.layerTest({ XDG_CONFIG_HOME: appDataDirectory })));
    const localStorage = DesktopLegacyLocalStorage.layer.pipe(
      Layer.provide(environment),
      Layer.provide(Layer.succeed(FileSystem.FileSystem, { ...fs, readDirectory })),
    );

    yield* Effect.gen(function* () {
      const storage = yield* DesktopLegacyLocalStorage.DesktopLegacyLocalStorage;
      yield* storage.load(userDataPath);
      assert.isTrue(Option.isNone(yield* storage.take));
    }).pipe(Effect.provide(localStorage));

    assert.deepEqual(readDirectory.mock.calls, []);
  }).pipe(Effect.provide(NodeServices.layer)),
);
