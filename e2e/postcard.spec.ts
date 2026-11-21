import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

test("paired photographs and secret-note postcards export at print dimensions", async ({
  page,
}) => {
  const source = await readFile("lib/postcard.ts", "utf8");
  const sourceModule = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const results = await page.evaluate(async (source) => {
    const url = URL.createObjectURL(
      new Blob([source], { type: "text/javascript" }),
    );
    const postcard: typeof import("../lib/postcard") = await import(url);
    URL.revokeObjectURL(url);
    const sample = document.createElement("canvas");
    sample.width = 600;
    sample.height = 200;
    const ctx = sample.getContext("2d")!;
    ctx.fillStyle = "red";
    ctx.fillRect(0, 0, 300, 200);
    ctx.fillStyle = "blue";
    ctx.fillRect(300, 0, 300, 200);
    const media = sample.toDataURL();
    const results = [];
    for (const [index, [layout, spec]] of Object.entries(
      postcard.cardLayouts,
    ).entries()) {
      const settings: import("../lib/postcard").CardSettings = {
        layout,
        frame: postcard.cardFrames[index],
        caption: "Magkalayo man, isang klik lang. ".repeat(6),
        names: ["Zoë", "Iñigo"],
        places: ["Manila", "Cebú"],
        date: "21 Nobyembre",
        stickers: [{ text: "♥", x: 0.1, y: 0.85 }],
        doodles: [
          {
            points: [
              { x: 0.13, y: 0.12 },
              { x: 0.19, y: 0.14 },
            ],
          },
        ],
      };
      const front = await postcard.renderCard(
        Array(spec.shots).fill(media),
        settings,
      );
      const back = await postcard.renderCard([], settings, [
        "Mahal kita,\nsaan ka man.",
        "💞".repeat(160),
      ]);
      const bitmap = await createImageBitmap(
        await postcard.renderDownload(front, back),
      );
      const pixels = front.getContext("2d")!;
      results.push({
        dimensions:
          bitmap.width === spec.width * 2 && bitmap.height === spec.height,
        left: Array.from(pixels.getImageData(80, 100, 1, 1).data),
        right: Array.from(
          pixels.getImageData((spec.width - 110) / spec.columns - 20, 100, 1, 1)
            .data,
        ),
      });
      bitmap.close();
    }
    const front = await postcard.renderCard([], { frame: "Floral" });
    return {
      layouts: results,
      single: (await postcard.renderDownload(front)).type,
    };
  }, sourceModule);
  expect(results.single).toBe("image/png");
  expect(results.layouts).toEqual(
    Array(4).fill({
      dimensions: true,
      left: [255, 0, 0, 255],
      right: [0, 0, 255, 255],
    }),
  );
});
