import assert from "node:assert/strict";
import test from "node:test";

import { minhasEntrevistas, resumoDoPainel } from "../lib/painel.mjs";
import { CATEGORIAS } from "../lib/rotulos.mjs";

process.env.TZ = "America/Sao_Paulo";

const banco = { perguntas: [
  { id: "escala", texto: "Como está?", tipo: "escala", opcoes: ["Boa", "Ruim"] },
  { id: "multipla", texto: "O que falta?", tipo: "multipla", opcoes: ["Água", "Estrada", "Luz"] },
  { id: "restrita", texto: "Produção?", tipo: "unica", opcoes: ["Sim", "Não"], quando: { categoria: ["agricultor"] } },
  { id: "vazia", texto: "Sem respostas?", tipo: "unica", opcoes: ["A", "B"] },
] };
const entrevista = (id, categoria = "agricultor", respostas = {}, outros = {}) => ({
  id, perfil: { categoria, faixa: "adulto", genero: "feminino" }, respostas,
  iniciadaEm: "2026-10-01T12:00:00Z", ...outros,
});

test("painel calcula números, duração média, eixos e cobertura sem comunidade vazia", () => {
  const lista = [
    entrevista("a", "agricultor", { comunidade: "Sítio Novo" }, { concluidaEm: "2026-10-01T12:10:00Z" }),
    entrevista("b", "agricultor", { comunidade: "sitio novo" }, { concluidaEm: "2026-10-01T12:21:00Z" }),
    entrevista("c", "ater", { comunidade: "Outra" }, { perfil: { categoria: "ater", genero: "masculino" } }),
    entrevista("d", "assentado", { assentamento_nome: "Sítio Novo" }),
    entrevista("e", "lideranca"),
  ];
  const r = resumoDoPainel(banco, lista);
  assert.deepEqual([r.total, r.concluidas, r.emAndamento, r.duracaoMedia, r.comunidades], [5, 2, 3, 16, 2]);
  assert.deepEqual(r.porCategoria.map((c) => [c.valor, c.total, c.pct]), [["agricultor", 2, 40], ["assentado", 1, 20], ["lideranca", 1, 20], ["ater", 1, 20]]);
  assert.deepEqual(r.porGenero.map((c) => [c.valor, c.total, c.pct]), [["feminino", 4, 80], ["masculino", 1, 20]]);
  assert.deepEqual(r.porFaixa.map((c) => [c.valor, c.total, c.pct]), [["adulto", 4, 80], ["", 1, 20]]);
  assert.deepEqual(r.porComunidade, [{ rotulo: "Sítio Novo", total: 3 }, { rotulo: "Outra", total: 1 }]);
  assert.equal(resumoDoPainel(banco, []).duracaoMedia, null);
  assert.equal(resumoDoPainel(banco, [lista[2]]).duracaoMedia, null);
});

test("mais ouvidos inclui empate na ordem das categorias e fica vazio sem entrevistas", () => {
  const r = resumoDoPainel(banco, [entrevista("a", "ater"), entrevista("b"), entrevista("c", "ater"), entrevista("d")]);
  assert.deepEqual(r.maisOuvidos.map((c) => [c.valor, c.total, c.pct]), [["agricultor", 2, 50], ["ater", 2, 50]]);
  assert.deepEqual(resumoDoPainel(banco, []).maisOuvidos, []);
});

test("maioria ignora alcance menor que 3 e zero, e une empate na ordem do banco", () => {
  const r = resumoDoPainel(banco, [
    entrevista("a", "agricultor", { escala: "Boa", multipla: ["Estrada"], restrita: "Sim" }),
    entrevista("b", "agricultor", { escala: "Ruim", multipla: ["Água"], restrita: "Sim" }),
    entrevista("c", "ater", { escala: "Ruim", multipla: ["Luz"] }),
  ]);
  assert.deepEqual(r.maioria.map((l) => [l.pergunta.id, l.opcao, l.total, l.alcance, l.pct]),
    [["escala", "Ruim", 2, 3, 67], ["multipla", "Água / Estrada / Luz", 1, 3, 33]]);
});

test("maioria ordena percentual e depois alcance, com empate da escala na ordem do banco", () => {
  const lista = ["Boa", "Boa", "Ruim", "Ruim"].map((escala, i) => entrevista(String(i), i === 3 ? "ater" : "agricultor", { escala, restrita: "Sim" }));
  const r = resumoDoPainel(banco, lista);
  assert.deepEqual(r.maioria.map((l) => [l.pergunta.id, l.opcao, l.pct]), [["restrita", "Sim", 100], ["escala", "Boa / Ruim", 50]]);
  const igual = { perguntas: [
    { ...banco.perguntas[2], id: "menor" },
    { ...banco.perguntas[0], id: "maior" },
  ] };
  assert.deepEqual(resumoDoPainel(igual, lista.map((e) => ({ ...e, respostas: { menor: "Sim", maior: "Boa" } })))
    .maioria.map((l) => l.pergunta.id), ["maior", "menor"]);
});

test("por dia agrupa pelo dia local e ordena cronologicamente", () => {
  const r = resumoDoPainel(banco, [
    entrevista("a", "ater", {}, { iniciadaEm: "2027-01-01T01:00:00Z" }),
    entrevista("b", "ater", {}, { iniciadaEm: "2026-12-31T14:00:00Z" }),
    entrevista("c", "ater", {}, { iniciadaEm: "2026-12-30T14:00:00Z" }),
  ]);
  assert.deepEqual(r.porDia, [{ dia: "2026-12-30", total: 1 }, { dia: "2026-12-31", total: 2 }]);
});

test("faltam ouvir lista os rótulos das categorias com zero na ordem do banco", () => {
  assert.deepEqual(resumoDoPainel(banco, [entrevista("a")]).faltamOuvir, CATEGORIAS.slice(1).map((c) => c.rotulo));
  assert.deepEqual(resumoDoPainel(banco, []).faltamOuvir, CATEGORIAS.map((c) => c.rotulo));
});

test("minhasEntrevistas junta aparelho e banco só da conta, com a versão mais nova", () => {
  const conta = { id: "ana", nome: "Ana" };
  const base = { perfil: {}, respostas: {}, iniciadaEm: "2026-10-01T12:00:00Z" };
  const locais = [{ ...base, id: "a1", entrevistadorId: "ana", respostas: { nome: "velha" } }, { ...base, id: "x1", entrevistadorId: "bia" }];
  const doBanco = [
    { ...base, id: "a1", entrevistadorId: "ana", atualizadaEm: "2026-10-02T12:00:00Z", respostas: { nome: "nova" } },
    { ...base, id: "a2", entrevistadorId: "ana" },
    { ...base, id: "b1", entrevistadorId: "bia" },
  ];
  const minhas = minhasEntrevistas(conta, locais, doBanco);
  assert.deepEqual(minhas.map((e) => e.id).sort(), ["a1", "a2"]);
  assert.equal(minhas.find((e) => e.id === "a1").respostas.nome, "nova");
});

test("minhasEntrevistas exclui do banco entrevista com baixa pendente no aparelho", () => {
  const conta = { id: "ana", nome: "Ana" };
  const doBanco = ["apagada", "viva"].map((id) => entrevista(id, "ater", {}, { entrevistadorId: "ana" }));
  assert.deepEqual(minhasEntrevistas(conta, [], doBanco, ["apagada"]).map((e) => e.id), ["viva"]);
  assert.equal(doBanco.length, 2);
});
