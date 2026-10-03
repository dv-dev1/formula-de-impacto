import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

import { daConta, pendentesDeEnvio, versaoDe } from "../lib/sincronizar.mjs";

const codigo = readFileSync(new URL("../lib/enviar.mjs", import.meta.url), "utf8")
  .replace(/^import .*;$/gm, "").replace(/^export /gm, "");

function aparelho(fetch, AbortSignal = { timeout: () => undefined }, conta = { id: "ana", nome: "Ana", segredo: "ab".repeat(32), registrada: true }) {
  const entrevista = { id: "a1", entrevistadorId: conta?.id ?? "ana", perfil: {}, respostas: {}, iniciadaEm: "2026-10-01T12:00:00Z" };
  const erros = [];
  const armazem = new Map(conta ? [["acesso-formula-impacto", JSON.stringify(conta)]] : []);
  const contexto = {
    CHAVE: "acesso-formula-impacto", fetch, AbortSignal, TypeError, TextEncoder,
    crypto, Event, navigator: { onLine: true }, window: { dispatchEvent() {} },
    localStorage: { getItem: (chave) => armazem.get(chave) ?? null, setItem: (chave, valor) => armazem.set(chave, valor), removeItem: (chave) => armazem.delete(chave) },
    sessionStorage: { removeItem() {} },
    daConta, pendentesDeEnvio, versaoDe,
    listarEntrevistas: async () => [structuredClone(entrevista)],
    marcarEnviada: async (id, versao) => { if (id === entrevista.id) entrevista.enviadaEm = versao; },
    novoId: () => crypto.randomUUID(), registrarErro: (onde, erro) => erros.push([onde, erro.message]),
  };
  // A VM troca só as dependências do navegador; o envio executa o código do módulo.
  const modulo = runInNewContext(`${codigo}\n({ sincronizar, acessar, vincular, sair, buscarDoBanco, embaralhar });`, contexto);
  return { ...modulo, entrevista, erros, armazem };
}

const lerConta = (app) => JSON.parse(app.armazem.get("acesso-formula-impacto") ?? "null");
const ANA = { id: "ana", nome: "Ana", usuario: "ana", segredo: "ab".repeat(32), registrada: true };

const resposta = () => Response.json({ ids: ["a1"] });

test("concluir durante envio compartilha a promise e envia novamente a versão concluída", async () => {
  const iniciou = Promise.withResolvers();
  const liberar = Promise.withResolvers();
  const enviadas = [];
  const app = aparelho(async (url, opcoes) => {
    enviadas.push(JSON.parse(opcoes.body).entrevistas[0]);
    if (enviadas.length === 1) { iniciou.resolve(); await liberar.promise; }
    return resposta();
  });
  const primeira = app.sincronizar();
  await iniciou.promise;
  app.entrevista.concluidaEm = "2026-10-01T12:20:00Z";
  app.entrevista.atualizadaEm = app.entrevista.concluidaEm;
  assert.equal(app.sincronizar(), primeira);
  liberar.resolve();
  await primeira;
  assert.equal(enviadas.length, 2);
  assert.equal(enviadas[1].concluidaEm, app.entrevista.concluidaEm);
  assert.equal(app.entrevista.enviadaEm, app.entrevista.atualizadaEm);
});

test("envio funciona em aparelho sem AbortSignal.timeout", async () => {
  let chamadas = 0;
  const app = aparelho(async () => { chamadas += 1; return resposta(); }, {});
  await app.sincronizar();
  assert.equal(chamadas, 1);
  assert.equal(app.entrevista.enviadaEm, app.entrevista.iniciadaEm);
});

test("acessar grava a conta com o token no segredo e só o hash local da senha", async () => {
  const pedidos = [];
  const app = aparelho(async (url, opcoes) => {
    pedidos.push([url, JSON.parse(opcoes.body)]);
    return Response.json({ id: "id-1", token: "cd".repeat(32), nome: "Ana", papel: "entrevistador", usuario: "ana" });
  }, undefined, null);
  await app.acessar("/api/entrar", { usuario: "Ana", senha: "senha-123" });
  assert.deepEqual(pedidos, [["/api/entrar", { usuario: "Ana", senha: "senha-123" }]]);
  const conta = lerConta(app);
  assert.equal(conta.id, "id-1");
  assert.equal(conta.segredo, "cd".repeat(32));
  assert.equal(conta.usuario, "ana");
  assert.equal(conta.nome, "Ana");
  assert.equal(conta.registrada, true);
  assert.equal(conta.senha, undefined);
  assert.equal(conta.resumo, await app.embaralhar("senha-123", conta.sal));
  assert.notEqual(conta.resumo, await app.embaralhar("senha-errada", conta.sal));
});

