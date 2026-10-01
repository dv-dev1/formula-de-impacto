import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { agruparPorSecao, idadeForaDaFaixa, limparOrfas, montarFormulario, progresso, respondida } from "../lib/montar-formulario.mjs";

const banco = JSON.parse(readFileSync(new URL("../data/perguntas.json", import.meta.url)));
const ids = (perfil, respostas) => montarFormulario(banco, perfil, respostas).map((p) => p.id);

const agricultorJovem = { categoria: "agricultor", faixa: "jovem", genero: "masculino" };
const prefeito = { categoria: "poder_publico", cargo: "prefeito", faixa: "adulto", genero: "masculino" };
const lideranca = { categoria: "lideranca", genero: "feminino" };

test("agricultor jovem recebe a pergunta de permanência no campo", () => {
  assert.ok(ids(agricultorJovem).includes("jovem_permanencia"));
});

test("prefeito não recebe pergunta de juventude nem de produção", () => {
  const doPrefeito = ids(prefeito);
  assert.ok(!doPrefeito.includes("jovem_permanencia"));
  assert.ok(!doPrefeito.includes("escoamento"));
  assert.ok(doPrefeito.includes("gestao_politica_rural"));
});

test("pergunta sem tag `quando` vai para todo perfil", () => {
  for (const perfil of [agricultorJovem, prefeito]) {
    assert.ok(ids(perfil).includes("qualidade_de_vida"), JSON.stringify(perfil));
  }
});

test("condicional de escoamento só abre quando a produção não escoa toda", () => {
  assert.ok(!ids(agricultorJovem, { escoamento: "Sim, toda" }).includes("escoamento_obstaculo"));
  assert.ok(ids(agricultorJovem, { escoamento: "Só uma parte" }).includes("escoamento_obstaculo"));
});

test("condicional fechada antes de responder a pergunta que a governa", () => {
  assert.ok(!ids(agricultorJovem, {}).includes("escoamento_obstaculo"));
});

test("condicional aceita resposta de múltipla escolha", () => {
  const comVenda = ids(agricultorJovem, { destino_producao: "Só venda" });
  assert.ok(comVenda.includes("canais_venda"));
});

test("mulher assentada recebe o bloco de autonomia; homem não", () => {
  const base = { categoria: "assentado", faixa: "adulto" };
  assert.ok(ids({ ...base, genero: "feminino" }).includes("renda_propria"));
  assert.ok(!ids({ ...base, genero: "masculino" }).includes("renda_propria"));
});

// Prende o tamanho de hoje: pergunta nova que estoura a entrevista em campo tem que ser decisão,
// não efeito colateral de editar o JSON.
test("todo perfil fica entre 23 e 41 perguntas", () => {
  const perfis = [];
  for (const categoria of ["agricultor", "quilombola", "assentado"]) {
    for (const faixa of ["jovem", "adulto"]) {
      for (const genero of ["masculino", "feminino"]) perfis.push({ categoria, faixa, genero });
    }
  }
  const cargos = ["prefeito", "cultura", "administracao", "desenvolvimento_meio_ambiente", "financas"];
  for (const cargo of cargos) {
    perfis.push({ categoria: "poder_publico", cargo, faixa: "adulto", genero: "masculino" });
  }
  for (const categoria of ["lideranca", "cooperativa", "ater", "instituicao_financeira", "outro_ator"]) {
    perfis.push({ categoria, genero: "feminino" });
  }
  for (const perfil of perfis) {
    const total = ids(perfil).length;
    assert.ok(total >= 23 && total <= 41, `${JSON.stringify(perfil)} gerou ${total}`);
  }
});

test("ator sem faixa recebe a visão do território e nenhum bloco de produtor ou de jovem", () => {
  const doLider = ids(lideranca);
  assert.ok(doLider.includes("articulacao_atores"));
  assert.ok(doLider.includes("consideracoes_finais"));
  assert.ok(!doLider.includes("jovem_permanencia"));
  assert.ok(!doLider.includes("escoamento"));
});

test("prefeito recebe a articulação entre atores no lugar da conversa entre secretarias", () => {
  assert.ok(ids(prefeito).includes("articulacao_atores"));
  assert.ok(!ids(prefeito).includes("gestao_articulacao"));
});

test("texto de Outra some quando Outra é desmarcada e fica enquanto marcada", () => {
  const marcada = { agregacao_valor: ["Beneficiamento", "Outra"], agregacao_valor_outro: "Mel em sachê" };
  assert.equal(limparOrfas(banco, lideranca, marcada).agregacao_valor_outro, "Mel em sachê");
  const desmarcada = { ...marcada, agregacao_valor: ["Beneficiamento"] };
  assert.ok(!("agregacao_valor_outro" in limparOrfas(banco, lideranca, desmarcada)));
});

