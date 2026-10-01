const EIXOS = ["categoria", "cargo", "faixa", "genero"];

function cabeNoPerfil(pergunta, perfil) {
  const quando = pergunta.quando;
  if (!quando) return true;
  return EIXOS.every((eixo) => {
    const aceitos = quando[eixo];
    return !aceitos || aceitos.includes(perfil[eixo]);
  });
}

function condicaoSatisfeita(pergunta, respostas) {
  if (!pergunta.se) return true;
  const dada = respostas[pergunta.se.pergunta];
  if (dada === undefined || dada === null || dada === "") return false;
  const dadas = Array.isArray(dada) ? dada : [dada];
  return dadas.some((valor) => pergunta.se.responder.includes(valor));
}

// Uma pergunta condicional some quando a condição deixa de valer, e a resposta dela some junto:
// deixá-la para trás manda para o relatório um dado que o entrevistado nunca confirmou.
// Id que não existe mais no banco fica: é resposta dada numa versão anterior, não órfã.
// O texto de "Outro" não está no banco com o próprio id, e sem a regra da dona ficaria para sempre.
export function limparOrfas(banco, perfil, respostas) {
  const vivas = new Set(montarFormulario(banco, perfil, respostas).map((p) => p.id));
  const doBanco = new Set(banco.perguntas.map((p) => p.id));
  const donaDoOutro = new Map(banco.perguntas.filter((p) => p.outro).map((p) => [`${p.id}_outro`, p]));
  return Object.fromEntries(
    Object.entries(respostas).filter(([id]) => {
      const dona = donaDoOutro.get(id);
      if (dona) return vivas.has(dona.id) && [].concat(respostas[dona.id] ?? []).includes(dona.outro);
      return vivas.has(id) || !doBanco.has(id);
    }),
  );
}

export function idadeForaDaFaixa(perfil, respostas) {
  const idade = Number(respostas.idade);
  if (perfil.categoria === "poder_publico" || !perfil.faixa || !respostas.idade || Number.isNaN(idade)) return false;
  return perfil.faixa === "jovem" ? idade > 29 : idade <= 29;
}

export function montarFormulario(banco, perfil, respostas = {}) {
  return banco.perguntas.filter(
    (pergunta) => cabeNoPerfil(pergunta, perfil) && condicaoSatisfeita(pergunta, respostas),
  );
}

// Agrupa por nome, não por vizinhança: uma pergunta inserida fora do bloco da sua seção
// partiria a seção em duas no formulário, e ninguém liga isso ao lugar onde editou o JSON.
export function agruparPorSecao(perguntas) {
  const secoes = new Map();
  for (const pergunta of perguntas) {
    if (!secoes.has(pergunta.secao)) secoes.set(pergunta.secao, []);
    secoes.get(pergunta.secao).push(pergunta);
  }
  return [...secoes].map(([nome, lista]) => ({ nome, perguntas: lista }));
}

export function respondida(pergunta, resposta) {
  if (resposta === undefined || resposta === null) return false;
  if (Array.isArray(resposta)) return resposta.length > 0;
  // Pergunta aberta guarda um objeto com áudio, texto, ou os dois. Exigir o áudio deixava
  // de contar quem preferiu digitar: o progresso não subia, a ficha imprimia "não
  // respondida" e o botão de concluir ficava travado, com a resposta escrita na tela.
  if (typeof resposta === "object") {
    return Boolean(resposta.audioId) || String(resposta.texto ?? "").trim() !== "";
  }
  return String(resposta).trim() !== "";
}

export function progresso(perguntas, respostas) {
  const feitas = perguntas.filter((p) => respondida(p, respostas[p.id])).length;
  return { feitas, total: perguntas.length };
}
