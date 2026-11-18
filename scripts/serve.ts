import "./env";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

/**
 * Production entry after migrations: starts Next.js and, when SCRAPE_SOURCES is set, the import
 * worker next to it. The worker is restarted if it crashes (with a growing pause); if Next.js
 * exits, everything stops so the platform restarts the container. SIGTERM reaches both.
 */

const bin = (name: string) => path.join(process.cwd(), "node_modules", ".bin", name);
const children = new Set<ChildProcess>();
let shuttingDown = false;

function start(command: string, args: string[]): ChildProcess {
  const child = spawn(command, args, { stdio: "inherit", env: process.env });
  children.add(child);
  child.on("exit", () => children.delete(child));
  return child;
}

const web = start(bin("next"), ["start", ...process.argv.slice(2)]);
web.on("exit", (code, signal) => {
  shutdown(signal ? 1 : (code ?? 1));
});

if ((process.env.SCRAPE_SOURCES ?? "").trim() !== "") {
  let failures = 0;
  const runWorker = () => {
    const startedAt = Date.now();
    const worker = start(bin("tsx"), [path.join("scripts", "worker.ts")]);
    worker.on("exit", (code) => {
      if (shuttingDown || code === 0) return;
      // A worker that ran for an hour before failing starts over with a short pause.
      failures = Date.now() - startedAt > 3_600_000 ? 1 : failures + 1;
      const pause = Math.min(30 * 60_000, 30_000 * 2 ** (failures - 1));
      console.error(`[serve] import worker exited with ${code}, restarting in ${Math.round(pause / 1000)} s`);
      setTimeout(() => {
        if (!shuttingDown) runWorker();
      }, pause).unref();
    });
  };
  runWorker();
}

function shutdown(code: number) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  // Give the children a moment to finish, then leave.
  setTimeout(() => process.exit(code), 10_000).unref();
  const check = setInterval(() => {
    if (children.size === 0) {
      clearInterval(check);
      process.exit(code);
    }
  }, 200);
}

process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));
