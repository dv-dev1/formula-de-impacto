import { apagarPedacos, listarPedacos, novoId, obterEntrevista, salvarAudio, salvarEntrevista } from "./db.mjs";
import { agruparPedacos, decidirRecuperacao } from "./gravacao.mjs";
import { registrarErro } from "./registro.mjs";
import { enfileirar } from "./transcrever.mjs";

let rodada = null;

export function recuperarGravacoes() {
  rodada ??= recuperar().finally(() => (rodada = null));
  return rodada;
}

async function recuperar() {
  const ativas = new Set(((await navigator.locks?.query?.())?.held ?? []).map((l) => l.name));
  for (const grupo of agruparPedacos(await listarPedacos())) {
    if (ativas.has(`gravacao-${grupo.gravacaoId}`)) continue;
    try {
      let entrevista = await obterEntrevista(grupo.entrevistaId);
      if (decidirRecuperacao(grupo, entrevista) === "descartar") {
        await apagarPedacos(grupo.gravacaoId);
        registrarErro("recuperacao", `Gravação ${grupo.gravacaoId} descartada: entrevista ausente, resposta já tem áudio ou pedaço inicial ausente.`);
        continue;
      }
      const audioId = novoId();
      const blob = new Blob(grupo.partes.map((p) => p.blob), { type: grupo.mimeType });
      await salvarAudio({ id: audioId, entrevistaId: grupo.entrevistaId, perguntaId: grupo.perguntaId, blob, extensao: grupo.extensao });
      entrevista = await obterEntrevista(grupo.entrevistaId);
      if (decidirRecuperacao(grupo, entrevista) === "descartar") {
        await apagarPedacos(grupo.gravacaoId);
        registrarErro("recuperacao", `Gravação ${grupo.gravacaoId} descartada: entrevista ausente, resposta já tem áudio ou pedaço inicial ausente.`);
        continue;
      }
      const duracao = grupo.partes.length * 10;
      await salvarEntrevista({
        ...entrevista,
        respostas: {
          ...entrevista.respostas,
          [grupo.perguntaId]: { ...entrevista.respostas[grupo.perguntaId], audioId, duracao },
        },
      });
      window.dispatchEvent(new CustomEvent("recuperado", {
        detail: { entrevistaId: grupo.entrevistaId, perguntaId: grupo.perguntaId, audioId, duracao },
      }));
      enfileirar(grupo.entrevistaId, grupo.perguntaId, audioId);
      await apagarPedacos(grupo.gravacaoId);
    } catch (erro) {
      registrarErro("recuperacao", erro);
    }
  }
}
