import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Exercise the actual browser Canvas/WebGL implementations on ordinary synthetic frames.
test("filter identity, distinct grades, reproducible effects and postcard flip", async ({
  page,
}) => {
  await page.route("http://render.test/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/") {
      await route.fulfill({
        contentType: "text/html",
        body: '<script type="importmap">{"imports":{"three":"/three.module.js"}}</script><main>sample</main>',
      });
    } else if (pathname === "/visuals.js" || pathname === "/effects.js") {
      const source = await readFile(
        "lib" + pathname.replace(".js", ".ts"),
        "utf8",
      );
      await route.fulfill({
        contentType: "application/javascript",
        body: ts.transpileModule(source, {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
          },
        }).outputText,
      });
    } else if (["/three.module.js", "/three.core.js"].includes(pathname)) {
      await route.fulfill({
        contentType: "application/javascript",
        path: "node_modules/three/build" + pathname,
      });
    } else await route.abort();
  });
  await page.goto("http://render.test/");
  const results = await page.evaluate(async () => {
    const load = (url: string) => import(url);
    const { drawFrame, filters } = (await load(
      "/visuals.js",
    )) as typeof import("../lib/visuals");
    const { drawEffect, flip, releaseEffects } = (await load(
      "/effects.js",
    )) as typeof import("../lib/effects");
    const src = document.createElement("canvas");
    src.width = 96;
    src.height = 72;
    const ctx = src.getContext("2d")!;
    const chart = ctx.createImageData(96, 72);
    for (let i = 0; i < chart.data.length; i += 4) {
      chart.data.set([i % 251, (i >> 5) % 231, (i >> 2) % 157, 255], i);
    }
    ctx.putImageData(chart, 0, 0);
    const frame = (index: number, strength: number, seed = 7) =>
      drawFrame(src, 96, 72, index, strength, seed, false).toDataURL();
    const distinct = new Set(filters.map((_, i) => frame(i, 100))).size;
    const zero = filters.every((_, i) => frame(i, 0) === frame(0, 100));
    const grain = filters.findIndex((f) => f.id === "grain");
    const seeded =
      frame(grain, 100) === frame(grain, 100) &&
      frame(grain, 100) !== frame(grain, 100, 9);
    const overlay = document.createElement("canvas");
    overlay.width = 200;
    overlay.height = 100;
    const paints: string[] = [];
    const settings = { x: 0.5, y: 0.5, size: 0.35 };
    for (const name of [
      "Off",
      "Shared Heart",
      "Floating Hearts",
      "Starlight",
      "Shared Heart",
    ]) {
      await drawEffect(overlay, { ...settings, name }, 124);
      paints.push(overlay.toDataURL());
    }
    releaseEffects();
    let flips = 0;
    await flip(document.querySelector("main")!, () => {
      flips++;
    });
    return {
      distinct,
      zero,
      seeded,
      effects: new Set(paints).size,
      frozen: paints[1] === paints[4],
      flips,
    };
  });
  expect(results).toEqual({
    distinct: 31,
    zero: true,
    seeded: true,
    effects: 4,
    frozen: true,
    flips: 1,
  });
});
