import { CHAVE } from "@/components/Tranca";
import { listarEntrevistas, marcarEnviada, novoId } from "./db.mjs";
import { registrarErro } from "./registro.mjs";
import { daConta, pendentesDeEnvio, versaoDe } from "./sincronizar.mjs";

const APAGADAS = "entrevistas-apagadas";
let emCurso;

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
          headers: { authorization: `Bearer ${conta.id}.${conta.segredo}`, "content-type": "application/json" },
          body: JSON.stringify({ nome: conta.nome, entrevistas, apagadas: removidas }),
        });
      } catch (erro) {
        if (erro instanceof TypeError) return;
        throw erro;
      }
      if (!resposta.ok) {
        registrarErro("sincronizar", new Error(`HTTP ${resposta.status}`));
        return;
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
  if (!emCurso) emCurso = enviar().finally(() => { emCurso = null; });
  return emCurso;
}
