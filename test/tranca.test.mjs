import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import swc from "next/dist/build/swc/index.js";
import React from "react";

import { CARGOS, CATEGORIAS, FAIXAS, GENEROS } from "../lib/rotulos.mjs";
import { daConta, erroDeLogin, normalizarUsuario, pendentesDeEnvio, versaoDe } from "../lib/sincronizar.mjs";

const CHAVE = "acesso-formula-impacto";
const ANA = { id: "ana", nome: "Ana", usuario: "ana", segredo: "ab".repeat(32), registrada: true, sal: "sal-antigo", resumo: "bf730debdec8b8afae7baa74e4068fe488f1df6b3a005d154c48eb0b3dcde05e" };
const codigo = (arquivo) => readFileSync(new URL(`../${arquivo}`, import.meta.url), "utf8").replace(/^import .*;$/gm, "").replace(/^export (default )?/gm, "");
const elementos = (arvore) => !arvore || typeof arvore !== "object" ? [] : Array.isArray(arvore) ? arvore.flatMap(elementos) : [arvore, ...elementos(arvore.props?.children)];
const texto = (arvore) => arvore == null || typeof arvore === "boolean" ? "" : typeof arvore !== "object" ? String(arvore) : Array.isArray(arvore) ? arvore.map(texto).join("") : texto(arvore.props?.children);

function tela(arquivo, nome, { conta = null, fetch, seguro = true, entrevistas = [] } = {}) {
  const armazem = new Map(conta ? [[CHAVE, JSON.stringify(conta)]] : []);
  const sessao = new Map();
  const pedidos = [];
  const estados = [];
  const efeitos = [];
  let indice = 0;
  let montada = false;
  const armazenamento = (mapa) => ({ getItem: (chave) => mapa.get(chave) ?? null, setItem: (chave, valor) => mapa.set(chave, valor), removeItem: (chave) => mapa.delete(chave) });
  const contexto = {
    React, CHAVE, crypto, TextEncoder, TypeError, AbortSignal, Event,
    localStorage: armazenamento(armazem), sessionStorage: armazenamento(sessao),
    window: { isSecureContext: seguro, dispatchEvent() {}, addEventListener() {}, removeEventListener() {} },
    navigator: { onLine: true }, location: { href: "/aparelho/" },
    fetch: async (url, opcoes) => { pedidos.push([url, JSON.parse(opcoes.body || "null")]); return fetch ? fetch(url, opcoes) : Response.json({ id: "ana", token: "ab".repeat(32), nome: "Ana", papel: "entrevistador", usuario: "ana", ids: [] }); },
    daConta, erroDeLogin, normalizarUsuario, pendentesDeEnvio, versaoDe,
    listarEntrevistas: async () => entrevistas, marcarEnviada() {}, novoId: () => crypto.randomUUID(), registrarErro() {},
    useState: (inicial) => { const atual = indice++; if (!(atual in estados)) estados[atual] = inicial; return [estados[atual], (valor) => { estados[atual] = typeof valor === "function" ? valor(estados[atual]) : valor; }]; },
    useEffect: (efeito) => { if (!montada) efeitos.push(efeito); },
    useRouter: () => ({ prefetch() {} }), pendentes: () => [], entrevistasDesde: () => [],
    CARGOS, CATEGORIAS, FAIXAS, GENEROS, ULTIMA_EXPORTACAO: "ultima-exportacao",
    Topo: "header", Icone: "svg", Link: "a",
  };
  const envio = runInNewContext(`(() => { ${codigo("lib/enviar.mjs")}\nreturn { ABERTA, acessar, embaralhar, garantirIdentidade, sair, vincular }; })();`, contexto);
  Object.assign(contexto, envio);
  // Os hooks ficam locais ao teste; JSX e operações de conta executam o código de produção.
  const compilado = swc.transformSync(codigo(arquivo), { jsc: { parser: { syntax: "ecmascript", jsx: true }, target: "es2022", transform: { react: { runtime: "classic" } } } }).code;
  const componente = runInNewContext(`${compilado}\n typeof ${nome} === "function" ? ${nome} : null;`, contexto);
  assert.equal(typeof componente, "function", `Componente ${nome} precisa existir`);
  const app = {
    armazem, sessao, pedidos, contexto,
    render() { indice = 0; app.arvore = componente({ children: "Conteúdo liberado" }); return app.arvore; },
    buscar: (predicado) => elementos(app.arvore).find(predicado),
    campo: (id) => app.buscar((e) => e.props?.id === id),
    botao: (rotulo) => app.buscar((e) => e.type === "button" && texto(e) === rotulo),
    digitar(id, valor) { const campo = app.campo(id); assert.ok(campo, `Campo #${id} precisa existir`); campo.props.onChange({ target: { value: valor } }); app.render(); },
    async enviar() { await app.buscar((e) => e.type === "form").props.onSubmit({ preventDefault() {} }); app.render(); },
    aviso: () => texto(app.buscar((e) => e.type === "p" && e.props.className === "aviso")),
  };
  app.render();
  montada = true;
  for (const efeito of efeitos) efeito();
  app.render();
  return app;
}

