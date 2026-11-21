/** The editor stores decorations relative to the entire front face. */
export type CardPoint = { x: number; y: number };
export type CardSettings = {
  layout?: string;
  frame?: string;
  names?: [string, string];
  places?: [string, string];
  caption?: string;
  date?: string;
  stickers?: (CardPoint & { text: string; size?: number })[];
  doodles?: { points: CardPoint[]; color?: string; width?: number }[];
};

export const cardLayouts = {
  "3-shot strip": { width: 1200, height: 2220, shots: 3, columns: 1 },
  "4-shot strip": { width: 1200, height: 2810, shots: 4, columns: 1 },
  Polaroid: { width: 1200, height: 1400, shots: 1, columns: 1 },
  "Square collage": { width: 1600, height: 1600, shots: 4, columns: 2 },
} as const;

export const cardFrames = [
  "Cream",
  "Film border",
  "Lace",
  "Gingham",
  "Floral",
] as const;
const cherry = "#b31936";
const ink = "#431820";
const paper = "#fff8ef";
const serif = '"DM Serif Text", Georgia, serif';
const sans = '"DM Sans", Arial, sans-serif';
const script = "Caveat, cursive";
const bounded = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
type Ctx = CanvasRenderingContext2D;
type Box = { x: number; y: number; w: number; h: number };

function surface(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("This browser could not open the postcard canvas.");
  return { canvas, ctx };
}

