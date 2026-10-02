import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { consolidar } from "../lib/exportar.mjs";
import { CATEGORIAS } from "../lib/rotulos.mjs";
import { chaveComunidade, cobertura, csvConsolidado, filtrar, mapaDeVisao, respostasAbertas } from "../lib/territorio.mjs";

process.env.TZ = "America/Sao_Paulo";

const banco = JSON.parse(readFileSync(new URL("../data/perguntas.json", import.meta.url)));
const entrevista = (id, categoria, respostas = {}, outros = {}) => ({
  id,
  perfil: { categoria, faixa: "adulto", genero: "feminino" },
  respostas,
  iniciadaEm: "2026-10-01T12:00:00.000Z",
  ...outros,
});
const escala = (entrevistas) => mapaDeVisao(banco, entrevistas).linhas.find((l) => l.pergunta.id === "qualidade_de_vida");

test("mapa de visão calcula média e n por categoria e média geral ponderada", () => {
  const entrevistas = [
    entrevista("a", "agricultor", { qualidade_de_vida: "Ruim" }),
    entrevista("b", "agricultor", { qualidade_de_vida: "Boa" }),
    entrevista("c", "ater", { qualidade_de_vida: "Muito boa" }),
    entrevista("d", "ater", { qualidade_de_vida: "inválida" }),
    entrevista("e", "lideranca"),
  ];
  const mapa = mapaDeVisao(banco, entrevistas);
  const linha = escala(entrevistas);
  assert.deepEqual(mapa.categorias, ["agricultor", "lideranca", "ater"]);
  assert.equal(mapa.linhas.length, banco.perguntas.filter((p) => p.tipo === "escala").length);
  assert.deepEqual(linha.celulas.agricultor, { media: 3, n: 2 });
  assert.deepEqual(linha.celulas.ater, { media: 5, n: 1 });
  assert.deepEqual(linha.celulas.lideranca, { media: null, n: 0 });
  assert.equal(linha.n, 3);
  assert.equal(linha.mediaGeral, 11 / 3);
  assert.equal(escala([]).mediaGeral, null);
  assert.equal(mapa.linhas.find((l) => l.pergunta.id === "gestao_estradas").n, 0);
});

test("divergência exige n de pelo menos 2 e diferença de pelo menos 1,5", () => {
  const baixas = ["a", "b"].map((id) => entrevista(id, "agricultor", { qualidade_de_vida: "Ruim" }));
  const altas = [
    entrevista("c", "ater", { qualidade_de_vida: "Regular" }),
    entrevista("d", "ater", { qualidade_de_vida: "Boa" }),
  ];
  assert.equal(escala([...baixas, ...altas]).divergente, true);
  assert.equal(escala([...baixas, altas[1], altas[1]]).divergente, true);
  assert.equal(escala([baixas[0], altas[1]]).divergente, false);
  assert.equal(escala([baixas[0], entrevista("e", "ater", { qualidade_de_vida: "Muito boa" })]).divergente, false);
  assert.equal(escala([...baixas, altas[1]]).divergente, false);
  assert.equal(escala([...baixas, altas[0], altas[0]]).divergente, false);
});