test("acessar recusado mostra a mensagem do servidor e não grava conta", async () => {
  const app = aparelho(async () => Response.json({ erro: "Usuário ou senha errados." }, { status: 401 }), undefined, null);
  await assert.rejects(app.acessar("/api/entrar", { usuario: "ana", senha: "senha-123" }), /Usuário ou senha errados\./);
  assert.equal(lerConta(app), null);
});

test("acessar sem rede avisa que falta internet e não grava conta", async () => {
  const app = aparelho(async () => { throw new TypeError("Failed to fetch"); }, undefined, null);
  await assert.rejects(app.acessar("/api/conta", { nome: "Ana", usuario: "ana", senha: "senha-123" }), /Sem internet/);
  assert.equal(lerConta(app), null);
});

test("vincular envia com a credencial da conta e troca o hash local pela senha", async () => {
  const pedidos = [];
  const app = aparelho(async (url, opcoes) => {
    pedidos.push([url, opcoes.headers.authorization, JSON.parse(opcoes.body)]);
    return url === "/api/conta/vincular" ? Response.json({ usuario: "ana" }) : resposta();
  });
  await app.vincular("Ana", "senha-123");
  assert.deepEqual(pedidos.map(([url]) => url), ["/api/sincronizar", "/api/conta/vincular"]);
  assert.equal(pedidos[1][1], `Bearer ana.${"ab".repeat(32)}`);
  assert.deepEqual(pedidos[1][2], { usuario: "Ana", senha: "senha-123" });
  const conta = lerConta(app);
  assert.equal(conta.usuario, "ana");
  assert.equal(conta.id, "ana");
  assert.equal(conta.segredo, "ab".repeat(32));
  assert.equal(conta.resumo, await app.embaralhar("senha-123", conta.sal));
});

test("vincular sem a conta no banco pede internet em vez de mandar credencial desconhecida", async () => {
  const urls = [];
  const app = aparelho(async (url) => { urls.push(url); throw new TypeError("Failed to fetch"); }, undefined, { ...ANA, usuario: undefined, registrada: false });
  await assert.rejects(app.vincular("ana", "senha-123"), /ainda não chegou ao banco/);
  assert.deepEqual(urls, ["/api/sincronizar"]);
});

test("sair recusa conta sem usuário e entrevista não enviada, e sai depois do envio", async () => {
  assert.match(await aparelho(async () => resposta()).sair(), /usuário e senha/);
  const app = aparelho(async () => resposta(), undefined, ANA);
  assert.match(await app.sair(), /não enviadas/);
  assert.notEqual(lerConta(app), null);
  await app.sincronizar();
  assert.equal(await app.sair(), "");
  assert.equal(lerConta(app), null);
});

test("buscarDoBanco devolve null sem rede e o JSON do painel com a credencial", async () => {
  assert.equal(await aparelho(async () => { throw new TypeError("Failed to fetch"); }).buscarDoBanco(), null);
  assert.equal(await aparelho(async () => new Response("", { status: 401 })).buscarDoBanco(), null);
  let cabecalho;
  const app = aparelho(async (url, opcoes) => {
    cabecalho = [url, opcoes.headers.authorization];
    return Response.json({ papel: "entrevistador", entrevistadores: [], entrevistas: [{ id: "a1" }] });
  });
  const dados = await app.buscarDoBanco();
  assert.deepEqual(cabecalho, ["/api/painel", `Bearer ana.${"ab".repeat(32)}`]);
  assert.equal(dados.entrevistas[0].id, "a1");
});

test("sair recusa apagada pendente mesmo com todas as entrevistas enviadas", async () => {
  const app = aparelho(async () => resposta(), undefined, ANA);
  await app.sincronizar();
  app.armazem.set("entrevistas-apagadas", JSON.stringify(["apagada-1"]));
  assert.match(await app.sair(), /não enviadas/);
  assert.notEqual(lerConta(app), null);
  await app.sincronizar();
  assert.equal(await app.sair(), "");
  assert.equal(lerConta(app), null);
});

test("embaralhar mantém o hash SHA-256 das contas antigas", async () => {
  const app = aparelho(async () => resposta());
  assert.equal(await app.embaralhar("1234", "sal-antigo"), "bf730debdec8b8afae7baa74e4068fe488f1df6b3a005d154c48eb0b3dcde05e");
});
