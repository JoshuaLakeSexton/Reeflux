import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const functionsDir = join(root, "netlify", "functions");

const functionFiles = readdirSync(functionsDir)
  .filter((name) => name.endsWith(".js") && !name.startsWith("_"))
  .map((name) => join(functionsDir, name));

const failures = [];

for (const file of functionFiles) {
  const source = readFileSync(file, "utf8");
  if (!source.includes("exports.handler")) {
    failures.push(`${file} does not export handler`);
  }
}

const appJs = readFileSync(join(root, "app.js"), "utf8");
if (appJs.includes("$/mo")) {
  failures.push("app.js still includes placeholder price '$/mo'");
}

if (failures.length > 0) {
  console.error("Typecheck guard failed:\n");
  for (const line of failures) {
    console.error(`- ${line}`);
  }
  process.exit(1);
}

console.log(`Typecheck guard passed for ${functionFiles.length} function files.`);
