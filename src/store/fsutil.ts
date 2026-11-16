import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Writes through a temporary file and a rename, so a crash never leaves half a file. */
export async function writeAtomic(path: string, content: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, content);
  await rename(tmp, path);
}
