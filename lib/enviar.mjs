import { CHAVE } from "@/components/Tranca";
import { listarEntrevistas, marcarEnviada, novoId } from "./db.mjs";
import { registrarErro } from "./registro.mjs";
import { daConta, pendentesDeEnvio, versaoDe } from "./sincronizar.mjs";

const APAGADAS = "entrevistas-apagadas";
let emCurso;
let deNovo = false;

export const ABERTA = "acesso-liberado";
const SEM_INTERNET = "Sem internet. Conecte o aparelho e tente de novo.";

// Isto tranca a tela, não protege o dado: quem abrir o devtools lê as entrevistas no IndexedDB.
export async function embaralhar(senha, sal) {
  const resumo = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${sal}:${senha}`));
  return [...new Uint8Array(resumo)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function postar(caminho, corpo, conta) {
  let resposta;
  try {
    resposta = await fetch(caminho, {
      method: "POST",
      signal: AbortSignal.timeout?.(30000),
      headers: { "content-type": "application/json", ...(conta && { authorization: `Bearer ${conta.id}.${conta.segredo}` }) },
      body: JSON.stringify(corpo),
    });
  } catch (erro) {
    if (erro instanceof TypeError || erro?.name === "TimeoutError") throw new Error(SEM_INTERNET);
    throw erro;
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(dados.erro || `O servidor recusou (HTTP ${resposta.status}).`);
  return dados;
}

export async function acessar(caminho, campos) {
  const dados = await postar(caminho, campos);
  const sal = crypto.randomUUID();
  const conta = { nome: dados.nome, usuario: dados.usuario, sal, resumo: await embaralhar(campos.senha, sal), id: dados.id, segredo: dados.token, registrada: true };
  localStorage.setItem(CHAVE, JSON.stringify(conta));
  return conta;
}

export async function vincular(usuario, senha) {
  await sincronizar();
  const conta = garantirIdentidade();
  if (!conta?.registrada) throw new Error("A conta ainda não chegou ao banco. Conecte à internet e tente de novo.");
  const dados = await postar("/api/conta/vincular", { usuario, senha }, conta);
  const sal = crypto.randomUUID();
  const atual = { ...garantirIdentidade(), usuario: dados.usuario, sal, resumo: await embaralhar(senha, sal) };
  localStorage.setItem(CHAVE, JSON.stringify(atual));
  return atual;
}

export async function buscarDoBanco() {
  const conta = garantirIdentidade();
  if (!conta?.id || !conta.segredo || navigator.onLine === false) return null;
  try {
    const resposta = await fetch("/api/painel", { signal: AbortSignal.timeout?.(30000), headers: { authorization: `Bearer ${conta.id}.${conta.segredo}` } });
    return resposta.ok ? await resposta.json() : null;
  } catch {
    return null;
  }
}

export const novoSegredo = () =>
  [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");

export function garantirIdentidade() {
  try {
    let conta = JSON.parse(localStorage.getItem(CHAVE) || "null");
    if (!conta) return null;
    if (!conta.id || !conta.segredo) {
      conta = { ...conta, id: novoId(), segredo: novoSegredo(), registrada: false };
      localStorage.setItem(CHAVE, JSON.stringify(conta));
    }
    return conta;
  } catch {
    return null;
  }
}

function lerApagadas() {
  try {
    const lista = JSON.parse(localStorage.getItem(APAGADAS) || "[]");
    return Array.isArray(lista) ? lista.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function guardarApagadas(lista) {
  try {
    localStorage.setItem(APAGADAS, JSON.stringify(lista));
  } catch {}
}

export const anotarApagada = (id) => guardarApagadas([...new Set([...lerApagadas(), id])]);

export async function sair() {
  const conta = garantirIdentidade();
  if (conta && !conta.usuario) return "Crie usuário e senha antes de sair: sem eles a conta não volta.";
  if (conta && (lerApagadas().length || pendentesDeEnvio(await listarEntrevistas()).some((e) => daConta(e, conta)))) {
    return "Há entrevistas ainda não enviadas ao banco. Conecte à internet e espere o envio antes de sair.";
  }
  localStorage.removeItem(CHAVE);
  sessionStorage.removeItem(ABERTA);
  return "";
}

async function enviar() {
  if (navigator.onLine === false) return;
  const conta = garantirIdentidade();
  if (!conta) return;
  const pendentes = pendentesDeEnvio(await listarEntrevistas()).filter((e) => daConta(e, conta));
  const apagadas = lerApagadas();
  if (!pendentes.length && !apagadas.length && conta.registrada) return;
  let marcou = false;
  try {
    const lotes = Math.max(1, Math.ceil(pendentes.length / 50), Math.ceil(apagadas.length / 500));
    for (let i = 0; i < lotes; i += 1) {
      const entrevistas = pendentes.slice(i * 50, (i + 1) * 50);
      const removidas = apagadas.slice(i * 500, (i + 1) * 500);
      let resposta;
      try {
        resposta = await fetch("/api/sincronizar", {
          method: "POST",
          signal: AbortSignal.timeout?.(30000),
          headers: { authorization: `Bearer ${conta.id}.${conta.segredo}`, "content-type": "application/json" },
          body: JSON.stringify({ nome: conta.nome, entrevistas, apagadas: removidas }),
        });
      } catch (erro) {
        if (erro instanceof TypeError || erro?.name === "TimeoutError") return false;
        throw erro;
      }
      if (!resposta.ok) {
        registrarErro("sincronizar", new Error(`HTTP ${resposta.status}`));
        return false;
      }
      const { ids } = await resposta.json();
      try {
        const atual = garantirIdentidade();
        if (atual?.id === conta.id) localStorage.setItem(CHAVE, JSON.stringify({ ...atual, registrada: true }));
      } catch {}
      for (const id of ids) {
        const entrevista = entrevistas.find((e) => e.id === id);
        if (!entrevista) continue;
        await marcarEnviada(id, versaoDe(entrevista));
        marcou = true;
      }
      guardarApagadas(lerApagadas().filter((id) => !removidas.includes(id)));
    }
  } finally {
    if (marcou) window.dispatchEvent(new Event("sincronizado"));
  }
}

export function sincronizar() {
  if (emCurso) {
    deNovo = true;
    return emCurso;
  }
  emCurso = (async () => {
    do {
      deNovo = false;
      if (await enviar() === false) break;
    } while (deNovo);
  })().finally(() => { emCurso = null; });
  return emCurso;
}
