/**
 * Renders presto.build's link preview from one seek-driven scene (og-landing.html):
 * og-image.png is the frame at t=0, so Discord's poster frame and the video's first frame match.
 *
 *   bun scripts/og-landing.ts                       # write landing/public/og-image.png + og-video.mp4
 *   bun scripts/og-landing.ts --sheet out.png [n]   # n frames tiled at 400 px, Discord's embed width
 *   bun scripts/og-landing.ts --stills 0,3.5 [dir]  # full-size frames
 *
 * Like the og cards, output depends on the machine's Chromium and is pinned by the sha256 manifest.
 */
import { join, resolve, sep } from "node:path";
import type { Page } from "@playwright/test";

const PKG_DIR = resolve(import.meta.dir, "..");
const PUBLIC_DIR = resolve(PKG_DIR, "..", "landing", "public");
const W = 1200;
const H = 630;
const FPS = 60;
// Sub-frames averaged per output frame: real motion blur on the fast Presto bar.
const SUB = 4;
const SHUTTER = 0.6;

interface Scene {
  page: Page;
  duration: number;
  seek: (t: number) => Promise<void>;
  errors: string[];
}

/** Serves only the presto package dir; the scene may load nothing else. */
function serve() {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (req) => {
      const abs = resolve(PKG_DIR, `.${decodeURIComponent(new URL(req.url).pathname)}`);
      if (!abs.startsWith(PKG_DIR + sep)) return new Response("outside", { status: 403 });
      const file = Bun.file(abs);
      return (await file.exists()) ? new Response(file) : new Response("missing", { status: 404 });
    },
  });
}

async function withScene<T>(scale: number, run: (scene: Scene) => Promise<T>): Promise<T> {
  const server = serve();
  const origin = `http://127.0.0.1:${server.port}`;
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ headless: true, args: ["--font-render-hinting=none"] });
  const errors: string[] = [];
  try {
    const page = await browser.newPage({
      viewport: { width: W, height: H },
      deviceScaleFactor: scale,
    });
    await page.route("**/*", (route) => {
      if (route.request().url().startsWith(origin)) return route.continue();
      errors.push(`refused ${route.request().url()}`);
      return route.abort();
    });
    page.on("pageerror", (e) => errors.push(`pageerror ${e.message}`));
    page.on("response", (r) => r.status() >= 400 && errors.push(`HTTP ${r.status()} ${r.url()}`));
    await page.goto(`${origin}/scripts/og-landing.html`);
    await page.waitForFunction(() => (globalThis as { ready?: boolean }).ready === true, null, {
      timeout: 20_000,
    });
    const duration = await page.evaluate(() => (globalThis as { DURATION?: number }).DURATION ?? 0);
    const seek = (t: number) =>
      page.evaluate((x) => (globalThis as { seek?: (t: number) => void }).seek?.(x), t);
    const result = await run({ page, duration, seek, errors });
    if (errors.length) throw new Error(`scene errors:\n${errors.join("\n")}`);
    return result;
  } finally {
    await browser.close();
    server.stop(true);
  }
}

function ffmpeg(args: string[]) {
  return Bun.spawn(["ffmpeg", "-y", "-loglevel", "error", ...args], {
    stdin: "pipe",
    stdout: "inherit",
    stderr: "inherit",
  });
}

async function finish(proc: ReturnType<typeof ffmpeg>): Promise<void> {
  proc.stdin.end();
  const code = await proc.exited;
  if (code !== 0) throw new Error(`ffmpeg exited ${code}`);
}

// Chromium hands over sRGB pixels; swscale's default RGB→YUV matrix is BT.601 with no tag, which
// players read as BT.709 and shift the brand blue. Convert to BT.709 explicitly and tag it.
const H264 = `-c:v libx264 -profile:v high -preset veryslow -tune animation -crf 18 -g ${FPS * 2}
  -r ${FPS} -color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv
  -movflags +faststart -an`.split(/\s+/);

async function writeVideo(scene: Scene, out: string): Promise<void> {
  const blur = `tmix=frames=${SUB},select='eq(mod(n+1\\,${SUB})\\,0)',setpts=N/(${FPS}*TB)`;
  const color = "scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int";
  const proc = ffmpeg([
    ...["-f", "image2pipe", "-framerate", String(FPS * SUB), "-i", "-"],
    ...["-vf", `${blur},${color},format=yuv420p`, ...H264, out],
  ]);
  const frames = Math.round(scene.duration * FPS);
  for (let i = 0; i < frames; i++) {
    for (let k = 0; k < SUB; k++) {
      await scene.seek((i + (SHUTTER * (k + 0.5)) / SUB) / FPS);
      proc.stdin.write(await scene.page.screenshot({ type: "png" }));
    }
  }
  await finish(proc);
  console.log(`wrote ${out}: ${frames} frames, ${Bun.file(out).size} bytes`);
}

export async function genOgLanding(): Promise<void> {
  await withScene(1, async (scene) => {
    await scene.seek(0);
    const poster = join(PUBLIC_DIR, "og-image.png");
    await Bun.write(poster, await scene.page.screenshot({ type: "png" }));
    console.log(`wrote ${poster}`);
    await writeVideo(scene, join(PUBLIC_DIR, "og-video.mp4"));
  });
}

async function sheet(out: string, n: number): Promise<void> {
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  await withScene(400 / W, async (scene) => {
    const proc = ffmpeg([
      ...["-f", "image2pipe", "-framerate", "1", "-i", "-"],
      ...["-vf", `tile=${cols}x${rows}:padding=8:margin=8:color=0x3a3a3a`, "-frames:v", "1", out],
    ]);
    for (let i = 0; i < n; i++) {
      const t = (scene.duration * i) / n;
      await scene.seek(t);
      await scene.page.evaluate(
        (label) => {
          let tag = document.getElementById("__t");
          if (!tag) {
            tag = document.createElement("div");
            tag.id = "__t";
            tag.style.cssText =
              "position:fixed;right:0;bottom:0;font:700 40px monospace;background:#ff0;padding:2px 10px";
            document.body.append(tag);
          }
          tag.textContent = label;
        },
        `${t.toFixed(2)}s`,
      );
      proc.stdin.write(await scene.page.screenshot({ type: "png" }));
    }
    await finish(proc);
  });
  console.log(`wrote ${out}: ${n} frames`);
}

async function stills(times: number[], dir: string): Promise<void> {
  await withScene(1, async (scene) => {
    for (const t of times) {
      await scene.seek(t);
      const out = join(dir, `still-${t.toFixed(2)}.png`);
      await Bun.write(out, await scene.page.screenshot({ type: "png" }));
      console.log(out);
    }
  });
}

if (import.meta.main) {
  const [mode, a, b] = Bun.argv.slice(2);
  if (mode === "--sheet" && a) await sheet(a, Number(b ?? 16));
  else if (mode === "--stills" && a) await stills(a.split(",").map(Number), b ?? ".");
  else if (!mode) await genOgLanding();
  else {
    console.error("usage: og-landing.ts [--sheet out.png [n] | --stills t,t [dir]]");
    process.exit(2);
  }
}
