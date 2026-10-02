import { celula } from "./exportar.mjs";
import { montarFormulario } from "./montar-formulario.mjs";
import { CATEGORIAS, rotuloCategoria, rotuloCargo, rotuloFaixa } from "./rotulos.mjs";

export const chaveComunidade = (texto) =>
  String(texto ?? "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const comunidadeDa = (entrevista) =>
  String(entrevista.respostas.comunidade ?? "").trim() ||
  String(entrevista.respostas.assentamento_nome ?? "").trim();

function diaLocal(iso) {
  const data = new Date(iso);
  return [
    String(data.getFullYear()).padStart(4, "0"),
    String(data.getMonth() + 1).padStart(2, "0"),
    String(data.getDate()).padStart(2, "0"),
  ].join("-");
}

export function mapaDeVisao(banco, entrevistas) {
  const presentes = new Set(entrevistas.map((e) => e.perfil.categoria).filter(Boolean));
  const categorias = [...new Set([...CATEGORIAS.map((c) => c.valor), ...presentes])].filter((c) => presentes.has(c));
  const formularios = entrevistas.map((e) => montarFormulario(banco, e.perfil, e.respostas));
  const linhas = banco.perguntas.filter((p) => p.tipo === "escala").map((pergunta) => {
    const porCategoria = Object.fromEntries(categorias.map((c) => [c, { soma: 0, n: 0 }]));
    entrevistas.forEach((e, indice) => {
      const valor = pergunta.opcoes.indexOf(e.respostas[pergunta.id]) + 1;
      if (!valor || !porCategoria[e.perfil.categoria] || !formularios[indice].some((p) => p.id === pergunta.id)) return;
      porCategoria[e.perfil.categoria].soma += valor;
      porCategoria[e.perfil.categoria].n += 1;
    });
    const celulas = Object.fromEntries(Object.entries(porCategoria).map(([categoria, { soma, n }]) =>
      [categoria, { media: n ? soma / n : null, n }],
    ));
    const totais = Object.values(porCategoria);
    const n = totais.reduce((total, c) => total + c.n, 0);
    const medias = Object.values(celulas).filter((c) => c.n >= 2).map((c) => c.media);
    return {
      pergunta,
      celulas,
      mediaGeral: n ? totais.reduce((total, c) => total + c.soma, 0) / n : null,
      n,
      divergente: medias.length >= 2 && Math.max(...medias) - Math.min(...medias) >= 1.5 - 1e-9,
    };
  });
  return { categorias, linhas };
}

export function respostasAbertas(banco, entrevistas) {
  return banco.perguntas
    .filter((p) => p.tipo === "audio" || p.outro)
    .map((pergunta) => {
      const falas = [];
      let semTexto = 0;
      for (const entrevista of entrevistas) {
        if (!montarFormulario(banco, entrevista.perfil, entrevista.respostas).some((p) => p.id === pergunta.id)) continue;
        if (pergunta.outro && ![].concat(entrevista.respostas[pergunta.id] ?? []).includes(pergunta.outro)) continue;
        const resposta = entrevista.respostas[pergunta.outro ? `${pergunta.id}_outro` : pergunta.id];
        const texto = String(typeof resposta === "object" ? resposta?.texto ?? "" : resposta ?? "").trim();
        if (texto) {
          const perfil = entrevista.perfil;
          falas.push({
            texto,
            perfil: [rotuloCategoria(perfil.categoria), perfil.cargo ? rotuloCargo(perfil.cargo) : rotuloFaixa(perfil.faixa)]
              .filter(Boolean).join(" · "),
          });
        } else if (resposta?.audioId) semTexto += 1;
      }
      falas.sort((a, b) => a.texto.localeCompare(b.texto, "pt-BR"));
      return { pergunta, falas, semTexto };
    });
}

export function cobertura(entrevistas) {
  const porChave = new Map();
  for (const entrevista of entrevistas) {
    const rotulo = comunidadeDa(entrevista) || "Sem comunidade";
    const chave = chaveComunidade(comunidadeDa(entrevista));
    if (!porChave.has(chave)) porChave.set(chave, { chave, rotulo });
  }
  const comunidades = [...porChave.values()];
  const linhas = CATEGORIAS.map(({ valor: categoria }) => ({
    categoria,
    contagem: Object.fromEntries(comunidades.map(({ chave }) => [chave,
      entrevistas.filter((e) => e.perfil.categoria === categoria && chaveComunidade(comunidadeDa(e)) === chave).length,
    ])),
  }));
  return { comunidades, linhas };
}

export function filtrar(entrevistas, filtro) {
  // A chave vazia seleciona quem está sem comunidade; null ou undefined incluem todas.
  return entrevistas.filter((e) =>
    ["categoria", "faixa", "genero"].every((eixo) => !filtro[eixo] || e.perfil[eixo] === filtro[eixo]) &&
    (filtro.comunidade === undefined || filtro.comunidade === null || chaveComunidade(comunidadeDa(e)) === filtro.comunidade) &&
    (!filtro.entrevistador || e.entrevistador === filtro.entrevistador) &&
    (!filtro.desde || diaLocal(e.iniciadaEm) >= filtro.desde) &&
    (!filtro.ate || diaLocal(e.iniciadaEm) <= filtro.ate),
  );
}

export function csvConsolidado(linhas) {
  const cabecalho = ["pergunta", "opção", "total", "alcance", "%"];
  const dados = linhas.flatMap(({ pergunta, alcance, contagem }) => contagem.map(({ opcao, total }) =>
    [pergunta.texto, opcao, total, alcance, alcance ? Math.round(total / alcance * 100) : 0].map(celula).join(","),
  ));
  return "\uFEFF" + [cabecalho.map(celula).join(","), ...dados].join("\r\n");
}
