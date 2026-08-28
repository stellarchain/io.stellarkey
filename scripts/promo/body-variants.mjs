/**
 * Variants on r2-body: lock body + shackle, glyph as the lock face.
 * Same family discipline as the refined pass — one scale derived from the
 * largest member, one stroke weight, measured fit, 4u minimum margin.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
const G = readFileSync("/tmp/promo/stellar-glyph.txt", "utf8").trim();
const { bb } = JSON.parse(readFileSync("/tmp/promo/glyph-outline.json", "utf8"));
const { mode: BAR } = JSON.parse(readFileSync("/tmp/promo/stroke.json", "utf8"));
const [bx, by, bw, bh] = bb, CCX = bx + bw / 2, CCY = by + bh / 2;
const P = (n, d = 3) => Number(n.toFixed(d));
const MARGIN = 4, S = 1.2, W = P(BAR * S), GW = P(bw * S), GH = P(bh * S);
const CX = 32, CY = 32;

const gTag = (fill, cx = CX, cy = CY) =>
  `<path transform="translate(${P(cx - CCX * S)} ${P(cy - CCY * S)}) scale(${P(S, 4)})" d="${G}" fill="${fill}" stroke="none"/>`;

/** shackle landing exactly on `topY`; `sw` lets it run heavier than the body */
const shackle = (topY, bodyW, { rise = .52, widthRatio = .64, sw = W, square = false } = {}) => {
  const r = (bodyW * widthRatio) / 2, straight = Math.max(0, bodyW * rise - r);
  const d = square
    ? `M${P(CX - r)} ${P(topY)}V${P(topY - straight - r)}H${P(CX + r)}V${P(topY)}`
    : `M${P(CX - r)} ${P(topY)}V${P(topY - straight)}a${P(r)} ${P(r)} 0 0 1 ${P(r * 2)} 0V${P(topY)}`;
  return `<path d="${d}" stroke-width="${P(sw)}" stroke-linecap="butt" stroke-linejoin="round" fill="none"/>`;
};
const bodyBox = (pad, rx) => {
  const w = GW + pad * 2, h = GH + pad * 2;
  return { w, h, x: P(CX - w / 2), y: P(CY - h / 2), rx: P(rx) };
};

const V = {};

/* c1 · solid — body filled, glyph struck out of it */
V["c1-solid"] = (id) => { const b = bodyBox(W * 1.15, W * 2.1);
  return `${shackle(P(b.y + W * .2), b.w)}
<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
  <rect width="64" height="64" fill="#000"/>
  <rect x="${b.x}" y="${b.y}" width="${P(b.w)}" height="${P(b.h)}" rx="${b.rx}" fill="#fff"/>
  ${gTag("#000")}</mask>
<rect x="${b.x}" y="${b.y}" width="${P(b.w)}" height="${P(b.h)}" fill="currentColor" stroke="none" mask="url(#${id})"/>`; };
// the painted rect is clipped to the body: a full-tile rect would inflate the
// measured bbox and drag the whole family's scale down with it

/* c2 · stout — a real padlock is wider than tall in the body */
V["c2-stout"] = () => { const b = bodyBox(W * 1.5, W * 1.9);
  return `${shackle(P(b.y + W * .2), b.w, { rise: .44, widthRatio: .58 })}
<rect x="${b.x}" y="${b.y}" width="${P(b.w)}" height="${P(b.h)}" rx="${b.rx}" stroke-width="${W}" fill="none"/>${gTag("currentColor")}`; };

/* c3 · arched — the classic padlock silhouette, body radiused at the top */
V["c3-arched"] = () => { const pad = W * 1.2, w = GW + pad * 2, h = GH + pad * 2;
  const x = P(CX - w / 2), y = P(CY - h / 2), r = P(w * .42), rb = P(W * 1.5);
  return `${shackle(P(y + r * .5), w, { rise: .5, widthRatio: .6 })}
<path d="M${x} ${P(y + h - rb)}V${P(y + r)}a${r} ${r} 0 0 1 ${P(w)} 0V${P(y + h - rb)}a${rb} ${rb} 0 0 1 ${P(-rb)} ${rb}H${P(x + rb)}a${rb} ${rb} 0 0 1 ${P(-rb)} ${P(-rb)}Z"
  stroke-width="${W}" fill="none"/>${gTag("currentColor")}`; };

