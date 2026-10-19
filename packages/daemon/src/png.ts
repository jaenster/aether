import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** An RGB PNG from rows of RGB bytes, top row first. */
export function encodePng(width: number, height: number, rgbTopDown: Buffer): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // filter: none
    rgbTopDown.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** An uncompressed 24- or 32-bit BMP (as Aether's screenshot writes) as a PNG. */
export function bmpToPng(bmp: Buffer): Buffer {
  if (bmp.length < 54 || bmp.toString("ascii", 0, 2) !== "BM") throw new Error("not a BMP file");
  const offset = bmp.readUInt32LE(10);
  const width = bmp.readInt32LE(18);
  const rawHeight = bmp.readInt32LE(22);
  const bpp = bmp.readUInt16LE(28);
  const compression = bmp.readUInt32LE(30);
  if ((bpp !== 24 && bpp !== 32) || (compression !== 0 && compression !== 3)) {
    throw new Error(`BMP with ${bpp} bits per pixel, compression ${compression} is not supported`);
  }
  const height = Math.abs(rawHeight);
  const bottomUp = rawHeight > 0;
  const bytesPP = bpp / 8;
  const stride = Math.ceil((width * bytesPP) / 4) * 4;
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    const src = offset + (bottomUp ? height - 1 - y : y) * stride;
    for (let x = 0; x < width; x++) {
      const s = src + x * bytesPP;
      const d = (y * width + x) * 3;
      rgb[d] = bmp[s + 2];
      rgb[d + 1] = bmp[s + 1];
      rgb[d + 2] = bmp[s];
    }
  }
  return encodePng(width, height, rgb);
}
