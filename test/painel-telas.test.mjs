import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import swc from "next/dist/build/swc/index.js";
import React from "react";
import JSZip from "jszip";

import * as exportacao from "../lib/exportar.mjs";
import * as formulario from "../lib/montar-formulario.mjs";
import { EXTENSOES } from "../lib/formatos-audio.mjs";
import * as painel from "../lib/painel.mjs";
import * as rotulos from "../lib/rotulos.mjs";
import * as sincronizacao from "../lib/sincronizar.mjs";
import * as territorio from "../lib/territorio.mjs";

const CONTA = { id: "ana", nome: "Ana", usuario: "ana", segredo: "ab".repeat(32), registrada: true };
const codigo = (arquivo) => readFileSync(new URL(`../${arquivo}`, import.meta.url), "utf8").replace(/^import .*;$/gm, "").replace(/^export (default )?/gm, "");
const elementos = (arvore) => !arvore || typeof arvore !== "object" ? [] : Array.isArray(arvore) ? arvore.flatMap(elementos) : [arvore, ...elementos(arvore.props?.children)];
const texto = (arvore) => arvore == null || typeof arvore === "boolean" ? "" : typeof arvore !== "object" ? String(arvore) : Array.isArray(arvore) ? arvore.map(texto).join("") : texto(arvore.props?.children);
const expandir = (arvore) => !arvore || typeof arvore !== "object" ? arvore : Array.isArray(arvore) ? arvore.map(expandir) : typeof arvore.type === "function" ? expandir(arvore.type(arvore.props)) : { ...arvore, props: { ...arvore.props, children: expandir(arvore.props.children) } };
const entrevista = (id, outros = {}) => ({ id, entrevistadorId: "ana", entrevistador: "Ana", perfil: { categoria: "agricultor", faixa: "adulto", genero: "feminino" }, respostas: {}, iniciadaEm: "2026-10-01T12:00:00Z", ...outros });

async function tela(arquivo, nome, { locais = [], importadas = [], dados = { papel: "entrevistador", entrevistas: [] }, online = true, apagadas = [] } = {}) {
  const estados = [];
  const efeitos = [];
  const eventos = new Map();
  let indice = 0;
  let montada = false;
  let impressoes = 0;
  const contexto = {
    React, crypto, TextEncoder, TypeError, AbortSignal, Blob, File, JSZip, EXTENSOES,
    ...exportacao, ...formulario, ...painel, ...rotulos, ...sincronizacao, ...territorio,
    CHAVE: "acesso-formula-impacto", ULTIMA_EXPORTACAO: "ultima-exportacao",
    banco: JSON.parse(readFileSync(new URL("../data/perguntas.json", import.meta.url), "utf8")),
    localStorage: { getItem: (chave) => chave === "acesso-formula-impacto" ? JSON.stringify(CONTA) : chave === "entrevistas-apagadas" ? JSON.stringify(apagadas) : null, setItem() {} },
    navigator: { onLine: online },
    window: { addEventListener: (nome, acao) => eventos.set(nome, acao), removeEventListener: (nome) => eventos.delete(nome), print: () => { impressoes += 1; } },
    fetch: async () => Response.json(dados),
    listarEntrevistas: async () => locais, listarImportadas: async () => importadas,
    audiosDaEntrevista: async () => [], infoDoAparelho: async () => ({}),
    registrarErro: (origem, erro) => { throw new Error(`${origem}: ${erro.message}`); },
    useState: (inicial) => { const atual = indice++; if (!(atual in estados)) estados[atual] = inicial; return [estados[atual], (valor) => { estados[atual] = typeof valor === "function" ? valor(estados[atual]) : valor; }]; },
    useMemo: (calcular) => calcular(),
    useEffect: (efeito) => { if (!montada) efeitos.push(efeito); },
    useRouter: () => ({ prefetch() {} }), pendentes: () => [],
    Topo: "header", Icone: "svg", Link: "a",
  };
  Object.assign(contexto, runInNewContext(`(() => { ${codigo("lib/enviar.mjs")}\nreturn { buscarDoBanco, garantirIdentidade, lerApagadas }; })();`, contexto));
  Object.assign(contexto, runInNewContext(`(() => { ${codigo("lib/exportar.mjs")}\nreturn { montarZip }; })();`, contexto));
  const compilado = swc.transformSync(codigo(arquivo), { jsc: { parser: { syntax: "ecmascript", jsx: true }, target: "es2022", transform: { react: { runtime: "classic" } } } }).code;
  const componente = runInNewContext(`${compilado}\n${nome};`, contexto);
  const app = {
    contexto,
    render() { indice = 0; app.arvore = expandir(componente()); },
    buscar: (predicado, arvore = app.arvore) => elementos(arvore).find(predicado),
    async atualizar() { await new Promise((resolve) => setImmediate(resolve)); app.render(); },
    async evento(nome) { eventos.get(nome)(); await app.atualizar(); },
    impressoes: () => impressoes,
  };
  app.render();
  montada = true;
  efeitos.forEach((efeito) => efeito());
  await app.atualizar();
  return app;
}

