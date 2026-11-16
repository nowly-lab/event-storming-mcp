import { homedir } from "node:os";
import { join } from "node:path";

/** The tool's own data folder: projects, history and blobs. Never inside a product repository. */
export function dataDir(env: Record<string, string | undefined> = process.env): string {
  return env.EVENT_STORMING_MCP_DATA_DIR?.trim() || join(homedir(), ".event-storming-mcp");
}
