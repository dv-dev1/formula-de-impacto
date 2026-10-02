import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

import { daConta, pendentesDeEnvio, versaoDe } from "../lib/sincronizar.mjs";

const codigo = readFileSync(new URL("../lib/enviar.mjs", import.meta.url), "utf8")
  .replace(/^import .*;$/gm, "").replace(/^export /gm, "");

function aparelho(fetch, AbortSignal = { timeout: () => undefined }) {
  const conta = { id: "ana", nome: "Ana", segredo: "ab".repeat(32), registrada: true };
  const entrevista = { id: "a1", entrevistadorId: conta.id, perfil: {}, respostas: {}, iniciadaEm: "2026-10-01T12:00:00Z" };
  const erros = [];
  const armazem = new Map([["acesso-formula-impacto", JSON.stringify(conta)]]);
  const contexto = {
    CHAVE: "acesso-formula-impacto", fetch, AbortSignal, TypeError,
    crypto, Event, navigator: { onLine: true }, window: { dispatchEvent() {} },
    localStorage: { getItem: (chave) => armazem.get(chave) ?? null, setItem: (chave, valor) => armazem.set(chave, valor) },
    daConta, pendentesDeEnvio, versaoDe,
    listarEntrevistas: async () => [structuredClone(entrevista)],
    marcarEnviada: async (id, versao) => { if (id === entrevista.id) entrevista.enviadaEm = versao; },
    novoId: () => crypto.randomUUID(), registrarErro: (onde, erro) => erros.push([onde, erro.message]),
  };
  // A VM troca só as dependências do navegador; o envio executa o código do módulo.
  const { sincronizar } = runInNewContext(`${codigo}\n({ sincronizar });`, contexto);
  return { sincronizar, entrevista, erros };
}

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