const secao = (app, nome) => app.buscar((e) => e.type === "section" && e.props["aria-label"] === nome);
const numeros = (app, nome) => elementos(app.buscar((e) => e.props?.className === "numeros-painel", secao(app, nome))).filter((e) => e.type === "strong").map(texto);

test("painel de aparelho novo mostra entrevistas do banco e envio somente deste aparelho", async () => {
  const app = await tela("app/painel/page.jsx", "Painel", { dados: { papel: "entrevistador", entrevistas: [entrevista("a1")] } });
  assert.deepEqual(numeros(app, "Meu painel"), ["1", "0", "1", "—", "0"]);
  assert.match(texto(secao(app, "Meu painel")), /Deste aparelho, enviadas ao banco: 0 de 0/);
  assert.equal(secao(app, "Equipe"), undefined);
});

test("painel junta versões sem duplicar e separa conta do recorte da equipe", async () => {
  const local = entrevista("a1");
  const app = await tela("app/painel/page.jsx", "Painel", {
    locais: [local, entrevista("x1", { entrevistadorId: "bia", entrevistador: "Bia" })],
    dados: { papel: "coordenador", entrevistadores: [CONTA, { id: "bia", nome: "Bia" }], entrevistas: [
      entrevista("a1", { atualizadaEm: "2026-10-02T12:00:00Z", concluidaEm: "2026-10-01T12:10:00Z" }),
      entrevista("a2"), entrevista("b1", { entrevistadorId: "bia", entrevistador: "Bia" }),
    ] },
  });
  assert.deepEqual(numeros(app, "Meu painel").slice(0, 3), ["2", "1", "1"]);
  assert.equal(numeros(app, "Equipe")[0], "3");
  app.buscar((e) => e.type === "select").props.onChange({ target: { value: "bia" } }); app.render();
  assert.equal(numeros(app, "Equipe")[0], "1");
  assert.equal(texto(app.buscar((e) => e.type === "h2", secao(app, "Equipe"))), "Equipe — Bia");
  assert.ok(app.buscar((e) => e.props?.className === "filtros-territorio nao-imprime", secao(app, "Equipe")));
});

test("painel volta aos dados locais sem sinal e recupera banco ao voltar a rede", async () => {
  const app = await tela("app/painel/page.jsx", "Painel", { locais: [entrevista("a1")], dados: { papel: "entrevistador", entrevistas: [entrevista("a2")] } });
  assert.equal(numeros(app, "Meu painel")[0], "2");
  app.contexto.navigator.onLine = false;
  await app.evento("offline");
  assert.equal(numeros(app, "Meu painel")[0], "1");
  assert.match(texto(app.arvore), /Sem sinal: o painel mostra só este aparelho\./);
  app.contexto.navigator.onLine = true;
  await app.evento("online");
  assert.equal(numeros(app, "Meu painel")[0], "2");
});

test("Salvar em PDF chama impressão e relatório inclui data de geração", async () => {
  const app = await tela("app/painel/page.jsx", "Painel");
  const botao = app.buscar((e) => e.type === "button" && texto(e) === "Salvar em PDF");
  assert.ok(botao, "Painel precisa oferecer Salvar em PDF");
  botao.props.onClick();
  assert.equal(app.impressoes(), 1);
  assert.equal(texto(app.buscar((e) => e.props?.className === "cabecalho-territorio")), `Gerado em ${new Date().toLocaleDateString("pt-BR")}`);
  assert.ok(app.buscar((e) => e.props?.className === "rodape nao-imprime"));
});

test("consolidado junta locais, banco e importadas pela versão mais nova e conta outros aparelhos", async () => {
  const app = await tela("app/consolidado/page.jsx", "Consolidado", {
    locais: [entrevista("a1")],
    dados: { papel: "entrevistador", entrevistas: [entrevista("a1", { atualizadaEm: "2026-10-02T12:00:00Z", respostas: { comunidade: "Banco" } }), entrevista("a2"), entrevista("a4")] },
    importadas: [entrevista("a1"), entrevista("a2"), entrevista("a3")],
  });
  assert.equal(app.buscar((e) => e.props?.id === "total-entrevistas").props["data-total"], 4);
  assert.match(texto(app.arvore), /3 de outros aparelhos/);
  assert.ok(app.buscar((e) => e.type === "option" && texto(e) === "Banco"), "Versão do banco precisa prevalecer sobre cópias antigas");
});