test("respostas abertas excluem identificação e localização, mostram perfil e contam áudio sem texto", () => {
  const e = entrevista("a", "agricultor", {
    nome: "Maria Identificável", comunidade: "Sítio Novo", telefone: "88999999999", contato: "Maria Identificável",
    melhoria_renda: { texto: "Melhorar a estrada", audioId: "transcrito" },
    consideracoes_finais: { audioId: "pendente", texto: "   " },
    oportunidades_3_anos: { texto: "Vender na feira" },
    segmento_produtivo: "Outro", segmento_produtivo_outro: "Apicultura",
    agregacao_valor: ["Nenhuma"], agregacao_valor_outro: "Resposta antiga",
  });
  const gestor = entrevista("b", "poder_publico", { gestao_gargalo: { texto: "Falta equipe" } }, {
    perfil: { categoria: "poder_publico", cargo: "prefeito" },
  });
  const comContato = { perguntas: [...banco.perguntas, ...["telefone", "contato"].map((id) => ({ id, tipo: "texto" }))] };
  const abertas = respostasAbertas(comContato, [e, gestor]);
  assert.ok(!JSON.stringify(abertas).includes("Maria Identificável"));
  assert.ok(!JSON.stringify(abertas).includes("88999999999"));
  assert.ok(abertas.every(({ pergunta }) => !["nome", "comunidade", "assentamento_nome", "telefone", "contato"].includes(pergunta.id)));
  assert.deepEqual(abertas.find((l) => l.pergunta.id === "melhoria_renda").falas,
    [{ texto: "Melhorar a estrada", perfil: "Agricultor(a) familiar · Adulto" }]);
  assert.equal(abertas.find((l) => l.pergunta.id === "consideracoes_finais").semTexto, 1);
  assert.equal(abertas.find((l) => l.pergunta.id === "melhoria_renda").semTexto, 0);
  assert.equal(abertas.find((l) => l.pergunta.id === "segmento_produtivo").falas[0].texto, "Apicultura");
  assert.deepEqual(abertas.find((l) => l.pergunta.id === "agregacao_valor").falas, []);
  assert.equal(abertas.find((l) => l.pergunta.id === "gestao_gargalo").falas[0].perfil, "Poder público · Prefeito(a)");
});

test("falas seguem a ordem do texto em vez da ordem dos entrevistados", () => {
  const abertas = respostasAbertas(banco, [
    entrevista("a", "agricultor", { nome: "Maria", melhoria_renda: { texto: "Vender na feira" } }),
    entrevista("b", "agricultor", { nome: "João", melhoria_renda: { texto: "Água para produzir" } }),
  ]);
  assert.deepEqual(abertas.find((l) => l.pergunta.id === "melhoria_renda").falas, [
    { texto: "Água para produzir", perfil: "Agricultor(a) familiar · Adulto" },
    { texto: "Vender na feira", perfil: "Agricultor(a) familiar · Adulto" },
  ]);
});

test("divergência reconhece o limiar de 1,5 com médias 8/3 e 7/6", () => {
  const opcoes = banco.perguntas.find((p) => p.id === "qualidade_de_vida").opcoes;
  const altas = [2, 3, 3].map((valor, indice) => entrevista(`alta-${indice}`, "agricultor", { qualidade_de_vida: opcoes[valor - 1] }));
  const baixas = [1, 1, 1, 1, 1, 2].map((valor, indice) => entrevista(`baixa-${indice}`, "ater", { qualidade_de_vida: opcoes[valor - 1] }));
  const linha = escala([...altas, ...baixas]);
  assert.deepEqual(linha.celulas.agricultor, { media: 8 / 3, n: 3 });
  assert.deepEqual(linha.celulas.ater, { media: 7 / 6, n: 6 });
  assert.equal(linha.divergente, true);
});

test("cobertura junta grafias da comunidade, usa assentamento e inclui as 9 categorias com zero", () => {
  const matriz = cobertura([
    entrevista("a", "agricultor", { comunidade: "Sítio Novo" }),
    entrevista("b", "agricultor", { comunidade: " sitio novo " }),
    entrevista("c", "assentado", { comunidade: "  ", assentamento_nome: "SÍTIO NOVO" }),
    entrevista("d", "ater"),
  ]);
  assert.equal(chaveComunidade(" Sítio Novo "), "sitio novo");
  assert.deepEqual(matriz.comunidades, [{ chave: "sitio novo", rotulo: "Sítio Novo" }, { chave: "", rotulo: "Sem comunidade" }]);
  assert.deepEqual(matriz.linhas.map((l) => l.categoria), CATEGORIAS.map((c) => c.valor));
  assert.equal(matriz.linhas.find((l) => l.categoria === "agricultor").contagem["sitio novo"], 2);
  assert.equal(matriz.linhas.find((l) => l.categoria === "assentado").contagem["sitio novo"], 1);
  assert.equal(matriz.linhas.find((l) => l.categoria === "quilombola").contagem["sitio novo"], 0);
  assert.equal(matriz.linhas.find((l) => l.categoria === "ater").contagem[""], 1);
});

