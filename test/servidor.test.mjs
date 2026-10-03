import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { onRequestGet } from "../functions/api/painel.js";
import { onRequestPost } from "../functions/api/sincronizar.js";
import { onRequestPost as criarConta } from "../functions/api/conta/index.js";
import { onRequestPost as entrar } from "../functions/api/entrar.js";
import { onRequestPost as vincular } from "../functions/api/conta/vincular.js";
import { hashDaSenha, hashDoSegredo } from "../lib/sincronizar.mjs";

function bancoFalso(t, entreMigracoes = () => {}) {
  const sqlite = new DatabaseSync(":memory:");
  const migracao = (arquivo) => readFileSync(new URL(`../migrations/${arquivo}`, import.meta.url), "utf8");
  sqlite.exec(migracao("0001_inicial.sql"));
  entreMigracoes(sqlite);
  sqlite.exec(migracao("0002_login.sql"));
  t.after(() => sqlite.close());
  const DB = {
    prepare(sql) {
      const consulta = sqlite.prepare(sql.replace(/\?\d+/g, "?"));
      let argumentos = [];
      return {
        bind(...valores) { argumentos = valores; return this; },
        async first() { return consulta.get(...argumentos) ?? null; },
        async all() { return { results: consulta.all(...argumentos) }; },
        async run() {
          const resultado = consulta.run(...argumentos);
          return { ...resultado, meta: { changes: resultado.changes } };
        },
      };
    },
    async batch(tarefas) {
      sqlite.exec("BEGIN");
      try {
        const resultados = [];
        for (const tarefa of tarefas) resultados.push(await tarefa.run());
        sqlite.exec("COMMIT");
        return resultados;
      } catch (erro) {
        sqlite.exec("ROLLBACK");
        throw erro;
      }
    },
  };
  return { DB, sqlite };
}

