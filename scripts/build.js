import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";

const root = fileURLToPath(new URL("../", import.meta.url));

async function findJavaScript(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findJavaScript(path));
    else if (entry.isFile() && extname(entry.name) === ".js") files.push(path);
  }
  return files;
}

const rootEntries = await readdir(root, { withFileTypes: true });
const rootScripts = rootEntries
  .filter((entry) => entry.isFile() && extname(entry.name) === ".js")
  .map((entry) => join(root, entry.name));
const sourceFiles = [...rootScripts];
for (const directory of ["api", "lib", "scripts", "test"]) {
  sourceFiles.push(...await findJavaScript(join(root, directory)));
}

for (const file of sourceFiles) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.error?.message || `JavaScript syntax check failed: ${file}`);
  }
}

let inlineScriptCount = 0;
for (const name of ["index.html", "shop.html"]) {
  const file = join(root, name);
  const html = await readFile(file, "utf8");
  if (!/<html\b/i.test(html)) throw new Error(`${name} is not a valid HTML entry point.`);
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const [, attributes, source] = match;
    if (/(?:^|\s)src\s*=/i.test(attributes) ||
        /\btype\s*=\s*["']?application\/(?:ld\+)?json/i.test(attributes)) continue;
    new Script(source, { filename: name });
    inlineScriptCount++;
  }
}

const catalog = JSON.parse(await readFile(join(root, "products.json"), "utf8"));
if (!Array.isArray(catalog.products) || catalog.products.length === 0) {
  throw new Error("products.json must contain a non-empty products array.");
}

console.log(`Static build checks passed (${sourceFiles.length} JavaScript files, ${inlineScriptCount} inline scripts, ${catalog.products.length} products).`);
