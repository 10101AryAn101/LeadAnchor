import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../config/env";

const key = Buffer.from(env.DATA_ENCRYPTION_KEY, "base64");
if (key.length !== 32) {
  throw new Error("DATA_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256).");
}

/**
 * Encrypts a sensitive value (EIN, date of birth) with AES-256-GCM.
 * Output format: v1.<iv>.<authTag>.<ciphertext>, all base64url.
 * In production the key comes from a KMS; the format already carries a version for rotation.
 */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(sealed: string): string {
  const [version, iv, tag, ciphertext] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Unsupported secret format");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

export const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

/** URL-safe random token for customer links (intake forms, billing portal). Only its hash is stored. */
export const randomToken = (bytes = 24) => randomBytes(bytes).toString("base64url");
