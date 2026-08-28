/**
 * Joins the two passes into the deliverable mp4.
 *
 * The annotations are already in the frames, so ffmpeg only normalises the two
 * captures to one timebase, seats the phone pass in a device frame, and
 * encodes. Both passes are padded to the same canvas so the concat filter has
 * matching geometry.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, statSync, mkdirSync } from "node:fs";
import path from "node:path";

const ROOT = "/tmp/promo/video";
const OUT = process.argv[2] || "/tmp/promo/stellar-wallet-promo.mp4";
const W = 1728, H = 1080, FPS = 30;
const BG = "0x08080A";

const newest = (dir) => {
  const files = readdirSync(dir).filter((f) => f.endsWith(".webm")).map((f) => path.join(dir, f));
  if (!files.length) throw new Error(`no capture in ${dir}`);
  return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
};
const probe = (f) => Number(execFileSync("ffprobe", [
  "-v", "error", "-show_entries", "format=duration",
  "-of", "default=noprint_wrappers=1:nokey=1", f,
]).toString().trim());

const desktop = newest(`${ROOT}/desktop`);
const total = probe(desktop);
console.log(`capture ${total.toFixed(1)}s`);

void BG;
const filter = [
  `[0:v]fps=${FPS},scale=${W}:${H}:flags=lanczos,setsar=1,format=yuv420p,` +
    `fade=t=in:st=0:d=0.6,fade=t=out:st=${(total - 1.0).toFixed(2)}:d=1.0[out]`,
].join(";");

mkdirSync(path.dirname(OUT), { recursive: true });
execFileSync("ffmpeg", [
  "-y",
  "-i", desktop,
  "-filter_complex", filter,
  "-map", "[out]",
  "-c:v", "libx264", "-preset", "slower", "-crf", "17",
  "-profile:v", "high", "-level", "4.2", "-pix_fmt", "yuv420p",
  "-movflags", "+faststart", "-an",
  OUT,
], { stdio: ["ignore", "ignore", "pipe"] });

console.log(`${OUT}  ${probe(OUT).toFixed(1)}s  ${(statSync(OUT).size / 1e6).toFixed(1)} MB`);
