import { execSync } from "node:child_process";

let versao = "dev";
try {
  versao = execSync("git describe --always --dirty", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
} catch {}

/** @type {import('next').NextConfig} */
export default {
  output: "export",
  env: { NEXT_PUBLIC_VERSAO: versao },
  // Sem isto o export gera /entrevista.html e o roteador do cliente procura /entrevista/:
  // a rota nao casa e a pagina nao monta quando a URL traz query string.
  trailingSlash: true,
  images: { unoptimized: true },
};
