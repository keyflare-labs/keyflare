import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(__dirname, "..");
const monorepoRoot = path.resolve(cliRoot, "..", "..");
const serverSrc = path.join(monorepoRoot, "packages", "server");
const serverDest = path.join(cliRoot, "dist", "server");

const filesToCopy = [
  "src",
  "migrations",
  "wrangler.jsonc",
  "package.json",
  "tsconfig.json",
];

function copyRecursive(src: string, dest: string): void {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

fs.mkdirSync(serverDest, { recursive: true });

for (const file of filesToCopy) {
  const srcPath = path.join(serverSrc, file);
  const destPath = path.join(serverDest, file);
  if (fs.existsSync(srcPath)) {
    copyRecursive(srcPath, destPath);
    console.log(`Copied: ${file}`);
  } else {
    console.warn(`Warning: ${file} not found, skipping`);
  }
}

console.log(`\nServer files copied to: ${serverDest}`);
