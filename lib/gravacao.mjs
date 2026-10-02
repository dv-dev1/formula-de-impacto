export function agruparPedacos(pedacos) {
  const grupos = new Map();
  for (const pedaco of pedacos) {
    if (!grupos.has(pedaco.gravacaoId)) grupos.set(pedaco.gravacaoId, []);
    grupos.get(pedaco.gravacaoId).push(pedaco);
  }
  return [...grupos].map(([gravacaoId, pedacos]) => {
    const partes = [...pedacos].sort((a, b) => a.indice - b.indice);
    const { entrevistaId, perguntaId, mimeType, extensao } = partes[0];
    return { gravacaoId, entrevistaId, perguntaId, mimeType, extensao, partes };
  });
}

export const decidirRecuperacao = (grupo, entrevista) =>
  grupo.partes[0]?.indice === 0 && entrevista && !entrevista.respostas?.[grupo.perguntaId]?.audioId ? "anexar" : "descartar";
