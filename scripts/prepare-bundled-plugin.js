const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const pluginDir = process.env.LEGADO_PLUGIN_DIR || path.resolve(__dirname, "../../koodo-plugin-legado");
const packageFile = path.join(pluginDir, "package.json");
const packFile = path.join(pluginDir, "pack.js");
if (!fs.existsSync(packageFile) || !fs.existsSync(packFile)) {
  throw new Error(`Legado plugin project not found: ${pluginDir}`);
}

execFileSync("npm", ["run", "build"], {
  cwd: pluginDir,
  stdio: "inherit",
  shell: process.platform === "win32",
});
execFileSync(process.execPath, ["pack.js"], { cwd: pluginDir, stdio: "inherit" });

const source = path.join(pluginDir, "legado-engine-plugin.json");
const targetDir = path.resolve(__dirname, "../assets/bundled-plugins");
fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, path.join(targetDir, "legado-engine.json"));
console.log("Bundled Legado plugin prepared.");