test("primeiro acesso entra ou cria conta com os campos e caminhos corretos", async () => {
  for (const criar of [false, true]) {
    const app = tela("components/Tranca.jsx", "Tranca");
    assert.ok(app.campo("usuario"), "Primeiro acesso precisa de usuário");
    assert.ok(app.campo("senha"));
    assert.equal(app.campo("nome"), undefined);
    assert.ok(app.botao("Entrar"));
    if (criar) {
      app.botao("Criar conta nova").props.onClick(); app.render();
      assert.ok(app.botao("Já tenho conta"));
      app.digitar("nome", " Ana ");
      app.digitar("confirmacao", "senha-123");
    }
    app.digitar("usuario", " Ana ");
    app.digitar("senha", "senha-123");
    await app.enviar();
    assert.deepEqual(app.pedidos, [[criar ? "/api/conta" : "/api/entrar", criar ? { nome: "Ana", usuario: " Ana ", senha: "senha-123" } : { usuario: " Ana ", senha: "senha-123" }]]);
    assert.equal(JSON.parse(app.armazem.get(CHAVE)).usuario, "ana");
    assert.equal(app.sessao.get("acesso-liberado"), "1");
    assert.equal(texto(app.arvore), "Conteúdo liberado");
  }
});

test("recusa do servidor ou falta de internet aparece em p.aviso sem guardar conta", async () => {
  for (const falha of [400, 401, 409, 429, "rede"]) {
    const app = tela("components/Tranca.jsx", "Tranca", { fetch: async () => { if (falha === "rede") throw new TypeError("Failed to fetch"); return Response.json({ erro: `Recusa ${falha}` }, { status: falha }); } });
    app.digitar("usuario", "ana"); app.digitar("senha", "senha-123");
    await app.enviar();
    assert.equal(app.aviso(), falha === "rede" ? "Sem internet. Conecte o aparelho e tente de novo." : `Recusa ${falha}`);
    assert.equal(app.campo("senha").props.value, "");
    assert.equal(app.armazem.has(CHAVE), false);
    assert.equal(app.sessao.has("acesso-liberado"), false);
  }
});

test("cadastro valida nome, usuário, senha, confirmação e endereço antes de acessar o banco", async () => {
  const app = tela("components/Tranca.jsx", "Tranca");
  assert.ok(app.botao("Criar conta nova"), "Precisa oferecer criar conta nova");
  app.botao("Criar conta nova").props.onClick(); app.render();
  await app.enviar(); assert.match(app.aviso(), /Diga seu nome/);
  app.digitar("nome", "Ana"); app.digitar("usuario", "a"); app.digitar("senha", "senha-123");
  await app.enviar(); assert.match(app.aviso(), /O usuário precisa/);
  app.digitar("usuario", "ana"); app.digitar("senha", "12345");
  await app.enviar(); assert.match(app.aviso(), /A senha precisa/);
  app.digitar("senha", "senha-123"); app.digitar("confirmacao", "diferente");
  await app.enviar(); assert.equal(app.aviso(), "As duas senhas não são iguais.");
  app.digitar("confirmacao", "senha-123"); app.contexto.window.isSecureContext = false;
  await app.enviar(); assert.match(app.aviso(), /precisa ser https ou localhost/);
  assert.deepEqual(app.pedidos, []);
});

test("conta com usuário destrava só localmente sem permitir trocar de conta", async () => {
  const app = tela("components/Tranca.jsx", "Tranca", { conta: ANA, fetch: async () => { throw new Error("Nunca deve acessar a rede"); } });
  assert.ok(app.campo("senha"), "Conta com usuário precisa de senha");
  assert.equal(app.campo("usuario"), undefined);
  assert.equal(app.campo("pin"), undefined);
  assert.equal(app.botao("Criar conta nova"), undefined);
  app.digitar("senha", "errada"); await app.enviar();
  assert.equal(app.aviso(), "Senha errada.");
  app.digitar("senha", "1234"); await app.enviar();
  assert.equal(texto(app.arvore), "Conteúdo liberado");
  assert.deepEqual(app.pedidos, []);
  assert.deepEqual(JSON.parse(app.armazem.get(CHAVE)), ANA);
});

