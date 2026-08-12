/**
 * Stable local development runner.
 *
 * It starts the React development server, then opens Electron exactly once.
 * Unlike the old `npm run dev` command it deliberately does not use nodemon:
 * saving a file or closing an Electron window must not cause a restart loop.
 */
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const reactScripts = path.join(
  projectRoot,
  "node_modules",
  "react-scripts",
  "scripts",
  "start.js"
);
const electronBinary = require("electron");

let serverProcess = null;
let electronProcess = null;
let isStopping = false;

const stop = (exitCode = 0) => {
  if (isStopping) return;
  isStopping = true;
  if (electronProcess && !electronProcess.killed) electronProcess.kill();
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
  process.exit(exitCode);
};

const waitForServer = (deadline) => {
  const request = http.get("http://127.0.0.1:3000/", (response) => {
    response.resume();
    if (response.statusCode && response.statusCode < 500) {
      launchElectron();
      return;
    }
    retry();
  });
  request.once("error", retry);
  request.setTimeout(1200, () => request.destroy());

  function retry() {
    if (Date.now() >= deadline) {
      console.error("Books could not start the local web server on port 3000.");
      stop(1);
      return;
    }
    setTimeout(() => waitForServer(deadline), 400);
  }
};

const launchElectron = () => {
  if (electronProcess || isStopping) return;
  electronProcess = spawn(electronBinary, ["."], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
    windowsHide: false,
  });
  electronProcess.once("exit", (code) => stop(code || 0));
  electronProcess.once("error", (error) => {
    console.error("Books could not launch Electron:", error.message);
    stop(1);
  });
};

serverProcess = spawn(process.execPath, [reactScripts], {
  cwd: projectRoot,
  env: { ...process.env, BROWSER: "none" },
  stdio: "inherit",
  windowsHide: true,
});
serverProcess.once("error", (error) => {
  console.error("Books could not start React:", error.message);
  stop(1);
});
serverProcess.once("exit", (code) => {
  if (!isStopping) {
    console.error(`Books local web server stopped unexpectedly (code ${code ?? "unknown"}).`);
    stop(code || 1);
  }
});

process.once("SIGINT", () => stop());
process.once("SIGTERM", () => stop());
waitForServer(Date.now() + 45_000);