test("filtro combina comunidade, entrevistador, período inclusivo e os eixos existentes", () => {
  const lista = [
    entrevista("a", "agricultor", { comunidade: "Sítio Novo" }, { entrevistador: "Ana", iniciadaEm: "2026-09-01T12:00:00Z" }),
    entrevista("b", "assentado", { assentamento_nome: " sitio novo " }, { entrevistador: "Bia", iniciadaEm: "2026-09-30T23:59:59Z" }),
    entrevista("c", "ater", { comunidade: "Outra" }, { entrevistador: "Ana" }),
    entrevista("d", "agricultor"),
  ];
  const ids = (filtro) => filtrar(lista, filtro).map((e) => e.id);
  assert.deepEqual(ids({ comunidade: "sitio novo" }), ["a", "b"]);
  assert.deepEqual(ids({ comunidade: "" }), ["d"]);
  assert.deepEqual(ids({ entrevistador: "Ana" }), ["a", "c"]);
  assert.deepEqual(ids({ desde: "2026-09-01", ate: "2026-09-30" }), ["a", "b"]);
  assert.deepEqual(ids({ comunidade: "sitio novo", entrevistador: "Ana", desde: "2026-09-01", ate: "2026-09-01",
    categoria: "agricultor", faixa: "adulto", genero: "feminino" }), ["a"]);
  assert.deepEqual(ids({ genero: "masculino" }), []);
  assert.deepEqual(ids({ desde: "2026-10-02" }), []);
  assert.deepEqual(ids({}), ["a", "b", "c", "d"]);
});

test("período usa o dia local para entrevista de 31/12 às 22h em Brasília", () => {
  const e = entrevista("virada", "agricultor", {}, {
    iniciadaEm: new Date("2026-12-31T22:00:00-03:00").toISOString(),
  });
  assert.deepEqual(filtrar([e], { desde: "2026-12-31", ate: "2026-12-31" }), [e]);
  assert.deepEqual(filtrar([e], { desde: "2027-01-01", ate: "2027-01-01" }), []);
});

test("CSV do consolidado tem BOM, cabeçalho, percentual e escapa vírgula e aspas", () => {
  const csv = csvConsolidado([{ pergunta: { texto: 'Água, "como está?"' }, alcance: 4,
    contagem: [{ opcao: "Boa, o ano todo", total: 2 }] }]);
  assert.equal(csv, '\uFEFF"pergunta","opção","total","alcance","%"\r\n"Água, ""como está?""","Boa, o ano todo","2","4","50"');
  assert.ok(csvConsolidado([{ pergunta: { texto: "Vazia" }, alcance: 0, contagem: [{ opcao: "A", total: 0 }] }]).endsWith('"0","0","0"'));
});

test("múltipla ordena por total com empate no banco; única e escala mantêm a ordem", () => {
  const perguntas = ["multipla", "unica", "escala"].map((tipo) => ({ id: tipo, tipo, opcoes: ["A", "B", "C", "D"] }));
  const linhas = consolidar({ perguntas }, [
    entrevista("a", "agricultor", { multipla: ["B", "C", "D"], unica: "D", escala: "D" }),
    entrevista("b", "agricultor", { multipla: ["D"], unica: "D", escala: "D" }),
  ]);
  assert.deepEqual(linhas[0].contagem.map((c) => c.opcao), ["D", "B", "C", "A"]);
  assert.deepEqual(linhas[0].contagem.map((c) => c.total), [2, 1, 1, 0]);
  assert.deepEqual(linhas[1].contagem.map((c) => c.opcao), ["A", "B", "C", "D"]);
  assert.deepEqual(linhas[2].contagem.map((c) => c.opcao), ["A", "B", "C", "D"]);
});
