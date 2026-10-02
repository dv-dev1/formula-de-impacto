import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { onRequestGet } from "../functions/api/painel.js";
import { onRequestPost } from "../functions/api/sincronizar.js";
import { hashDoSegredo } from "../lib/sincronizar.mjs";

function bancoFalso(t) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../migrations/0001_inicial.sql", import.meta.url), "utf8"));
  t.after(() => sqlite.close());
  const DB = {
    prepare(sql) {
      const consulta = sqlite.prepare(sql.replace(/\?\d+/g, "?"));
      let argumentos = [];
      return {
        bind(...valores) { argumentos = valores; return this; },
        async first() { return consulta.get(...argumentos) ?? null; },
        async all() { return { results: consulta.all(...argumentos) }; },
        async run() { return consulta.run(...argumentos); },
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
  const r = await postar(env, B, [entrevista("a1", { atualizadaEm: "2026-10-02T12:00:00Z", respostas: { nome: "Intrusa" } })], ["a1"]);
  assert.deepEqual(await r.json(), { ids: ["a1"] });
  const dados = (await (await ler(env)).json()).entrevistas;
  assert.equal(dados.length, 1);
  assert.equal(dados[0].respostas.nome, "a1");
  assert.equal(dados[0].entrevistadorId, A.id);
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
  await postar(env, B, [entrevista("b1")]);
  await postar(env, A, [entrevista("a1")]);
  env.sqlite.prepare("UPDATE entrevistadores SET papel='coordenador' WHERE id=?").run(A.id);
  env.sqlite.prepare("UPDATE entrevistas SET dados=? WHERE id='b1'").run(JSON.stringify(entrevista("b1", { entrevistadorId: A.id })));
  const dados = await (await ler(env)).json();
  assert.equal(dados.papel, "coordenador");
  assert.deepEqual(dados.entrevistadores, [{ id: A.id, nome: A.nome }, { id: B.id, nome: B.nome }]);
  assert.deepEqual(dados.entrevistas.map((e) => [e.id, e.entrevistadorId]).sort(), [["a1", A.id], ["b1", B.id]]);
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