const A = { id: "conta-A", nome: "Ana", segredo: "ab".repeat(32) };
const B = { id: "conta-B", nome: "Bia", segredo: "cd".repeat(32) };
const entrevista = (id, outros = {}) => ({ id, perfil: { categoria: "ater" }, respostas: { nome: id }, iniciadaEm: "2026-10-01T12:00:00Z", ...outros });
const cabecalho = (conta) => ({ authorization: `Bearer ${conta.id}.${conta.segredo}` });
const postar = (env, conta = A, entrevistas = [], apagadas = []) => onRequestPost({
  env, request: new Request("https://teste/api/sincronizar", { method: "POST", headers: cabecalho(conta), body: JSON.stringify({ nome: conta.nome, entrevistas, apagadas }) }),
});
const ler = (env, conta = A) => onRequestGet({ env, request: new Request("https://teste/api/painel", { headers: cabecalho(conta) }) });
const pedir = (handler, env, rota, corpo, headers = {}) => handler({
  env, request: new Request(`https://teste${rota}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(corpo) }),
});
const LOGIN = { nome: "Carla", usuario: "carla", senha: "senha-123" };
const tentar = (env, senha) => pedir(entrar, env, "/api/entrar", { usuario: "carla", senha });

test("vincular grava usuário e senha numa conta antiga e depois entrar funciona", async (t) => {
  const env = bancoFalso(t);
  await postar(env, A, [entrevista("a1")]);
  const r = await pedir(vincular, env, "/api/conta/vincular", { usuario: " Ana ", senha: "senha-ana" }, cabecalho(A));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { usuario: "ana" });
  const sessao = await (await pedir(entrar, env, "/api/entrar", { usuario: "ana", senha: "senha-ana" })).json();
  assert.equal(sessao.id, A.id);
  assert.equal(sessao.nome, A.nome);
  assert.deepEqual((await (await ler(env, { ...A, segredo: sessao.token })).json()).entrevistas.map((e) => e.id), ["a1"]);
  assert.equal((await ler(env)).status, 200);
});

test("vincular recusa credencial inválida, conta que já tem usuário e usuário de outra conta", async (t) => {
  const env = bancoFalso(t);
  await postar(env, A);
  await postar(env, B);
  const tentarVincular = (corpo, headers) => pedir(vincular, env, "/api/conta/vincular", corpo, headers);
  assert.equal((await tentarVincular({ usuario: "ana", senha: "senha-ana" })).status, 401);
  assert.equal((await tentarVincular({ usuario: "ana", senha: "senha-ana" }, cabecalho({ ...A, segredo: B.segredo }))).status, 401);
  assert.equal((await tentarVincular({ usuario: "ana", senha: "senha-ana" }, cabecalho(A))).status, 200);
  assert.equal((await tentarVincular({ usuario: "outra", senha: "senha-ana" }, cabecalho(A))).status, 409);
  assert.equal((await tentarVincular({ usuario: "ANA", senha: "senha-bia" }, cabecalho(B))).status, 409);
  assert.equal((await tentarVincular({ usuario: "bia", senha: "123" }, cabecalho(B))).status, 400);
  assert.equal(env.sqlite.prepare("SELECT usuario FROM entrevistadores WHERE id = ?").get(B.id).usuario, null);
  assert.equal(env.sqlite.prepare("SELECT usuario FROM entrevistadores WHERE id = ?").get(A.id).usuario, "ana");
});

test("vincular simultâneo na mesma conta permite um usuário e recusa o outro", async (t) => {
  const env = bancoFalso(t);
  await postar(env, A);
  const respostas = await Promise.all(["ana", "outra"].map((usuario) =>
    pedir(vincular, env, "/api/conta/vincular", { usuario, senha: "senha-ana" }, cabecalho(A))));
  assert.deepEqual(respostas.map((r) => r.status).sort((a, b) => a - b), [200, 409]);
  const sucesso = await respostas.find((r) => r.status === 200).json();
  assert.ok(["ana", "outra"].includes(sucesso.usuario));
  assert.equal(env.sqlite.prepare("SELECT usuario FROM entrevistadores WHERE id = ?").get(A.id).usuario, sucesso.usuario);
  assert.deepEqual(await respostas.find((r) => r.status === 409).json(), { erro: "Esta conta já tem usuário." });
});

test("primeira chamada cadastra com hash, nome aparado e sem enviadaEm no banco", async (t) => {
  const env = bancoFalso(t);
  const r = await postar(env, { ...A, nome: " Ana " }, [entrevista("a1", { entrevistadorId: B.id, enviadaEm: "ontem" }), null]);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ids: ["a1"] });
  assert.equal(r.headers.get("cache-control"), "no-store");
  const conta = env.sqlite.prepare("SELECT * FROM entrevistadores").get();
  assert.equal(conta.nome, "Ana");
  assert.equal(conta.papel, "entrevistador");
  assert.equal(conta.segredo_hash, await hashDoSegredo(A.segredo));
  assert.ok(!Number.isNaN(Date.parse(conta.criado_em)));
  const dados = (await (await ler(env)).json()).entrevistas[0];
  assert.equal(dados.entrevistadorId, A.id);
  assert.equal(dados.enviadaEm, undefined);
});

test("segredo errado devolve 401 no POST e no GET sem cadastrar desconhecido no GET", async (t) => {
  const env = bancoFalso(t);
  await postar(env);
  const errado = { ...A, segredo: B.segredo };
  assert.equal((await postar(env, errado)).status, 401);
  assert.equal((await ler(env, errado)).status, 401);
  assert.equal((await ler(env, B)).status, 401);
});

test("GET de A traz só suas entrevistas e seu entrevistador", async (t) => {
  const env = bancoFalso(t);
  await postar(env, A, [entrevista("a1")]);
  await postar(env, B, [entrevista("b1")]);
  const r = await ler(env);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const dados = await r.json();
  assert.equal(dados.papel, "entrevistador");
  assert.deepEqual(dados.entrevistadores, [{ id: A.id, nome: A.nome }]);
  assert.deepEqual(dados.entrevistas.map((e) => e.id), ["a1"]);
});

test("B não sobrescreve nem apaga a entrevista de A mesmo com versão mais nova", async (t) => {
  const env = bancoFalso(t);
  await postar(env, A, [entrevista("a1")]);
  const r = await postar(env, B, [entrevista("a1", { atualizadaEm: "2026-10-02T12:00:00Z", respostas: { nome: "De B" } })]);
  assert.deepEqual(await r.json(), { ids: ["a1"] });
  const dados = (await (await ler(env)).json()).entrevistas;
  assert.equal(dados.length, 1);
  assert.equal(dados[0].respostas.nome, "a1");
  assert.equal(dados[0].entrevistadorId, A.id);
  const deB = (await (await ler(env, B)).json()).entrevistas;
  assert.equal(deB.length, 1);
  assert.equal(deB[0].respostas.nome, "De B");
  env.sqlite.prepare("UPDATE entrevistadores SET papel='coordenador' WHERE id=?").run(A.id);
  const equipe = (await (await ler(env)).json()).entrevistas;
  assert.deepEqual(equipe.map((e) => [e.entrevistadorId, e.id, e.respostas.nome]).sort(),
    [[A.id, "a1", "a1"], [B.id, "a1", "De B"]]);
  await postar(env, B, [], ["a1"]);
  assert.deepEqual((await (await ler(env, B)).json()).entrevistas, []);
  const restantes = (await (await ler(env)).json()).entrevistas;
  assert.deepEqual(restantes.map((e) => [e.entrevistadorId, e.id, e.respostas.nome]), [[A.id, "a1", "a1"]]);
  const apagadaEm = (conta) => env.sqlite.prepare("SELECT apagada_em FROM entrevistas WHERE entrevistador_id=? AND id=?").get(conta.id, "a1").apagada_em;
  assert.equal(apagadaEm(A), null);
  assert.ok(!Number.isNaN(Date.parse(apagadaEm(B))));
});

test("versão mais velha ou igual não sobrescreve, versão nova atualiza", async (t) => {
  const env = bancoFalso(t);
  await postar(env, A, [entrevista("a1")]);
  const nova = entrevista("a1", { atualizadaEm: "2026-10-02T12:00:00Z", respostas: { nome: "Nova" } });
  await postar(env, A, [nova]);
  await postar(env, A, [entrevista("a1")]);
  await postar(env, A, [{ ...nova, respostas: { nome: "Igual" } }]);
  assert.equal((await (await ler(env)).json()).entrevistas[0].respostas.nome, "Nova");
});

test("apagadas marca apagada_em e some do GET mesmo após reenvio", async (t) => {
  const env = bancoFalso(t);
  await postar(env, A, [entrevista("a1")]);
  await postar(env, A, [], ["a1"]);
  const carimbo = env.sqlite.prepare("SELECT apagada_em FROM entrevistas").get().apagada_em;
  assert.ok(!Number.isNaN(Date.parse(carimbo)));
  await postar(env, A, [entrevista("a1", { atualizadaEm: "2026-10-02T12:00:00Z" })], ["a1"]);
  assert.equal(env.sqlite.prepare("SELECT apagada_em FROM entrevistas").get().apagada_em, carimbo);
  assert.deepEqual((await (await ler(env)).json()).entrevistas, []);
});

test("coordenador lê todas, entrevistadores por nome e dono da coluna", async (t) => {
  const env = bancoFalso(t);
  await postar(env, B, [entrevista("a1")]);
  await postar(env, A, [entrevista("a1")]);
  env.sqlite.prepare("UPDATE entrevistadores SET papel='coordenador' WHERE id=?").run(A.id);
  env.sqlite.prepare("UPDATE entrevistas SET dados=? WHERE entrevistador_id=? AND id=?").run(JSON.stringify(entrevista("a1", { entrevistadorId: A.id })), B.id, "a1");
  const dados = await (await ler(env)).json();
  assert.equal(dados.papel, "coordenador");
  assert.deepEqual(dados.entrevistadores, [{ id: A.id, nome: A.nome }, { id: B.id, nome: B.nome }]);
  assert.deepEqual(dados.entrevistas.map((e) => [e.entrevistadorId, e.id]).sort(), [[A.id, "a1"], [B.id, "a1"]]);
});

test("corpo acima de 100 entrevistas ou 500 apagadas devolve 413 antes do cadastro", async (t) => {
  const env = bancoFalso(t);
  assert.equal((await postar(env, A, Array.from({ length: 101 }, (_, i) => entrevista(String(i))))).status, 413);
  assert.equal((await postar(env, A, [], Array(501).fill("a"))).status, 413);
  assert.equal(env.sqlite.prepare("SELECT COUNT(*) AS n FROM entrevistadores").get().n, 0);
});

test("servidor recusa banco ausente, credencial inválida, JSON, nome e excesso de bytes", async (t) => {
  const env = bancoFalso(t);
  assert.equal((await postar({})).status, 503);
  assert.equal((await ler({})).status, 503);
  const enviarTexto = (body, headers = cabecalho(A)) => onRequestPost({ env, request: new Request("https://teste/api/sincronizar", { method: "POST", headers, body }) });
  assert.equal((await enviarTexto("{}", {})).status, 401);
  assert.equal((await enviarTexto("{")).status, 400);
  assert.equal((await enviarTexto("null")).status, 400);
  assert.equal((await postar(env, { ...A, nome: "  " })).status, 400);
  assert.equal((await postar(env, { ...A, nome: "a".repeat(81) })).status, 400);
  assert.equal((await enviarTexto(JSON.stringify({ nome: "á".repeat(3 * 1024 * 1024), entrevistas: [], apagadas: [] }))).status, 413);
});

test("segredo de tablet cadastrado antes da 0002 continua valendo", async (t) => {
  const hash = await hashDoSegredo(A.segredo);
  const env = bancoFalso(t, (sqlite) => sqlite.prepare("INSERT INTO entrevistadores (id, nome, segredo_hash, criado_em) VALUES (?, ?, ?, ?)")
    .run(A.id, A.nome, hash, "2026-10-01T00:00:00Z"));
  assert.equal((await ler(env)).status, 200);
  assert.deepEqual(await (await postar(env, A, [entrevista("a1")])).json(), { ids: ["a1"] });
  assert.deepEqual(env.sqlite.prepare("SELECT token_hash, entrevistador_id FROM sessoes").all().map((s) => ({ ...s })),
    [{ token_hash: hash, entrevistador_id: A.id }]);
  assert.equal((await ler(env, { ...A, segredo: B.segredo })).status, 401);
});

test("cadastro implícito abre a sessão e o token não vale com o id de outra conta", async (t) => {
  const env = bancoFalso(t);
  await postar(env, A);
  await postar(env, B);
  const sessao = env.sqlite.prepare("SELECT entrevistador_id FROM sessoes WHERE token_hash = ?").get(await hashDoSegredo(A.segredo));
  assert.equal(sessao?.entrevistador_id, A.id);
  assert.equal((await ler(env, { ...B, segredo: A.segredo })).status, 401);
  assert.equal((await postar(env, { ...B, segredo: A.segredo })).status, 401);
});

test("criar conta devolve id e token, normaliza o usuário e recusa repetido com 409", async (t) => {
  const env = bancoFalso(t);
  const r = await pedir(criarConta, env, "/api/conta", { ...LOGIN, nome: " Carla ", usuario: " Carla " });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const dados = await r.json();
  assert.match(dados.token, /^[a-f0-9]{64}$/);
  assert.equal(dados.nome, "Carla");
  assert.equal(dados.usuario, "carla");
  assert.equal(dados.papel, "entrevistador");
  const linha = env.sqlite.prepare("SELECT * FROM entrevistadores WHERE id = ?").get(dados.id);
  assert.equal(linha.usuario, "carla");
  assert.equal(linha.senha_hash, await hashDaSenha("senha-123", linha.senha_sal));
  assert.equal(env.sqlite.prepare("SELECT entrevistador_id FROM sessoes WHERE token_hash = ?").get(await hashDoSegredo(dados.token))?.entrevistador_id, dados.id);
  assert.equal((await pedir(criarConta, env, "/api/conta", { ...LOGIN, usuario: "CARLA" })).status, 409);
  assert.equal(env.sqlite.prepare("SELECT COUNT(*) AS n FROM entrevistadores").get().n, 1);
});

test("criar conta recusa nome, usuário e senha inválidos e banco ausente", async (t) => {
  const env = bancoFalso(t);
  for (const corpo of [{ ...LOGIN, nome: " " }, { ...LOGIN, nome: "a".repeat(81) }, { ...LOGIN, usuario: "ab" }, { ...LOGIN, usuario: "com espaço" }, { ...LOGIN, senha: "12345" }, null]) {
    assert.equal((await pedir(criarConta, env, "/api/conta", corpo)).status, 400, JSON.stringify(corpo));
  }
  assert.equal((await pedir(criarConta, {}, "/api/conta", LOGIN)).status, 503);
  assert.equal((await pedir(entrar, {}, "/api/entrar", LOGIN)).status, 503);
  assert.equal(env.sqlite.prepare("SELECT COUNT(*) AS n FROM entrevistadores").get().n, 0);
});

test("token de entrar vale em sincronizar e painel, e o de criar continua valendo", async (t) => {
  const env = bancoFalso(t);
  const criada = await (await pedir(criarConta, env, "/api/conta", LOGIN)).json();
  const r = await pedir(entrar, env, "/api/entrar", { usuario: " CARLA ", senha: "senha-123" });
  assert.equal(r.status, 200);
  const sessao = await r.json();
  assert.equal(sessao.id, criada.id);
  assert.notEqual(sessao.token, criada.token);
  assert.equal(sessao.nome, "Carla");
  assert.equal(sessao.papel, "entrevistador");
  const conta = { id: sessao.id, nome: "Carla", segredo: sessao.token };
  assert.deepEqual(await (await postar(env, conta, [entrevista("c1")])).json(), { ids: ["c1"] });
  assert.deepEqual((await (await ler(env, conta)).json()).entrevistas.map((e) => e.id), ["c1"]);
  assert.equal((await ler(env, { ...conta, segredo: criada.token })).status, 200);
});

test("senha errada e usuário desconhecido devolvem 401", async (t) => {
  const env = bancoFalso(t);
  await pedir(criarConta, env, "/api/conta", LOGIN);
  const errada = await tentar(env, "errada-123");
  assert.equal(errada.status, 401);
  assert.equal((await errada.json()).erro, "Usuário ou senha errados.");
  assert.equal((await pedir(entrar, env, "/api/entrar", { usuario: "ninguem", senha: "senha-123" })).status, 401);
  assert.equal((await pedir(entrar, env, "/api/entrar", { usuario: "carla" })).status, 401);
});

test("a 11ª tentativa depois de 10 erros devolve 429 mesmo com a senha certa; o bloqueio vence e o acerto zera", async (t) => {
  const env = bancoFalso(t);
  await pedir(criarConta, env, "/api/conta", LOGIN);
  for (let i = 0; i < 10; i += 1) assert.equal((await tentar(env, "errada-123")).status, 401);
  const bloqueada = await tentar(env, "senha-123");
  assert.equal(bloqueada.status, 429);
  assert.match((await bloqueada.json()).erro, /15 minutos/);
  const ate = env.sqlite.prepare("SELECT bloqueado_ate FROM entrevistadores").get().bloqueado_ate;
  assert.ok(Date.parse(ate) - Date.now() > 14 * 60 * 1000);
  env.sqlite.prepare("UPDATE entrevistadores SET bloqueado_ate = ?").run("2000-01-01T00:00:00.000Z");
  assert.equal((await tentar(env, "senha-123")).status, 200);
  for (let i = 0; i < 9; i += 1) await tentar(env, "errada-123");
  assert.equal((await tentar(env, "senha-123")).status, 200);
  const linha = env.sqlite.prepare("SELECT falhas, bloqueado_ate FROM entrevistadores").get();
  assert.equal(linha.falhas, 0);
  assert.equal(linha.bloqueado_ate, null);
});

test("conta e entrar recusam JSON inválido, valores sem objeto e corpo acima de 10 KB sem gravar", async (t) => {
  const env = bancoFalso(t);
  const grande = JSON.stringify({ ...LOGIN, extra: "á".repeat(6 * 1024) });
  assert.ok(grande.length < 10 * 1024);
  assert.ok(new TextEncoder().encode(grande).byteLength > 10 * 1024);
  for (const body of ["", "{", "null", "[]", '"carla"', "42", "true", grande]) {
    for (const [handler, rota, status] of [[criarConta, "/api/conta", 400], [entrar, "/api/entrar", 401]]) {
      const resposta = await handler({ env, request: new Request(`https://teste${rota}`, {
        method: "POST", headers: { "content-type": "application/json" }, body,
      }) });
      assert.equal(resposta.status, status, `${rota}: ${body.slice(0, 80)}`);
      assert.equal(resposta.headers.get("cache-control"), "no-store");
    }
  }
  assert.equal(env.sqlite.prepare("SELECT COUNT(*) AS n FROM entrevistadores").get().n, 0);
  assert.equal(env.sqlite.prepare("SELECT COUNT(*) AS n FROM sessoes").get().n, 0);
});
