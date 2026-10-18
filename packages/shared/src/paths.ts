import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The one directory holding every credential and local artifact this tool
 * writes, for every ad platform it talks to. The name is frozen: renaming it to
 * match the "Adwarp" brand would break stored credentials on existing installs
 * (see AGENTS.md). Platform-specific files live inside it under distinct names.
 */
export const LIADS_DIR = join(homedir(), ".liads");
