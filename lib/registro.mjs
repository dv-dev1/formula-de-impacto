import banco from "../data/perguntas.json";
import { listarEntrevistas } from "./db.mjs";
import { pendentes } from "./transcrever.mjs";

export const ULTIMA_EXPORTACAO = "ultima-exportacao";

const CHAVE = "registro-erros";

export const errosRecentes = () => {
  try {
    const erros = JSON.parse(localStorage.getItem(CHAVE) || "[]");
    return Array.isArray(erros) ? erros.filter((e) => e && typeof e.mensagem === "string").slice(-50) : [];
  } catch {
    return [];
  }
};

export const registrarErro = (onde, erro) => {
  try {
    const registro = { quando: new Date().toISOString(), onde, mensagem: String(erro?.message ?? erro) };
    localStorage.setItem(CHAVE, JSON.stringify([...errosRecentes(), registro].slice(-50)));
  } catch {}
};

const tentar = async (tarefa) => {
  try {
    return await tarefa() ?? null;
  } catch {
    return null;
  }
};

export const infoDoAparelho = async () => {
  const [persistido, estimate, entrevistas, fila, ultimaExportacao, swAtivo, userAgent] = await Promise.all([
    tentar(() => navigator.storage?.persisted?.()),
    tentar(() => navigator.storage?.estimate?.()),
    tentar(listarEntrevistas),
    tentar(pendentes),
    tentar(() => localStorage.getItem(ULTIMA_EXPORTACAO)),
    tentar(() => Boolean(navigator.serviceWorker?.controller)),
    tentar(() => navigator.userAgent),
  ]);
  return {
    versao: process.env.NEXT_PUBLIC_VERSAO,
    bancoVersao: banco.versao,
    swAtivo: swAtivo ?? false,
    persistido,
    estimate: { usado: estimate?.usage ?? null, cota: estimate?.quota ?? null },
    entrevistas: {
      total: entrevistas?.length ?? null,
      concluidas: entrevistas?.filter((e) => e.concluidaEm).length ?? null,
    },
    transcricoesPendentes: Array.isArray(fila) ? fila.length : 0,
    ultimaExportacao,
    userAgent,
    erros: errosRecentes(),
  };
};
