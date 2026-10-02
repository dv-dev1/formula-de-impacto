import { consolidar, duracaoMinutos } from "./exportar.mjs";
import { CATEGORIAS, FAIXAS, GENEROS } from "./rotulos.mjs";
import { cobertura, diaLocal } from "./territorio.mjs";

export function resumoDoPainel(banco, entrevistas) {
  const total = entrevistas.length;
  const concluidas = entrevistas.filter((e) => e.concluidaEm);
  const duracoes = concluidas.map(duracaoMinutos).filter((d) => d !== null);
  const contar = (itens, eixo) => itens.map(({ valor, rotulo }) => {
    const n = entrevistas.filter((e) => e.perfil[eixo] === valor).length;
    return { valor, rotulo, total: n, pct: total ? Math.round(n / total * 100) : 0 };
  }).filter((item) => item.total > 0).sort((a, b) => b.total - a.total);
  const porCategoria = contar(CATEGORIAS, "categoria");
  const matriz = cobertura(entrevistas);
  const comunidades = matriz.comunidades.filter((c) => c.chave !== "");
  const dias = new Map();
  for (const e of entrevistas) {
    const dia = diaLocal(e.iniciadaEm);
    dias.set(dia, (dias.get(dia) ?? 0) + 1);
  }
  const maioria = consolidar(banco, entrevistas).filter((linha) => linha.alcance >= 3).flatMap(({ pergunta, alcance, contagem }) => {
    const ordenadas = pergunta.opcoes.map((opcao) => contagem.find((c) => c.opcao === opcao));
    const lider = ordenadas.reduce((a, b) => b.total > a.total ? b : a);
    const opcao = ordenadas.filter((c) => c.total === lider.total).map((c) => c.opcao).join(" / ");
    return lider.total ? [{ pergunta, opcao, total: lider.total, alcance, pct: Math.round(lider.total / alcance * 100) }] : [];
  }).sort((a, b) => b.pct - a.pct || b.alcance - a.alcance);
  return {
    total,
    concluidas: concluidas.length,
    emAndamento: total - concluidas.length,
    duracaoMedia: duracoes.length ? Math.round(duracoes.reduce((soma, d) => soma + d, 0) / duracoes.length) : null,
    comunidades: comunidades.length,
    porCategoria,
    porGenero: contar(GENEROS, "genero"),
    porFaixa: contar(FAIXAS, "faixa"),
    maisOuvidos: porCategoria.filter((c) => c.total === porCategoria[0]?.total),
    porComunidade: comunidades.map(({ chave, rotulo }) => ({
      rotulo, total: matriz.linhas.reduce((soma, linha) => soma + linha.contagem[chave], 0),
    })).sort((a, b) => b.total - a.total),
    porDia: [...dias].sort(([a], [b]) => a.localeCompare(b)).map(([dia, n]) => ({ dia, total: n })),
    maioria,
    faltamOuvir: CATEGORIAS.filter((c) => !porCategoria.some((p) => p.valor === c.valor)).map((c) => c.rotulo),
  };
}
