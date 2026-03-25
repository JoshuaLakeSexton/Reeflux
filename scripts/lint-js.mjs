import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function collectJsFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      files.push(...collectJsFiles(full));
      continue;
    }
    if (entry.endsWith(".js") || entry.endsWith(".mjs")) {
      files.push(full);
    }
  }
  return files;
}

const targets = [
  join(root, "app.js"),
  ...collectJsFiles(join(root, "netlify", "functions")),
  ...collectJsFiles(join(root, "scripts")),
];

const failed = [];

for (const file of targets) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    failed.push({ file, output: result.stderr || result.stdout || "syntax check failed" });
  }
}

if (failed.length > 0) {
  console.error("JavaScript syntax check failed:\n");
  for (const item of failed) {
    console.error(`- ${item.file}`);
    console.error(item.output.trim());
    console.error("");
  }
  process.exit(1);
}

console.log(`Syntax lint passed for ${targets.length} files.`);