/* c4 · round — circular body, the fob-lock form */
V["c4-round"] = () => { const r = P(Math.hypot(GW, GH) / 2 + W * .9);
  return `${shackle(P(CY - r * .86), P(r * 2), { rise: .46, widthRatio: .56 })}
<circle cx="${CX}" cy="${CY}" r="${r}" stroke-width="${W}" fill="none"/>${gTag("currentColor")}`; };

/* c5 · keyed — a keyhole below the mark, inside the body */
V["c5-keyed"] = () => { const pad = W * 1.15, w = GW + pad * 2, h = GH + pad * 2 + W * 3.4;
  const x = P(CX - w / 2), y = P(CY - h / 2), gy = P(y + pad + GH / 2);
  const ky = P(y + h - W * 1.9), kr = P(W * .62);
  return `${shackle(P(y + W * .2), w, { rise: .5 })}
<rect x="${x}" y="${y}" width="${P(w)}" height="${P(h)}" rx="${P(W * 2.1)}" stroke-width="${W}" fill="none"/>
${gTag("currentColor", CX, gy)}
<circle cx="${CX}" cy="${ky}" r="${kr}" stroke-width="${P(W * .8)}" fill="none"/>`; };

/* c6 · heavy — shackle run thicker than the body, the way a real one is */
V["c6-heavy"] = () => { const b = bodyBox(W * 1.15, W * 2.1);
  return `${shackle(P(b.y + W * .2), b.w, { rise: .5, sw: W * 1.45 })}
<rect x="${b.x}" y="${b.y}" width="${P(b.w)}" height="${P(b.h)}" rx="${b.rx}" stroke-width="${W}" fill="none"/>${gTag("currentColor")}`; };

/* c7 · squared — square-shouldered shackle against a tight body */
V["c7-squared"] = () => { const b = bodyBox(W * 1.15, W * 1.2);
  return `${shackle(P(b.y + W * .2), b.w, { rise: .46, widthRatio: .62, square: true })}
<rect x="${b.x}" y="${b.y}" width="${P(b.w)}" height="${P(b.h)}" rx="${b.rx}" stroke-width="${W}" fill="none"/>${gTag("currentColor")}`; };

/* c8 · tall — a portrait body, the mark sitting high */
V["c8-tall"] = () => { const pad = W * 1.15, w = GW + pad * 2, h = GH + pad * 2 + W * 2.2;
  const x = P(CX - w / 2), y = P(CY - h / 2);
  return `${shackle(P(y + W * .2), w, { rise: .54, widthRatio: .66 })}
<rect x="${x}" y="${y}" width="${P(w)}" height="${P(h)}" rx="${P(W * 2.4)}" stroke-width="${W}" fill="none"/>
${gTag("currentColor", CX, P(y + pad + GH / 2 + W * .3))}`; };

/* measure the family, scale from the largest, centre each */
const b = await chromium.launch();
const page = await b.newPage();
const built = Object.fromEntries(Object.entries(V).map(([k, f]) => [k, f(`m-${k}`)]));
const boxes = {};
for (const [k, body] of Object.entries(built)) {
  await page.setContent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="640" height="640"><g id="m" stroke="currentColor" style="color:#000">${body}</g></svg>`);
  boxes[k] = await page.evaluate(() => { const r = document.getElementById("m").getBBox(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
}
const avail = 64 - MARGIN * 2;
const K = Math.min(...Object.values(boxes).map((r) => Math.min(avail / r.w, avail / r.h)));
const OUT = {};
for (const [k, body] of Object.entries(built)) {
  const r = boxes[k];
  OUT[k] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g fill="none" stroke="currentColor" transform="translate(${P((64 - r.w * K) / 2 - r.x * K)} ${P((64 - r.h * K) / 2 - r.y * K)}) scale(${P(K, 4)})">${body}</g></svg>`;
  console.log(`${k.padEnd(11)} ${(r.w * K).toFixed(1)}x${(r.h * K).toFixed(1)}u`);
}
await b.close();
let bad = 0;
for (const [k, v] of Object.entries(OUT)) {
  if (!v.includes(G)) { console.log("GLYPH ALTERED:", k); bad++; }
  if (/<svg[^>]*(fill|stroke)=/.test(v)) { console.log("ROOT ATTR:", k); bad++; }
  writeFileSync(`/tmp/promo/${k}.svg`, v);
}
writeFileSync("/tmp/promo/body-variants.json", JSON.stringify(OUT));
console.log(`\nfamily scale x${K.toFixed(4)} · stroke ${(W * K).toFixed(2)}u · glyph ${(GW * K).toFixed(1)}u — identical across all · ${bad} problems`);
