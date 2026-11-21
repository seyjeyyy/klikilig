type Grade = {
  mono?: number;
  saturation?: number;
  contrast?: number;
  lift?: number;
  tint?: readonly [number, number, number];
  grain?: number;
};
const grades: Record<string, Grade> = {
  Original: {},
  Rose: { saturation: 0.86, tint: [16, -3, 5], lift: 4 },
  Peach: { contrast: 0.94, tint: [18, 5, -9], lift: 6 },
  Lavender: { saturation: 0.82, tint: [9, -4, 21] },
  Cream: { contrast: 0.83, tint: [10, 7, -5], lift: 12 },
  Dreamy: { contrast: 0.72, saturation: 0.7, lift: 19 },
  "Golden Hour": { saturation: 1.15, tint: [25, 8, -21] },
  "Film 90": { contrast: 1.12, saturation: 0.72, tint: [5, 7, -7], grain: 8 },
  Disposable: {
    contrast: 1.22,
    saturation: 1.2,
    tint: [7, 10, -14],
    grain: 13,
  },
  Polaroid: { contrast: 0.88, saturation: 0.76, tint: [11, 0, -10], lift: 9 },
  Sepia: { mono: 1, tint: [29, 10, -21] },
  Faded: { contrast: 0.61, saturation: 0.67, lift: 12 },
  Cinema: { contrast: 1.25, saturation: 0.71, tint: [-10, 4, 11] },
  "Classic Mono": { mono: 1 },
  Noir: { mono: 1, contrast: 1.64, lift: -18 },
  "Soft Gray": { mono: 1, contrast: 0.79, lift: 8 },
  Silver: { mono: 1, contrast: 1.17, tint: [-3, 1, 7], lift: 8 },
  Matte: { mono: 1, contrast: 0.66, lift: 9 },
  "High Contrast": { mono: 1, contrast: 1.98 },
  Sakura: { saturation: 0.68, tint: [24, -7, 13], lift: 11 },
  Sunset: { contrast: 1.09, tint: [31, -4, -11] },
  Ocean: { tint: [-20, 8, 27], saturation: 0.83 },
  Mint: { contrast: 0.91, tint: [-13, 19, 6], lift: 5 },
  Berry: { contrast: 1.09, tint: [18, -17, 17] },
  Neon: { contrast: 1.22, saturation: 1.79, tint: [8, -4, 15] },
  VHS: { saturation: 0.69, contrast: 0.91, grain: 7 },
  Grain: { grain: 34 },
  Duotone: {},
  Pixel: {},
  Fisheye: {},
  "Light Leak": {},
};
const groups = [
  ["Original", ["Original"]],
  [
    "Soft & romantic",
    ["Rose", "Peach", "Lavender", "Cream", "Dreamy", "Golden Hour"],
  ],
  [
    "Vintage film",
    ["Film 90", "Disposable", "Polaroid", "Sepia", "Faded", "Cinema"],
  ],
  [
    "Black & white",
    ["Classic Mono", "Noir", "Soft Gray", "Silver", "Matte", "High Contrast"],
  ],
  ["Color & mood", ["Sakura", "Sunset", "Ocean", "Mint", "Berry", "Neon"]],
  [
    "Creative effects",
    ["VHS", "Grain", "Duotone", "Pixel", "Fisheye", "Light Leak"],
  ],
] as const;
export const filters = groups.flatMap(([category, labels]) =>
  labels.map((label) => ({
    id: label.toLowerCase().replaceAll(" ", "-"),
    label,
    category,
  })),
);
export const FILTERS = filters;

function sourceSize(source: CanvasImageSource) {
  if ("videoWidth" in source) return [source.videoWidth, source.videoHeight];
  if ("naturalWidth" in source)
    return [source.naturalWidth, source.naturalHeight];
  if ("displayWidth" in source)
    return [source.displayWidth, source.displayHeight];
  if (typeof source.width === "number")
    return [source.width, Number(source.height)];
  return [
    source.width.baseVal.value,
    (source.height as SVGAnimatedLength).baseVal.value,
  ];
}
const clampByte = (value: number) => Math.max(0, Math.min(255, value));