test("texto de Outro funciona em escolha única", () => {
  const respostas = { segmento_produtivo: "Outro", segmento_produtivo_outro: "Pesca artesanal" };
  assert.equal(limparOrfas(banco, lideranca, respostas).segmento_produtivo_outro, "Pesca artesanal");
  const trocada = { ...respostas, segmento_produtivo: "Turismo" };
  assert.ok(!("segmento_produtivo_outro" in limparOrfas(banco, lideranca, trocada)));
});

test("ids do banco são únicos e toda condicional aponta para pergunta existente", () => {
  const todos = banco.perguntas.map((p) => p.id);
  assert.equal(new Set(todos).size, todos.length);
  for (const pergunta of banco.perguntas) {
    if (pergunta.se) assert.ok(todos.includes(pergunta.se.pergunta), pergunta.id);
  }
});

test("toda opção de uma condicional existe na pergunta que a governa", () => {
  for (const pergunta of banco.perguntas.filter((p) => p.se)) {
    const governante = banco.perguntas.find((p) => p.id === pergunta.se.pergunta);
    for (const valor of pergunta.se.responder) {
      assert.ok(governante.opcoes.includes(valor), `${pergunta.id} espera "${valor}"`);
    }
  }
});

test("resposta órfã sai quando a condição que a abriu deixa de valer", () => {
  const respostas = { escoamento: "Só uma parte", escoamento_obstaculo: ["Estrada ruim"] };
  const limpas = limparOrfas(banco, agricultorJovem, { ...respostas, escoamento: "Sim, toda" });
  assert.ok(!("escoamento_obstaculo" in limpas));
  assert.equal(limpas.escoamento, "Sim, toda");
});

test("seções saem agrupadas e na ordem do banco", () => {
  const secoes = agruparPorSecao(montarFormulario(banco, agricultorJovem));
  assert.equal(secoes[0].nome, "Identificação");
  assert.equal(new Set(secoes.map((s) => s.nome)).size, secoes.length);
});

test("progresso conta áudio gravado como resposta e texto vazio como pendência", () => {
  const perguntas = montarFormulario(banco, agricultorJovem);
  assert.deepEqual(progresso(perguntas, {}), { feitas: 0, total: perguntas.length });
  const parcial = { nome: "  ", idade: 19, jovem_uma_mudanca: { audioId: "a1" }, desafios_territorio: [] };
  assert.equal(progresso(perguntas, parcial).feitas, 2);
});

test("resposta aberta só digitada conta como respondida, sem áudio nenhum", () => {
  const pergunta = { id: "melhoria_renda", tipo: "audio" };
  assert.equal(respondida(pergunta, { texto: "Precisaria de estrada melhor." }), true);
  assert.equal(respondida(pergunta, { audioId: "a1" }), true);
  assert.equal(respondida(pergunta, { texto: "   " }), false);
  assert.equal(respondida(pergunta, {}), false);
});

test("progresso conta a pergunta aberta respondida por escrito", () => {
  const perguntas = [
    { id: "melhoria_renda", tipo: "audio" },
    { id: "nome", tipo: "texto" },
  ];
  assert.deepEqual(progresso(perguntas, { melhoria_renda: { texto: "Estrada." } }), { feitas: 1, total: 2 });
});

test("limparOrfas mantém resposta de pergunta que saiu do banco numa versão nova", () => {
  const respostas = limparOrfas(banco, agricultorJovem, { nome: "João", pergunta_antiga: "Sim" });
  assert.equal(respostas.pergunta_antiga, "Sim");
});

test("idade acima de 29 com faixa jovem, ou até 29 com faixa adulto, pede conferência", () => {
  const adulto = { ...agricultorJovem, faixa: "adulto" };
  assert.equal(idadeForaDaFaixa(agricultorJovem, { idade: "34" }), true);
  assert.equal(idadeForaDaFaixa(agricultorJovem, { idade: "29" }), false);
  assert.equal(idadeForaDaFaixa(adulto, { idade: "29" }), true);
  assert.equal(idadeForaDaFaixa(adulto, { idade: "30" }), false);
});

test("sem idade ou poder público não gera aviso de faixa", () => {
  assert.equal(idadeForaDaFaixa(agricultorJovem, {}), false);
  assert.equal(idadeForaDaFaixa(prefeito, { idade: "25" }), false);
});

test("ator que entrou sem faixa não recebe aviso de idade", () => {
  assert.equal(idadeForaDaFaixa(lideranca, { idade: "25" }), false);
});
