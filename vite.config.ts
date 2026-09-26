import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

/** Which build this is, for the corner of the verse list: version, commit and day it was built. */
function buildStamp(): { version: string; commit: string; date: string } {
  const version = (JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string }).version;
  let commit = "dev";
  try {
    commit = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    // Not a git checkout: say so rather than fail the build.
  }
  return { version, commit, date: new Date().toISOString().slice(0, 10) };
}

export default defineConfig({
  define: {
    __BUILD__: JSON.stringify(buildStamp()),
  },
  // GitHub Pages serves the project from /<repo>/.
  base: process.env.GITHUB_ACTIONS ? "/atkm/" : "/",
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 2600,
    rollupOptions: {
      output: {
        manualChunks: {
          playcanvas: ["playcanvas"],
          rapier: ["@dimforge/rapier3d-compat"],
        },
      },
    },
  },
});
