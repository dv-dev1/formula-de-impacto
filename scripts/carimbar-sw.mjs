import { readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const urlsDoExport = (caminhos) =>
  caminhos
    .filter((c) => !["sw.js", "_headers", "_redirects", "_routes.json", "404.html"].includes(c) && !c.startsWith("404/") && !c.includes("_not-found"))
    .filter((c) => !c.split("/").at(-1).startsWith("."))
    .map((c) => `/${/(^|\/)index\.html$/.test(c) ? c.slice(0, -10) : c}`);

const listar = async (pasta, prefixo = "") => {
  const entradas = await readdir(pasta, { withFileTypes: true });
  const listas = await Promise.all(entradas.map((e) =>
    e.isDirectory() ? listar(join(pasta, e.name), `${prefixo}${e.name}/`) : [`${prefixo}${e.name}`],
  ));
  return listas.flat();
};

const carimbar = async () => {
  const raiz = fileURLToPath(new URL("../", import.meta.url));
  const versao = (await readFile(join(raiz, ".next/BUILD_ID"), "utf8")).trim();
  if (!versao) throw new Error("BUILD_ID vazio.");
  const saida = join(raiz, "out");
  const caminhos = await listar(saida);
  const arquivo = join(saida, "sw.js");
  let sw = await readFile(arquivo, "utf8");
  for (const [padrao, valor] of [
    [/const VERSAO = "[^"]*";/, `const VERSAO = ${JSON.stringify(versao)};`],
    [/const ARQUIVOS = \[[\s\S]*?\];/, `const ARQUIVOS = ${JSON.stringify(urlsDoExport(caminhos), null, 2)};`],
  ]) {
    if (!padrao.test(sw)) throw new Error(`Padrão ausente no service worker: ${padrao}`);
    sw = sw.replace(padrao, () => valor);
  }
  await writeFile(arquivo, sw);
};

if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) await carimbar();
