import { expect, it } from "vite-plus/test";
import { DESKTOP_RENDERER_ORIGINS } from "./httpCors.ts";

it("allows only Whisk's packaged and development renderer origins as desktop origins", () => {
  expect(DESKTOP_RENDERER_ORIGINS).toEqual(["whisk://app", "whisk-dev://app"]);
});
