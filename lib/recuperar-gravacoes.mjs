import { apagarAudio, apagarPedacos, listarPedacos, novoId, obterEntrevista, salvarAudio, salvarEntrevista } from "./db.mjs";
import { agruparPedacos, decidirRecuperacao } from "./gravacao.mjs";
import { registrarErro } from "./registro.mjs";
import { enfileirar, semTranscricaoAntiga } from "./transcrever.mjs";

let rodada = null;

export async function anexarAudio(entrevistaId, perguntaId, audioId, duracao) {
  const entrevista = await obterEntrevista(entrevistaId);
  if (!entrevista) return false;
  await salvarEntrevista({
    ...entrevista,
    respostas: {
      ...entrevista.respostas,
      [perguntaId]: { ...semTranscricaoAntiga(entrevista.respostas?.[perguntaId]), audioId, duracao },
    },
  });
  return true;
}

export function recuperarGravacoes() {
  rodada ??= recuperar().finally(() => (rodada = null));
  return rodada;
}

async function recuperar() {
  const ativas = new Set(((await navigator.locks?.query?.())?.held ?? []).map((l) => l.name));
  for (const grupo of agruparPedacos(await listarPedacos())) {
    if (ativas.has(`gravacao-${grupo.gravacaoId}`)) continue;
    let audioSalvo = null;
    let anexado = false;
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
      audioSalvo = audioId;
      entrevista = await obterEntrevista(grupo.entrevistaId);
      if (decidirRecuperacao(grupo, entrevista) === "descartar") {
        await apagarAudio(audioId);
        await apagarPedacos(grupo.gravacaoId);
        registrarErro("recuperacao", `Gravação ${grupo.gravacaoId} descartada: entrevista ausente, resposta já tem áudio ou pedaço inicial ausente.`);
        continue;
      }
      const duracao = grupo.partes.length * 10;
      anexado = await anexarAudio(grupo.entrevistaId, grupo.perguntaId, audioId, duracao);
      if (!anexado) throw new Error(`Entrevista ${grupo.entrevistaId} ausente ao anexar gravação.`);
      window.dispatchEvent(new CustomEvent("recuperado", {
        detail: { entrevistaId: grupo.entrevistaId, perguntaId: grupo.perguntaId, audioId, duracao },
      }));
      enfileirar(grupo.entrevistaId, grupo.perguntaId, audioId);
      await apagarPedacos(grupo.gravacaoId);
    } catch (erro) {
      if (audioSalvo && !anexado) await apagarAudio(audioSalvo).catch(() => {});
      registrarErro("recuperacao", erro);
    }
  }
}
