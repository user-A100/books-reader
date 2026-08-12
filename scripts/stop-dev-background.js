/** Stop only the detached development process created by start-dev-background. */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const pidFile = path.resolve(__dirname, "..", ".koodo-dev.pid");
if (!fs.existsSync(pidFile)) {
  console.log("No background Books development reader is running.");
  process.exit(0);
}

const pid = Number.parseInt(fs.readFileSync(pidFile, "utf8"), 10);
fs.unlinkSync(pidFile);
if (!Number.isInteger(pid) || pid <= 0) {
  console.log("The saved development process identifier was invalid.");
  process.exit(0);
}

try {
  if (process.platform === "win32") {
    execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
    });
  } else {
    process.kill(-pid, "SIGTERM");
  }
  console.log("Books development reader stopped.");
} catch {
  console.log("The background Books development reader was already stopped.");
}