test("conta antiga continua usando PIN numérico sem expor primeiro acesso", async () => {
  const app = tela("components/Tranca.jsx", "Tranca", { conta: { ...ANA, usuario: undefined }, seguro: false });
  assert.equal(app.campo("usuario"), undefined);
  assert.equal(app.botao("Criar conta nova"), undefined);
  assert.equal(app.campo("pin").props.maxLength, 4);
  app.digitar("pin", "0x000"); assert.equal(app.campo("pin").props.value, "0000");
  await app.enviar(); assert.equal(app.aviso(), "Código errado.");
  app.digitar("pin", "1234"); await app.enviar();
  assert.equal(texto(app.arvore), "Conteúdo liberado");
  assert.deepEqual(app.pedidos, []);
});

test("Início oferece criar usuário e senha somente para conta antiga", async () => {
  for (const conta of [{ ...ANA, usuario: undefined }, ANA, null]) {
    const app = tela("app/page.jsx", "Inicio", { conta });
    await Promise.resolve(); app.render();
    const aviso = app.buscar((e) => e.type === "p" && texto(e).startsWith("Crie usuário e senha"));
    assert.equal(Boolean(aviso), Boolean(conta && !conta.usuario), "Aviso deve aparecer para conta antiga");
    if (aviso) assert.ok(app.buscar((e) => e.type === "a" && e.props.href === "/aparelho/" && texto(e) === "Criar usuário e senha"));
  }
});

test("Conta vincula usuário e senha mantendo ID e segredo da conta antiga", async () => {
  const app = tela("app/aparelho/page.jsx", "Conta", { conta: { ...ANA, usuario: undefined } });
  assert.match(texto(app.arvore), /ID do entrevistador: ana/);
  app.digitar("novo-usuario", " Ana "); app.digitar("nova-senha", "senha-123"); app.digitar("repetir-senha", "errada");
  await app.enviar(); assert.equal(app.aviso(), "As duas senhas não são iguais."); assert.deepEqual(app.pedidos, []);
  app.digitar("repetir-senha", "senha-123"); await app.enviar();
  const conta = JSON.parse(app.armazem.get(CHAVE));
  assert.equal(conta.id, "ana"); assert.equal(conta.segredo, ANA.segredo); assert.equal(conta.usuario, "ana");
  assert.deepEqual(app.pedidos, [["/api/conta/vincular", { usuario: " Ana ", senha: "senha-123" }]]);
  assert.equal(app.campo("nova-senha"), undefined);
  assert.match(app.aviso(), /A senha agora também destrava este/);
});

test("Conta mostra erro de vínculo e recusa sair sem perder acesso", async () => {
  const app = tela("app/aparelho/page.jsx", "Conta", { conta: { ...ANA, usuario: undefined }, fetch: async () => Response.json({ erro: "Usuário já existe." }, { status: 409 }) });
  app.digitar("novo-usuario", "ana"); app.digitar("nova-senha", "senha-123"); app.digitar("repetir-senha", "senha-123");
  await app.enviar(); assert.equal(app.aviso(), "Usuário já existe.");
  await app.botao("Sair deste aparelho").props.onClick(); app.render();
  assert.match(app.aviso(), /Crie usuário e senha antes de sair/);
  assert.equal(app.contexto.location.href, "/aparelho/");
  assert.equal(app.armazem.has(CHAVE), true);
});

test("Conta recusa pendências e sair liberado permite primeiro acesso novamente", async () => {
  const entrevista = { id: "a1", entrevistadorId: "ana", iniciadaEm: "2026-10-03T12:00:00Z" };
  for (const pendencia of ["entrevista", "apagada", null]) {
    const app = tela("app/aparelho/page.jsx", "Conta", { conta: ANA, entrevistas: pendencia === "entrevista" ? [entrevista] : [] });
    if (pendencia === "apagada") app.armazem.set("entrevistas-apagadas", '["a1"]');
    assert.equal(app.campo("novo-usuario"), undefined);
    await app.botao("Sair deste aparelho").props.onClick(); app.render();
    assert.equal(app.armazem.has(CHAVE), Boolean(pendencia));
    assert.equal(app.contexto.location.href, pendencia ? "/aparelho/" : "/");
    if (pendencia) assert.match(app.aviso(), /ainda não enviadas/);
    else assert.ok(tela("components/Tranca.jsx", "Tranca", { conta: JSON.parse(app.armazem.get(CHAVE) || "null") }).campo("usuario"));
  }
});
