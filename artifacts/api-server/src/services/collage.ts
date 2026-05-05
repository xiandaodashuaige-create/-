import sharp from "sharp";
import { logger } from "../lib/logger.js";

export type CollageLayout = "single" | "dual-vertical" | "dual-horizontal" | "grid-2x2" | "left-big-right-small";

export interface CollageInput {
  layout: CollageLayout;
  images: Buffer[];
  width?: number;
  height?: number;
  gap?: number;
  background?: string;
}

export interface TextOverlayInput {
  text: string;
  position: "top" | "center" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
  fontSize?: number;
  color?: string;
  strokeColor?: string;
  strokeWidth?: number;
  fontFamily?: string;
  bgColor?: string;
}

export interface ComposeInput {
  baseImage: Buffer;
  textOverlays?: TextOverlayInput[];
  width?: number;
  height?: number;
}

export async function buildCollage(input: CollageInput): Promise<Buffer> {
  const W = input.width ?? 1536;
  const H = input.height ?? 2048;
  const gap = input.gap ?? 16;
  const bg = input.background ?? "#ffffff";

  if (input.images.length === 0) throw new Error("collage requires at least one image");

  if (input.layout === "single" || input.images.length === 1) {
    return sharp(input.images[0]).resize(W, H, { fit: "cover" }).png().toBuffer();
  }

  const composites: sharp.OverlayOptions[] = [];

  if (input.layout === "dual-vertical") {
    const cellH = Math.floor((H - gap) / 2);
    const a = await sharp(input.images[0]).resize(W, cellH, { fit: "cover" }).toBuffer();
    const b = await sharp(input.images[1] || input.images[0]).resize(W, cellH, { fit: "cover" }).toBuffer();
    composites.push({ input: a, top: 0, left: 0 });
    composites.push({ input: b, top: cellH + gap, left: 0 });
  } else if (input.layout === "dual-horizontal") {
    const cellW = Math.floor((W - gap) / 2);
    const a = await sharp(input.images[0]).resize(cellW, H, { fit: "cover" }).toBuffer();
    const b = await sharp(input.images[1] || input.images[0]).resize(cellW, H, { fit: "cover" }).toBuffer();
    composites.push({ input: a, top: 0, left: 0 });
    composites.push({ input: b, top: 0, left: cellW + gap });
  } else if (input.layout === "grid-2x2") {
    const cellW = Math.floor((W - gap) / 2);
    const cellH = Math.floor((H - gap) / 2);
    for (let i = 0; i < 4; i++) {
      const src = input.images[i] || input.images[i % input.images.length];
      const tile = await sharp(src).resize(cellW, cellH, { fit: "cover" }).toBuffer();
      const row = Math.floor(i / 2);
      const col = i % 2;
      composites.push({
        input: tile,
        top: row * (cellH + gap),
        left: col * (cellW + gap),
      });
    }
  } else if (input.layout === "left-big-right-small") {
    const bigW = Math.floor((W - gap) * 0.62);
    const smallW = W - gap - bigW;
    const smallH = Math.floor((H - gap) / 2);
    const big = await sharp(input.images[0]).resize(bigW, H, { fit: "cover" }).toBuffer();
    const top = await sharp(input.images[1] || input.images[0]).resize(smallW, smallH, { fit: "cover" }).toBuffer();
    const bottom = await sharp(input.images[2] || input.images[1] || input.images[0])
      .resize(smallW, smallH, { fit: "cover" })
      .toBuffer();
    composites.push({ input: big, top: 0, left: 0 });
    composites.push({ input: top, top: 0, left: bigW + gap });
    composites.push({ input: bottom, top: smallH + gap, left: bigW + gap });
  }

  return sharp({
    create: {
      width: W,
      height: H,
      channels: 4,
      background: bg,
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function positionToCoords(
  pos: TextOverlayInput["position"],
  W: number,
  H: number,
  textW: number,
  textH: number,
): { x: number; y: number; anchor: "start" | "middle" | "end" } {
  const padX = Math.round(W * 0.05);
  const padY = Math.round(H * 0.06);

  switch (pos) {
    case "top":
      return { x: W / 2, y: padY + textH * 0.85, anchor: "middle" };
    case "center":
      return { x: W / 2, y: H / 2, anchor: "middle" };
    case "bottom":
      return { x: W / 2, y: H - padY, anchor: "middle" };
    case "top-left":
      return { x: padX, y: padY + textH * 0.85, anchor: "start" };
    case "top-right":
      return { x: W - padX, y: padY + textH * 0.85, anchor: "end" };
    case "bottom-left":
      return { x: padX, y: H - padY, anchor: "start" };
    case "bottom-right":
      return { x: W - padX, y: H - padY, anchor: "end" };
    default:
      return { x: W / 2, y: H / 2, anchor: "middle" };
  }
}

function buildTextSvg(W: number, H: number, items: TextOverlayInput[]): string {
  const elems: string[] = [];

  for (const it of items) {
    const fontSize = it.fontSize ?? Math.round(W * 0.075);
    const color = it.color ?? "#ffffff";
    const stroke = it.strokeColor ?? "#000000";
    const strokeWidth = it.strokeWidth ?? Math.max(2, Math.round(fontSize * 0.06));
    const fontFamily = it.fontFamily ?? "'PingFang SC','Microsoft YaHei','Noto Sans CJK SC',sans-serif";

    const lines = it.text.split(/\n|\\n/).filter((l) => l.length > 0);
    const lineHeight = Math.round(fontSize * 1.2);
    const totalH = lineHeight * lines.length;
    const maxLineW = Math.max(...lines.map((l) => l.length)) * fontSize * 0.95;

    const { x, y, anchor } = positionToCoords(it.position, W, H, maxLineW, totalH);

    if (it.bgColor) {
      const bgPadX = Math.round(fontSize * 0.4);
      const bgPadY = Math.round(fontSize * 0.25);
      let bgX = x;
      if (anchor === "middle") bgX = x - maxLineW / 2;
      else if (anchor === "end") bgX = x - maxLineW;
      const bgY = y - fontSize * 0.85;
      elems.push(
        `<rect x="${bgX - bgPadX}" y="${bgY - bgPadY}" width="${maxLineW + bgPadX * 2}" height="${totalH + bgPadY * 2}" fill="${it.bgColor}" rx="${Math.round(fontSize * 0.2)}"/>`,
      );
    }

    lines.forEach((line, idx) => {
      const ly = y + idx * lineHeight;
      elems.push(
        `<text x="${x}" y="${ly}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="900" text-anchor="${anchor}" fill="${color}" stroke="${stroke}" stroke-width="${strokeWidth}" paint-order="stroke fill" stroke-linejoin="round">${escapeXml(line)}</text>`,
      );
    });
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${elems.join("")}</svg>`;
}

export async function composeWithText(input: ComposeInput): Promise<Buffer> {
  const meta = await sharp(input.baseImage).metadata();
  const W = input.width ?? meta.width ?? 1536;
  const H = input.height ?? meta.height ?? 2048;

  let base = sharp(input.baseImage);
  if (input.width || input.height) {
    base = base.resize(W, H, { fit: "cover" });
  }

  if (!input.textOverlays || input.textOverlays.length === 0) {
    return base.png().toBuffer();
  }

  const svg = buildTextSvg(W, H, input.textOverlays);
  logger.debug({ svgLen: svg.length, items: input.textOverlays.length }, "collage: overlay text");

  return base
    .composite([{ input: Buffer.from(svg, "utf-8"), top: 0, left: 0 }])
    .png()
    .toBuffer();
}
