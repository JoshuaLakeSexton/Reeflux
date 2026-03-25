import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";

const root = process.cwd();
const htmlFiles = readdirSync(root)
  .filter((name) => name.endsWith(".html"))
  .map((name) => join(root, name));

const linkPattern = /(?:href|src)\s*=\s*"([^"]+)"/g;

function normalizeRef(ref) {
  if (!ref) return "";
  return ref.split("#")[0].split("?")[0].trim();
}

function isExternal(ref) {
  return (
    ref.startsWith("http://") ||
    ref.startsWith("https://") ||
    ref.startsWith("mailto:") ||
    ref.startsWith("tel:") ||
    ref.startsWith("javascript:") ||
    ref.startsWith("//")
  );
}

function existsTarget(filePath) {
  if (existsSync(filePath)) return true;

  if (!extname(filePath) && existsSync(`${filePath}.html`)) return true;
  if (filePath.endsWith("/") && existsSync(join(filePath, "index.html"))) return true;

  return false;
}

const missing = [];

for (const htmlFile of htmlFiles) {
  const contents = readFileSync(htmlFile, "utf8");
  let match;

  while ((match = linkPattern.exec(contents)) !== null) {
    const raw = match[1];
    const ref = normalizeRef(raw);

    if (!ref || ref === "/") continue;
    if (isExternal(ref)) continue;
    if (ref.startsWith("/.netlify/functions/")) continue;

    const target = ref.startsWith("/")
      ? join(root, ref.slice(1))
      : join(dirname(htmlFile), ref);

    const normalizedTarget = normalize(target);
    if (!existsTarget(normalizedTarget)) {
      missing.push({
        from: htmlFile,
        ref,
      });
    }
  }
}

if (missing.length > 0) {
  console.error("Broken internal links found:\n");
  for (const item of missing) {
    console.error(`- ${item.ref} (from ${item.from})`);
  }
  process.exit(1);
}

console.log(`Link check passed across ${htmlFiles.length} HTML files.`);
