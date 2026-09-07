/**
 * Minimal PNG/ICNS/ICO readers for brand-asset validation. Parses only what the
 * asset tests need: IHDR geometry, RGBA pixel access, and container inventories.
 * Not a general codec — palette/interlaced PNGs are rejected on purpose.
 */
import { inflateSync } from "node:zlib";

export interface PngInfo {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function pngInfo(bytes: Uint8Array): PngInfo {
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIG[i]) throw new Error("not a PNG");
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // First chunk must be IHDR at offset 8.
  if (ascii(bytes, 12, 4) !== "IHDR") throw new Error("IHDR not first");
  return {
    width: dv.getUint32(16),
    height: dv.getUint32(20),
    bitDepth: bytes[24],
    colorType: bytes[25],
  };
}

function collectIdat(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Uint8Array[] = [];
  let offset = 8;
  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = ascii(bytes, offset + 4, 4);
    if (type === "IDAT") chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    if (type === "IEND") break;
    offset += 12 + length;
  }
  return concat(chunks);
}

function paeth(left: number, above: number, upperLeft: number): number {
  const leftDistance = Math.abs(above - upperLeft);
  const aboveDistance = Math.abs(left - upperLeft);
  const upperLeftDistance = Math.abs(left + above - 2 * upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function unfilterByte(
  filter: number,
  raw: number,
  left: number,
  above: number,
  upperLeft: number,
): number {
  switch (filter) {
    case 0:
      return raw;
    case 1:
      return raw + left;
    case 2:
      return raw + above;
    case 3:
      return raw + ((left + above) >> 1);
    case 4:
      return raw + paeth(left, above, upperLeft);
    default:
      throw new Error(`bad filter ${filter}`);
  }
}

function unfilterRgba(raw: Uint8Array, info: PngInfo): Uint8Array {
  const bytesPerPixel = 4;
  const stride = info.width * bytesPerPixel;
  const rgba = new Uint8Array(info.height * stride);
  let inputOffset = 0;
  for (let rowIndex = 0; rowIndex < info.height; rowIndex++) {
    const filter = raw[inputOffset++];
    const row = rgba.subarray(rowIndex * stride, (rowIndex + 1) * stride);
    const previous =
      rowIndex > 0 ? rgba.subarray((rowIndex - 1) * stride, rowIndex * stride) : null;
    for (let column = 0; column < stride; column++) {
      const left = column >= bytesPerPixel ? row[column - bytesPerPixel] : 0;
      const above = previous?.[column] ?? 0;
      const upperLeft = column >= bytesPerPixel ? (previous?.[column - bytesPerPixel] ?? 0) : 0;
      row[column] = unfilterByte(filter, raw[inputOffset++], left, above, upperLeft) & 0xff;
    }
  }
  return rgba;
}

/** Decodes an 8-bit RGBA (colorType 6) PNG to raw un-filtered RGBA bytes. */
export function pngRgba(bytes: Uint8Array): { info: PngInfo; rgba: Uint8Array } {
  const info = pngInfo(bytes);
  if (info.bitDepth !== 8 || info.colorType !== 6) {
    throw new Error(`unsupported PNG (bitDepth=${info.bitDepth} colorType=${info.colorType})`);
  }
  const raw = new Uint8Array(inflateSync(collectIdat(bytes)));
  return { info, rgba: unfilterRgba(raw, info) };
}

/** True iff every visible (alpha>0) pixel has pure-black RGB — macOS template purity. */
export function isTemplatePure(bytes: Uint8Array): boolean {
  const { rgba } = pngRgba(bytes);
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] !== 0 && (rgba[i] !== 0 || rgba[i + 1] !== 0 || rgba[i + 2] !== 0))
      return false;
  }
  return true;
}

export function icnsChunks(bytes: Uint8Array): Array<{ type: string; length: number }> {
  if (ascii(bytes, 0, 4) !== "icns") throw new Error("not an icns");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Array<{ type: string; length: number }> = [];
  let off = 8;
  while (off + 8 <= bytes.length) {
    const type = ascii(bytes, off, 4);
    const length = dv.getUint32(off + 4);
    out.push({ type, length });
    off += length;
  }
  return out;
}

export function icoEntries(
  bytes: Uint8Array,
): Array<{ width: number; height: number; bpp: number }> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint16(0, true) !== 0 || dv.getUint16(2, true) !== 1) throw new Error("not an ico");
  const count = dv.getUint16(4, true);
  const out: Array<{ width: number; height: number; bpp: number }> = [];
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 16;
    out.push({
      width: bytes[e] === 0 ? 256 : bytes[e],
      height: bytes[e + 1] === 0 ? 256 : bytes[e + 1],
      bpp: dv.getUint16(e + 6, true),
    });
  }
  return out;
}

function ascii(bytes: Uint8Array, off: number, len: number): string {
  return String.fromCharCode(...bytes.subarray(off, off + len));
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
