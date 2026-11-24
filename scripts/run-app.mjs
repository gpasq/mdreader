// `npm run app [-- files…]`: builds the release app without packaging an installer, then runs it.
// Files given after `--` are opened in it, e.g. `npm run app -- README.md`.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const win = process.platform === "win32";

const build = spawnSync("npx", ["tauri", "build", "--no-bundle"], { cwd: root, stdio: "inherit", shell: win });
if (build.status !== 0) process.exit(build.status ?? 1);

const exe = join(root, "src-tauri", "target", "release", win ? "mdreader.exe" : "mdreader");
if (!existsSync(exe)) {
  console.error(`Build finished but ${exe} wasn't found.`);
  process.exit(1);
}

// Paths are resolved against where npm was run from, then the app runs on its own.
const files = process.argv.slice(2).map(f => resolve(process.env.INIT_CWD || process.cwd(), f));
spawn(exe, files, { cwd: root, detached: true, stdio: "ignore" }).unref();
console.log(`Started ${exe}`);
