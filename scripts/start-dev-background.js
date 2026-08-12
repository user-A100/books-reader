/**
 * Starts the development reader outside the calling terminal. This is useful
 * for daily reading: closing PowerShell will not close the local web server
 * or Electron window. Use `npm run dev:stop` when it is no longer needed.
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const pidFile = path.join(projectRoot, ".koodo-dev.pid");

const isRunning = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

if (fs.existsSync(pidFile)) {
  const existingPid = Number.parseInt(fs.readFileSync(pidFile, "utf8"), 10);
  if (Number.isInteger(existingPid) && existingPid > 0 && isRunning(existingPid)) {
    console.log("Books development reader is already running.");
    process.exit(0);
  }
  fs.unlinkSync(pidFile);
}

const runner = path.join(projectRoot, "scripts", "dev-runner.js");
const child = spawn(process.execPath, [runner], {
  cwd: projectRoot,
  detached: true,
  stdio: "ignore",
  windowsHide: true,
});

child.unref();
fs.writeFileSync(pidFile, String(child.pid), "utf8");
console.log("Books is starting in the background. You can close this terminal.");
