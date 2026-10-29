import sharp from "sharp";
import { sha256 } from "../../lib/crypto";
import { badRequest } from "../../lib/errors";

const ACCEPTED_FORMATS = new Set(["jpeg", "png", "webp", "gif", "avif", "heif", "tiff"]);

export interface ProcessedPhoto {
  data: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
  mimeType: "image/webp";
  sha256: string;
}

/**
 * Normalises a customer photo: rotates it upright, caps it at 2048px and re-encodes
 * to WebP. Re-encoding drops all metadata — including the GPS location phones embed.
 */
export async function processPhoto(input: Buffer): Promise<ProcessedPhoto> {
  let format: string | undefined;
  try {
    format = (await sharp(input).metadata()).format;
  } catch {
    throw badRequest("That file isn't a photo we can read.");
  }
  if (!format || !ACCEPTED_FORMATS.has(format)) throw badRequest("Please upload a JPEG, PNG or WebP photo.");

  const full = await sharp(input)
    .rotate()
    .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });

  const thumb = await sharp(input).rotate().resize({ width: 480, height: 480, fit: "cover" }).webp({ quality: 72 }).toBuffer();

  return {
    data: full.data,
    thumb,
    width: full.info.width,
    height: full.info.height,
    mimeType: "image/webp",
    sha256: sha256(full.data),
  };
}
