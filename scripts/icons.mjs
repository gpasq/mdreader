// Regenerates src-tauri/icons and the welcome-screen icon from assets/icon-glyph.svg.
//
// Like GitSource, the app icon is borderless and full size: just the glyph, with no tile,
// filling the canvas so it matches the size of other taskbar and Dock icons.
// (assets/icon.svg is the original tiled design, kept for reference.)
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const source = join(root, "assets", "icon-glyph.svg");
const out = join(root, "src-tauri", "icons");
const work = mkdtempSync(join(tmpdir(), "mdreader-icons-"));

execFileSync("npx", ["tauri", "icon", source, "-o", work], { cwd: root, stdio: "ignore", shell: process.platform === "win32" });
for (const name of readdirSync(work)) {
  if (/\.(png|ico|icns)$/.test(name)) copyFileSync(join(work, name), join(out, name));
}
copyFileSync(join(work, "128x128@2x.png"), join(root, "src", "icon.png"));
rmSync(work, { recursive: true, force: true });
console.log("icons written to", out);
