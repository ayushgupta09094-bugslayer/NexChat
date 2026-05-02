import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");

const filesToCopy = [
  "index.html",
  "style.css",
  "app.js",
  "firebase.js"
];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const file of filesToCopy) {
  if (existsSync(path.join(root, file))) {
    await cp(path.join(root, file), path.join(dist, file));
  }
}

if (existsSync(path.join(root, "config"))) {
  await cp(path.join(root, "config"), path.join(dist, "config"), { recursive: true });
}

await writeFile(
  path.join(dist, "404.html"),
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NexChat</title><meta http-equiv="refresh" content="0; url=/"></head><body></body></html>`
);

console.log("✅ dist folder created. Firebase Hosting will deploy the dist folder.");
