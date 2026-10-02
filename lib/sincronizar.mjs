const objeto = (valor) => valor !== null && typeof valor === "object" && !Array.isArray(valor);

export const entrevistaValida = (e) =>
  objeto(e) && typeof e.id === "string" && e.id.length <= 100 &&
  objeto(e.perfil) && objeto(e.respostas) && typeof e.iniciadaEm === "string";

export const versaoDe = (e) => e.atualizadaEm ?? e.iniciadaEm;

export const pendentesDeEnvio = (lista) => lista.filter((e) => !e.enviadaEm || e.enviadaEm < versaoDe(e));

export const daConta = (e, conta) => e.entrevistadorId
  ? e.entrevistadorId === conta.id
  : !e.entrevistador || e.entrevistador === conta.nome;

export function lerCredencial(cabecalho) {
  if (typeof cabecalho !== "string") return null;
  const partes = /^Bearer ([A-Za-z0-9-]{1,100})\.([a-f0-9]{64})$/.exec(cabecalho);
  return partes ? { id: partes[1], segredo: partes[2] } : null;
}

export async function hashDoSegredo(segredo) {
  const resumo = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(segredo));
  return [...new Uint8Array(resumo)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
