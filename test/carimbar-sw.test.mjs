import assert from "node:assert/strict";
import test from "node:test";

import { urlsDoExport } from "../scripts/carimbar-sw.mjs";

test("URLs do export incluem rotas, chunks e RSC e excluem arquivos especiais", () => {
  assert.deepEqual(urlsDoExport([
    "index.html", "relatorio/index.html", "aparelho/index.html", "index.txt", "relatorio/index.txt",
    "_next/static/chunks/app/page-123.js", "logo.png", "manifest.webmanifest",
    "sw.js", "_headers", "404.html", "404/index.html", "404/index.txt",
    "_not-found/index.html", "_not-found/index.txt", "pasta/_not-found/index.html",
    ".DS_Store", "pasta/.DS_Store", ".oculto", "pasta/.oculto", "_redirects", "_routes.json",
  ]), [
    "/", "/relatorio/", "/aparelho/", "/index.txt", "/relatorio/index.txt",
    "/_next/static/chunks/app/page-123.js", "/logo.png", "/manifest.webmanifest",
  ]);
  assert.deepEqual(urlsDoExport([]), []);
});