function textLines(ctx: Ctx, value: string, width: number): string[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const lines: string[] = [];
  for (const paragraph of value.replace(/\r\n?/g, "\n").split("\n")) {
    let line = "";
    for (const token of paragraph.split(/(\s+)/u)) {
      if (!token) continue;
      if (line && ctx.measureText(line + token).width > width) {
        lines.push(line.trimEnd());
        line = "";
      }
      if (ctx.measureText(token).width > width) {
        for (const { segment } of segmenter.segment(token)) {
          if (line && ctx.measureText(line + segment).width > width) {
            lines.push(line);
            line = "";
          }
          line += segment;
        }
      } else if (line || token.trim()) line += token;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

/** Fit once using pixel-based measurements, including explicit blank lines. */
function write(
  ctx: Ctx,
  text: string,
  box: Box,
  family: string,
  size: number,
  center = false,
) {
  if (!text) return;
  let lines: string[] = [];
  do {
    ctx.font = size + "px " + family;
    lines = textLines(ctx, text, box.w);
    if (lines.length * size * 1.25 <= box.h || size <= 2) break;
    size = Math.max(
      2,
      Math.min(size - 1, Math.floor(box.h / (lines.length * 1.25))),
    );
  } while (true);
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  ctx.textAlign = center ? "center" : "left";
  ctx.textBaseline = "top";
  lines.forEach((line, index) =>
    ctx.fillText(
      line,
      box.x + (center ? box.w / 2 : 0),
      box.y + index * size * 1.25,
    ),
  );
  ctx.restore();
}

function daisy(ctx: Ctx, x: number, y: number, size: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "#e7a8ae";
  for (let i = 0; i < 6; i++) {
    ctx.rotate(Math.PI / 3);
    ctx.beginPath();
    ctx.ellipse(0, -size * 0.55, size * 0.31, size * 0.56, 0, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.fillStyle = "#a34f28";
  ctx.arc(0, 0, size / 4, 0, 2 * Math.PI);
  ctx.fill();
  ctx.restore();
}

function framePaper(ctx: Ctx, frame: string, w: number, h: number) {
  ctx.fillStyle = frame === "film border" ? "#292221" : paper;
  ctx.fillRect(0, 0, w, h);
  if (frame === "gingham") {
    ctx.fillStyle = "rgba(179,25,54,.15)";
    for (let x = 0; x < w; x += 50) ctx.fillRect(x, 0, 25, h);
    for (let y = 0; y < h; y += 50) ctx.fillRect(0, y, w, 25);
    ctx.fillStyle = paper;
    ctx.fillRect(33, 33, w - 66, h - 66);
  }
  if (frame === "film border") {
    ctx.fillStyle = paper;
    for (let y = 34; y < h - 30; y += 49) {
      for (const x of [12, w - 31]) {
        ctx.beginPath();
        ctx.roundRect(x, y, 19, 28, 4);
        ctx.fill();
      }
    }
  }
  for (const x of [17, w - 17]) {
    if (frame === "floral")
      for (let y = 32; y < h - 24; y += 79) daisy(ctx, x, y, 14);
    if (frame === "lace") {
      ctx.strokeStyle = "#c99396";
      ctx.lineWidth = 2;
      for (let y = 13; y < h - 13; y += 26) {
        ctx.beginPath();
        ctx.arc(x, y, 14, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, 2 * Math.PI);
        ctx.stroke();
      }
    }
  }
}

async function loadPair(url: string) {
  if (!/^data:image\/(?:jpeg|png|webp);base64,/i.test(url))
    throw new Error("A captured image is unavailable.");
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

/** Cover-crop each seat independently about its center, preserving the seam. */
function pair(ctx: Ctx, image: HTMLImageElement, box: Box) {
  const sw = image.naturalWidth / 2;
  const sh = image.naturalHeight;
  const half = box.w / 2;
  const scale = Math.max(half / sw, box.h / sh);
  const cw = half / scale;
  const ch = box.h / scale;
  for (const seat of [0, 1]) {
    ctx.drawImage(
      image,
      seat * sw + (sw - cw) / 2,
      (sh - ch) / 2,
      cw,
      ch,
      box.x + seat * half,
      box.y,
      half,
      box.h,
    );
  }
}

function postmark(ctx: Ctx, x: number, y: number, radius: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.15);
  ctx.strokeStyle = cherry;
  ctx.fillStyle = cherry;
  ctx.lineWidth = 3;
  for (const r of [radius, radius - 7]) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.font = "45px " + serif;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("♥", 0, -12);
  ctx.font = "16px " + sans;
  ctx.fillText("KLIKILIG", 0, 24);
  ctx.restore();
}

function reverse(
  ctx: Ctx,
  w: number,
  h: number,
  s: CardSettings,
  notes: [string, string],
) {
  const pad = w * 0.085;
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#dab6af";
  ctx.lineWidth = 3;
  ctx.strokeRect(30, 30, w - 60, h - 60);
  ctx.fillStyle = cherry;
  write(ctx, "Postcard", { x: pad, y: pad, w: w * 0.65, h: 150 }, serif, 90);
  postmark(ctx, w - pad - 42, pad + 37, 63);
  const top = pad + 180;
  const band = (h - top - pad - 60) / 2;
  notes.forEach((note, i) => {
    const y = top + i * band;
    ctx.strokeStyle = "#dab6af";
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(w - pad, y);
    ctx.stroke();
    ctx.fillStyle = ink;
    write(
      ctx,
      note,
      { x: pad, y: y + 42, w: w - 2 * pad, h: band - 158 },
      script,
      60,
    );
    ctx.fillStyle = cherry;
    write(
      ctx,
      s.names?.[i] || (i ? "Guest" : "Host"),
      { x: pad, y: y + band - 102, w: w - pad * 2, h: 84 },
      serif,
      42,
    );
  });
  ctx.fillStyle = ink;
  write(
    ctx,
    [s.places?.filter(Boolean).join("  ·  "), s.date]
      .filter(Boolean)
      .join("   /   "),
    { x: pad, y: h - pad, w: w - 2 * pad, h: 63 },
    sans,
    29,
  );
}

export async function renderCard(
  pairs: string[],
  settings: CardSettings,
  notes?: [string, string],
): Promise<HTMLCanvasElement> {
  await Promise.all(
    [serif, sans, script].map((family) =>
      document.fonts.load("32px " + family),
    ),
  );
  await document.fonts.ready;
  const key =
    settings.layout && Object.hasOwn(cardLayouts, settings.layout)
      ? (settings.layout as keyof typeof cardLayouts)
      : "3-shot strip";
  const { width: w, height: h, shots, columns } = cardLayouts[key];
  const { canvas, ctx } = surface(w, h);
  if (notes) {
    reverse(ctx, w, h, settings, notes);
    return canvas;
  }
  const frame = (settings.frame || "Cream").toLowerCase();
  framePaper(ctx, frame, w, h);
  const margin = 55;
  const gap = 20;
  const rows = Math.ceil(shots / columns);
  const footer = key === "Polaroid" ? 365 : 324;
  const cellW = (w - margin * 2 - (columns - 1) * gap) / columns;
  const cellH = (h - margin - footer - (rows - 1) * gap) / rows;
  const images = await Promise.all(
    Array.from({ length: shots }, (_, i) =>
      pairs[i] ? loadPair(pairs[i]) : null,
    ),
  );
  images.forEach((image, i) => {
    const box = {
      x: margin + (i % columns) * (cellW + gap),
      y: margin + Math.floor(i / columns) * (cellH + gap),
      w: cellW,
      h: cellH,
    };
    if (image) pair(ctx, image, box);
    else {
      ctx.fillStyle = "#eadad5";
      ctx.fillRect(box.x, box.y, box.w, box.h);
    }
  });
  const bottom = h - footer + 32;
  ctx.fillStyle = frame === "film border" ? paper : cherry;
  write(
    ctx,
    settings.caption || "Klikilig",
    { x: margin, y: bottom, w: w - 2 * margin, h: 130 },
    serif,
    66,
    true,
  );
  ctx.fillStyle = frame === "film border" ? paper : ink;
  write(
    ctx,
    settings.names?.filter(Boolean).join("  &  ") || "",
    { x: margin, y: bottom + 131, w: w - 2 * margin, h: 65 },
    script,
    51,
    true,
  );
  write(
    ctx,
    [settings.places?.filter(Boolean).join("  ·  "), settings.date]
      .filter(Boolean)
      .join("   /   "),
    { x: margin, y: bottom + 211, w: w - 2 * margin, h: footer - 269 },
    sans,
    30,
    true,
  );
  for (const stroke of settings.doodles || []) {
    if (!stroke.points.length) continue;
    ctx.strokeStyle = stroke.color || cherry;
    ctx.lineWidth = w * bounded(stroke.width ?? 0.005, 0.001, 0.08);
    ctx.lineJoin = ctx.lineCap = "round";
    ctx.beginPath();
    stroke.points.forEach(({ x, y }, i) => {
      if (!i) ctx.moveTo(bounded(x, 0, 1) * w, bounded(y, 0, 1) * h);
      ctx.lineTo(bounded(x, 0, 1) * w + 0.01, bounded(y, 0, 1) * h);
    });
    ctx.stroke();
  }
  for (const sticker of settings.stickers || []) {
    ctx.fillStyle = cherry;
    ctx.font = w * bounded(sticker.size ?? 0.08, 0.01, 0.5) + "px " + sans;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      sticker.text,
      bounded(sticker.x, 0, 1) * w,
      bounded(sticker.y, 0, 1) * h,
    );
  }
  return canvas;
}

export async function renderDownload(
  front: HTMLCanvasElement,
  back?: HTMLCanvasElement,
): Promise<Blob> {
  let out = front;
  if (back) {
    if (front.width !== back.width || front.height !== back.height)
      throw new Error("The postcard faces must have matching dimensions.");
    const { canvas, ctx } = surface(front.width * 2, front.height);
    ctx.drawImage(front, 0, 0);
    ctx.drawImage(back, front.width, 0);
    out = canvas;
  }
  return new Promise((resolve, reject) =>
    out.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("The postcard could not be encoded.")),
      "image/png",
    ),
  );
}