test("Início oferece Ver consolidado mesmo sem entrevistas locais", async () => {
  const app = await tela("app/page.jsx", "Inicio");
  assert.ok(app.buscar((e) => e.type === "a" && e.props.href === "/consolidado/" && texto(e) === "Ver consolidado"), "Aparelho novo precisa acessar consolidado");
});

test("consolidado oculta locais de outra conta mantendo ZIPs importados", async () => {
  const locais = [entrevista("minha"), entrevista("outra", { entrevistadorId: "bia", entrevistador: "Bia" })];
  const app = await tela("app/consolidado/page.jsx", "Consolidado", {
    locais, importadas: [entrevista("importada", { entrevistadorId: "bia", entrevistador: "Bia" })],
  });
  assert.equal(app.buscar((e) => e.props?.id === "total-entrevistas").props["data-total"], 2);
  assert.match(texto(app.arvore), /1 de outros aparelhos/);
  assert.equal(locais.length, 2);
});

test("Início mantém filtro da conta após apagar e ZIP inclui só conta atual", async () => {
  const locais = [entrevista("minha", { respostas: { nome: "Minha entrevista" } }), entrevista("outra", { entrevistadorId: "bia", respostas: { nome: "Outra conta" } })];
  const app = await tela("app/page.jsx", "Inicio", { locais });
  assert.ok(app.buscar((e) => e.type === "a" && e.props.href === "/entrevista/?id=minha"));
  assert.equal(app.buscar((e) => e.type === "a" && e.props.href === "/entrevista/?id=outra"), undefined);
  let arquivo;
  app.contexto.baixar = (blob) => { arquivo = blob; };
  await app.buscar((e) => e.type === "button" && texto(e) === "Exportar tudo (ZIP)").props.onClick();
  const zip = await JSZip.loadAsync(await arquivo.arrayBuffer());
  assert.deepEqual(JSON.parse(await zip.file("entrevistas.json").async("string")).entrevistas.map((e) => e.id), ["minha"]);
  assert.doesNotMatch(await zip.file("entrevistas.csv").async("string"), /Outra conta/);
  app.contexto.apagarEntrevista = async (id) => { locais.splice(locais.findIndex((e) => e.id === id), 1); };
  app.contexto.anotarApagada = () => {};
  app.buscar((e) => e.type === "button" && e.props.className === "perigo").props.onClick(); app.render();
  await app.buscar((e) => e.type === "button" && e.props.className === "perigo").props.onClick(); app.render();
  assert.equal(app.buscar((e) => e.type === "a" && e.props.href === "/entrevista/?id=outra"), undefined);
  assert.deepEqual(locais.map((e) => e.id), ["outra"]);
});

test("consolidado não restaura do banco entrevista apagada com baixa pendente", async () => {
  const app = await tela("app/consolidado/page.jsx", "Consolidado", {
    apagadas: ["apagada"], dados: { papel: "entrevistador", entrevistas: [entrevista("apagada"), entrevista("viva")] },
  });
  assert.equal(app.buscar((e) => e.props?.id === "total-entrevistas").props["data-total"], 1);
});

test("painel não restaura do banco entrevista apagada com baixa pendente", async () => {
  const app = await tela("app/painel/page.jsx", "Painel", {
    apagadas: ["apagada"], dados: { papel: "entrevistador", entrevistas: [entrevista("apagada"), entrevista("viva")] },
  });
  assert.equal(numeros(app, "Meu painel")[0], "1");
});

test("painel mantém banco e equipe após falha temporária e limpa ao ficar offline", async () => {
  const app = await tela("app/painel/page.jsx", "Painel", {
    locais: [entrevista("local")],
    dados: { papel: "coordenador", entrevistadores: [CONTA], entrevistas: [entrevista("banco")] },
  });
  app.contexto.fetch = async () => { throw new TypeError("Failed to fetch"); };
  await app.evento("sincronizado");
  assert.equal(numeros(app, "Meu painel")[0], "2");
  assert.equal(numeros(app, "Equipe")[0], "1");
  app.contexto.navigator.onLine = false;
  await app.evento("offline");
  assert.equal(numeros(app, "Meu painel")[0], "1");
  assert.equal(secao(app, "Equipe"), undefined);
});
