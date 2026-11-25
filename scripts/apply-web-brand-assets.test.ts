import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { applyWebBrandAssets } from "./apply-web-brand-assets.ts";
import { WHISK_ASSET_PATHS } from "./lib/brand-assets.ts";

const WHISK_WEB_ICONS = {
  "apple-touch-icon.png": WHISK_ASSET_PATHS.webAppleTouchIconPng,
  "favicon-16x16.png": WHISK_ASSET_PATHS.webFavicon16Png,
  "favicon-32x32.png": WHISK_ASSET_PATHS.webFavicon32Png,
  "favicon.ico": WHISK_ASSET_PATHS.webFaviconIco,
  "icon-192x192.png": WHISK_ASSET_PATHS.webIcon192Png,
  "icon-512x512.png": WHISK_ASSET_PATHS.webIcon512Png,
};
const WEB_ICON_FILENAMES = Object.keys(WHISK_WEB_ICONS);

it.layer(NodeServices.layer)("apply-web-brand-assets", (it) => {
  it.effect.each(["production", "nightly"] as const)(
    "copies the Whisk icons for %s into the target directory",
    (brand) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const repoRoot = yield* path.fromFileUrl(new URL("..", import.meta.url));
        const targetDirectory = yield* fs.makeTempDirectoryScoped({
          prefix: "apply-web-brand-assets-",
        });

        yield* applyWebBrandAssets(brand, targetDirectory);

        assert.deepStrictEqual(
          (yield* fs.readDirectory(targetDirectory)).toSorted(),
          WEB_ICON_FILENAMES,
        );
        for (const [filename, source] of Object.entries(WHISK_WEB_ICONS)) {
          assert.deepEqual(
            yield* fs.readFile(path.join(targetDirectory, filename)),
            yield* fs.readFile(path.join(repoRoot, source)),
          );
        }
      }),
  );

  it.effect("resolves an empty target directory to the repo root", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const repoRoot = yield* path.fromFileUrl(new URL("..", import.meta.url));
      const destinations = WEB_ICON_FILENAMES.map((filename) => path.join(repoRoot, filename));
      // readDirectory does not follow symlinks, so a dangling link counts as an existing entry.
      // Names are lowercased so a case-insensitive filesystem cannot hide a differently cased file.
      const existingEntries = new Set(
        (yield* fs.readDirectory(repoRoot)).map((entry) => entry.toLowerCase()),
      );
      for (const destination of destinations) {
        assert.isFalse(
          existingEntries.has(path.basename(destination)),
          `${destination} already exists`,
        );
      }
      yield* Effect.addFinalizer(() =>
        Effect.forEach(destinations, (destination) => fs.remove(destination, { force: true })).pipe(
          Effect.orDie,
        ),
      );

      yield* applyWebBrandAssets("production", "");

      for (const destination of destinations) {
        assert.isTrue(yield* fs.exists(destination));
      }
    }),
  );
});