/** Cover-crop once, mirror once, then blend the graded pixels against the original. */
export function drawFrame(
  source: CanvasImageSource,
  width: number,
  height: number,
  style: number,
  strength: number,
  seed: number,
  mirror: boolean,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const [sw, sh] = sourceSize(source);
  if (!sw || !sh) return canvas;
  const scale = Math.max(width / sw, height / sh);
  if (mirror) ctx.setTransform(-1, 0, 0, 1, width, 0);
  ctx.drawImage(
    source,
    (width - sw * scale) / 2,
    (height - sh * scale) / 2,
    sw * scale,
    sh * scale,
  );
  const label = filters[style]?.label ?? "Original";
  const mix = Math.max(0, Math.min(1, strength / 100));
  if (label === "Original" || !mix) return canvas;
  const {
    mono,
    saturation = 1,
    contrast = 1,
    lift = 0,
    tint = [0, 0, 0],
    grain = 0,
  } = grades[label];
  const original = ctx.getImageData(0, 0, width, height).data;
  const output = ctx.createImageData(width, height);
  const data = output.data;
  const block = Math.max(2, Math.round(Math.min(width, height) / 44));
  let state = seed >>> 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = 4 * (width * y + x);
      let sample = i;
      if (label === "Pixel") {
        sample =
          4 *
          (width * Math.min(height - 1, y - (y % block) + (block >> 1)) +
            Math.min(width - 1, x - (x % block) + (block >> 1)));
      } else if (label === "Fisheye") {
        const nx = ((x + 0.5) / width) * 2 - 1,
          ny = ((y + 0.5) / height) * 2 - 1;
        const radius = Math.min(1, Math.hypot(nx, ny));
        const warp = 0.53 + 0.47 * radius * radius;
        const sx = Math.min(
          width - 1,
          Math.floor(((1 + nx * warp) * width) / 2),
        );
        const sy = Math.min(
          height - 1,
          Math.floor(((1 + ny * warp) * height) / 2),
        );
        sample = 4 * (sy * width + sx);
      }
      let r = original[sample],
        g = original[sample + 1],
        b = original[sample + 2];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const sat = mono ? 0 : saturation;
      let adjustment = lift;
      if (grain) {
        state = (Math.imul(1664525, state) + 1013904223) >>> 0;
        adjustment += (state / 4294967296 - 0.5) * grain * 2;
      }
      if (label === "VHS") {
        r = original[Math.max(y * width * 4, sample - 8)];
        if (y % 4 === 0) adjustment -= 17;
      }
      r =
        (luma + (r - luma) * sat - 128) * contrast + 128 + adjustment + tint[0];
      g =
        (luma + (g - luma) * sat - 128) * contrast + 128 + adjustment + tint[1];
      b =
        (luma + (b - luma) * sat - 128) * contrast + 128 + adjustment + tint[2];
      if (label === "Duotone") {
        r = 45 + 0.82 * luma;
        g = 17 + 0.77 * luma;
        b = 73 + 0.39 * luma;
      } else if (label === "Light Leak") {
        const wash =
          0.85 * Math.pow(1 - x / width, 3) * (1 - (0.55 * y) / height);
        r += (255 - r) * wash;
        g += (181 - g) * wash;
        b += (91 - b) * wash;
      }
      data[i] = original[i] + mix * (clampByte(r) - original[i]);
      data[i + 1] = original[i + 1] + mix * (clampByte(g) - original[i + 1]);
      data[i + 2] = original[i + 2] + mix * (clampByte(b) - original[i + 2]);
      data[i + 3] = original[i + 3];
    }
  }
  ctx.putImageData(output, 0, 0);
  return canvas;
}
