import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

/** Blob storage port. Local folder in development; S3-compatible storage later. */
export interface BlobStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
}

export class LocalBlobStorage implements BlobStorage {
  private readonly root: string;

  constructor(dir: string) {
    this.root = resolve(process.cwd(), dir);
  }

  private pathFor(key: string) {
    const full = resolve(this.root, key);
    // Refuse keys that escape the storage folder.
    if (!full.startsWith(this.root + sep)) throw new Error("Invalid storage key");
    return full;
  }

  async put(key: string, data: Buffer) {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  async get(key: string) {
    return readFile(this.pathFor(key));
  }
}
