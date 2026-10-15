import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const systemCaOption = "--use-system-ca";
const configuredNodeOptions = process.env.NODE_OPTIONS?.trim() ?? "";
const nodeOptions = configuredNodeOptions.includes(systemCaOption)
  ? configuredNodeOptions
  : [configuredNodeOptions, systemCaOption].filter(Boolean).join(" ");
const nextCli = fileURLToPath(
  new URL("../node_modules/next/dist/bin/next", import.meta.url),
);

const child = spawn(process.execPath, [nextCli, ...process.argv.slice(2)], {
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error("Failed to start Next.js.", error);
  process.exitCode = 1;
});

child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
