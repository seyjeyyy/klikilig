import type * as Three from "three";

export interface EffectSettings {
  name: string;
  x: number;
  y: number;
  size: number;
}
type Mark = { x: number; y: number; radius: number; angle: number };
const bounded = (value: number) => Math.min(1, Math.max(0, value));
function marks(
  width: number,
  height: number,
  settings: EffectSettings,
  seed: number,
): Mark[] {
  const size =
    Math.min(width, height) * Math.max(0.045, bounded(settings.size));
  if (settings.name === "Shared Heart") {
    return [
      {
        x: width * bounded(settings.x),
        y: height * bounded(settings.y),
        radius: size,
        angle: 0,
      },
    ];
  }
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const stars = settings.name === "Starlight";
  return Array.from({ length: stars ? 12 : 6 }, (_, index) => {
    const fraction = (index + random()) / (stars ? 12 : 6);
    const edge = 0.035 + 0.06 * random();
    const along = 0.12 + 0.76 * fraction;
    return {
      x: width * (stars ? along : index % 2 ? 1 - edge : edge),
      y: height * (stars ? (index % 2 ? 1 - edge : edge) : along),
      radius: size * (0.1 + 0.16 * random()),
      angle: (random() - 0.5) * 0.56,
    };
  });
}

// Paths share one normalized coordinate system in the Canvas and Three.js renderers.
type Path = Pick<Path2D, "moveTo" | "lineTo" | "bezierCurveTo">;
function shape(path: Path, star: boolean) {
  if (star) {
    for (let i = 0; i <= 10; i++) {
      const angle = (i * Math.PI) / 5 - Math.PI / 2,
        r = i % 2 ? 0.4 : 1;
      if (i === 0) path.moveTo(0, -1);
      else path.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
    }
  } else {
    path.moveTo(0, 0.88);
    path.bezierCurveTo(-0.23, 0.6, -1, 0.17, -1, -0.35);
    path.bezierCurveTo(-1, -0.96, -0.3, -1.09, 0, -0.6);
    path.bezierCurveTo(0.3, -1.09, 1, -0.96, 1, -0.35);
    path.bezierCurveTo(1, 0.17, 0.23, 0.6, 0, 0.88);
  }
}
function fallback(
  ctx: CanvasRenderingContext2D,
  positions: Mark[],
  star: boolean,
  hollow: boolean,
) {
  const outline = new Path2D();
  shape(outline, star);
  for (const mark of positions) {
    ctx.save();
    ctx.translate(mark.x, mark.y);
    ctx.scale(mark.radius, mark.radius);
    ctx.rotate(mark.angle);
    ctx.strokeStyle = "#bc2842";
    ctx.fillStyle = star ? "#deac50" : "#c64860";
    ctx.lineJoin = "round";
    ctx.lineWidth = 0.07;
    if (hollow) ctx.stroke(outline);
    else ctx.fill(outline);
    ctx.restore();
  }
}
let renderer: Three.WebGLRenderer | undefined;
let fallbackOnly = false;
export function releaseEffects() {
  renderer?.dispose();
  renderer?.forceContextLoss();
  renderer = undefined;
  if (typeof window !== "undefined")
    window.removeEventListener("pagehide", releaseEffects);
}
const renderTickets = new WeakMap<HTMLCanvasElement, number>();

/** Draw a transparent overlay over the whole paired photo. Seed with the frozen shot ID. */
export async function drawEffect(
  canvas: HTMLCanvasElement,
  settings: EffectSettings,
  seed: number,
) {
  const ticket = (renderTickets.get(canvas) ?? 0) + 1;
  renderTickets.set(canvas, ticket);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  if (
    !["Shared Heart", "Floating Hearts", "Starlight"].includes(settings.name) ||
    !width ||
    !height
  )
    return;
  const positions = marks(width, height, settings, seed);
  const star = settings.name === "Starlight",
    hollow = settings.name === "Shared Heart";
  if (fallbackOnly) return fallback(ctx, positions, star, hollow);
  let geometry: Three.BufferGeometry | undefined,
    material: Three.Material | undefined;
  try {
    const T = await import("three");
    if (renderTickets.get(canvas) !== ticket) return;
    if (!renderer) {
      renderer = new T.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "low-power",
      });
      renderer.setClearColor(0, 0);
      window.addEventListener("pagehide", releaseEffects, { once: true });
    }
    renderer.setSize(width, height, false);
    const scene = new T.Scene();
    const camera = new T.OrthographicCamera(
      0,
      width,
      height,
      0,
      0.1,
      width * 4 + height * 4,
    );
    camera.position.z = width + height;
    const outline = new T.Shape();
    shape(outline, star);
    const points = outline.getPoints(24);
    geometry = hollow
      ? new T.TubeGeometry(
          new T.CatmullRomCurve3(
            points.slice(0, -1).map((p) => new T.Vector3(p.x, -p.y, 0)),
            true,
          ),
          112,
          0.038,
          6,
          true,
        )
      : new T.ExtrudeGeometry(outline, {
          depth: 0.18,
          bevelEnabled: true,
          bevelSegments: 2,
          steps: 1,
          bevelSize: 0.05,
          bevelThickness: 0.06,
        });
    material = new T.MeshStandardMaterial({
      color: star ? 0xffc55b : 0xc62c4c,
      metalness: 0.16,
      roughness: 0.43,
      side: T.DoubleSide,
    });
    scene.add(new T.AmbientLight(0xffffff, 1.7));
    const light = new T.DirectionalLight(0xfff1e0, 2.4);
    light.position.set(-1, 1, 2);
    scene.add(light);
    for (const mark of positions) {
      const mesh = new T.Mesh(geometry, material);
      mesh.scale.set(
        mark.radius,
        hollow ? mark.radius : -mark.radius,
        mark.radius,
      );
      mesh.position.set(mark.x, height - mark.y, 0);
      mesh.rotation.set(0, hollow ? 0 : 0.14, -mark.angle);
      scene.add(mesh);
    }
    renderer.render(scene, camera);
    ctx.drawImage(renderer.domElement, 0, 0);
  } catch {
    if (renderTickets.get(canvas) !== ticket) return;
    fallbackOnly = true;
    releaseEffects();
    fallback(ctx, positions, star, hollow);
  } finally {
    geometry?.dispose();
    material?.dispose();
  }
}

/** Three.js drives the card's perspective matrix while the accessible DOM stays interactive. */
export async function flip(element: HTMLElement, swap: () => void) {
  if (
    document.documentElement.classList.contains("reduced-motion") ||
    !element.animate ||
    !window.WebGLRenderingContext ||
    matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    swap();
    return;
  }
  let swapped = false;
  const changeFace = () => {
    if (!swapped) {
      swapped = true;
      swap();
    }
  };
  try {
    const { Matrix4 } = await import("three");
    const edge = (angle: number) =>
      "perspective(1000px) matrix3d(" +
      new Matrix4().makeRotationY(angle).toArray().join(",") +
      ")";
    await element.animate(
      [{ transform: edge(0) }, { transform: edge(Math.PI / 2) }],
      { duration: 180, easing: "ease-in" },
    ).finished;
    changeFace();
    await element.animate(
      [{ transform: edge(-Math.PI / 2) }, { transform: edge(0) }],
      { duration: 180, easing: "ease-out" },
    ).finished;
  } catch {
    changeFace();
  }
}
