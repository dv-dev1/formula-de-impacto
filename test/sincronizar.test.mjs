import assert from "node:assert/strict";
import { createHash, pbkdf2Sync } from "node:crypto";
import test from "node:test";

import { daConta, entrevistaValida, erroDeLogin, hashDaSenha, hashDoSegredo, lerCredencial, lerJson, normalizarUsuario, pendentesDeEnvio, versaoDe } from "../lib/sincronizar.mjs";

const entrevista = { id: "a", perfil: {}, respostas: {}, iniciadaEm: "2026-10-01T12:00:00Z" };
const segredo = "ab".repeat(32);

test("pendentes inclui nunca enviada, alterada e antiga, mas exclui enviada sem alteração", () => {
  const lista = [
    entrevista,
    { ...entrevista, id: "alterada", atualizadaEm: "2026-10-02T12:00:00Z", enviadaEm: entrevista.iniciadaEm },
    { ...entrevista, id: "enviada", atualizadaEm: entrevista.iniciadaEm, enviadaEm: entrevista.iniciadaEm },
    { ...entrevista, id: "antiga", enviadaEm: "2026-09-01T12:00:00Z" },
    { ...entrevista, id: "antiga-enviada", enviadaEm: entrevista.iniciadaEm },
  ];
  assert.deepEqual(pendentesDeEnvio(lista).map((e) => e.id), ["a", "alterada", "antiga"]);
  assert.equal(versaoDe(entrevista), entrevista.iniciadaEm);
  assert.equal(versaoDe(lista[1]), lista[1].atualizadaEm);
});

test("daConta reconhece id, legado por nome e sem nome, e recusa outra conta", () => {
  const conta = { id: "ana", nome: "Ana" };
  assert.equal(daConta({ entrevistadorId: "ana", entrevistador: "Nome anterior" }, conta), true);
  assert.equal(daConta({ entrevistador: "Ana" }, conta), true);
  assert.equal(daConta({}, conta), true);
  assert.equal(daConta({ entrevistadorId: "bia", entrevistador: "Ana" }, conta), false);
  assert.equal(daConta({ entrevistador: "Bia" }, conta), false);
});

test("credencial exige Bearer, id permitido e 64 hex minúsculos", () => {
  assert.deepEqual(lerCredencial(`Bearer Ana-123.${segredo}`), { id: "Ana-123", segredo });
  for (const cabecalho of [null, `${segredo}`, `Ana-123.${segredo}`, `Bearer a.ab`,
    `Bearer a_b.${segredo}`, `Bearer a.${segredo.toUpperCase()}`, `Bearer ${"a".repeat(101)}.${segredo}`, `Bearer .${segredo}`]) {
    assert.equal(lerCredencial(cabecalho), null);
  }
  assert.ok(lerCredencial(`Bearer ${"a".repeat(100)}.${segredo}`));
});

test("entrevista válida exige a forma mínima e id de até 100 caracteres", () => {
  assert.equal(entrevistaValida(entrevista), true);
  assert.equal(entrevistaValida({ ...entrevista, id: "a".repeat(100) }), true);
  for (const e of [null, [], {}, { ...entrevista, id: "a".repeat(101) }, { ...entrevista, id: 12 },
    { ...entrevista, perfil: [] }, { ...entrevista, respostas: null }, { ...entrevista, iniciadaEm: null }]) {
    assert.equal(entrevistaValida(e), false);
  }
});

test("hash do segredo corresponde a SHA-256 em hexadecimal", async () => {
  assert.equal(await hashDoSegredo(segredo), createHash("sha256").update(segredo).digest("hex"));
});

test("hashDaSenha é PBKDF2-SHA256 com 100 mil iterações", async () => {
  assert.equal(await hashDaSenha("senha-123", "sal-fixo"), "bc03202770dd9f1517b38af0aeed5b8a9d8a02d4c154b6d6648e48264bbb4000");
  assert.notEqual(await hashDaSenha("senha-123", "outro-sal"), await hashDaSenha("senha-123", "sal-fixo"));
});

test("redefinição com node:crypto produz o mesmo hashDaSenha", async () => {
  const senha = "senha-nova-á";
  const sal = "sal-novo-ç";
  assert.equal(await hashDaSenha(senha, sal), pbkdf2Sync(senha, sal, 100000, 32, "sha256").toString("hex"));
});

test("filtro daConta separa contas no tablet sem descartar legado da conta atual", () => {
  const lista = [
    { id: "ana", entrevistadorId: "ana", entrevistador: "Bia" },
    { id: "bia", entrevistadorId: "bia", entrevistador: "Ana" },
    { id: "legado-ana", entrevistador: "Ana" },
    { id: "legado-bia", entrevistador: "Bia" },
  ];
  assert.deepEqual(lista.filter((e) => daConta(e, { id: "ana", nome: "Ana" })).map((e) => e.id), ["ana", "legado-ana"]);
  assert.deepEqual(lista.filter((e) => daConta(e, { id: "bia", nome: "Bia" })).map((e) => e.id), ["bia", "legado-bia"]);
  assert.equal(lista.length, 4);
});

test("usuário normalizado e regras de login", () => {
  assert.equal(normalizarUsuario("  Ana.Silva "), "ana.silva");
  assert.equal(normalizarUsuario(42), "");
  assert.equal(erroDeLogin("ana.silva", "senha-1"), "");
  assert.match(erroDeLogin("ab", "senha-1"), /usuário/);
  assert.match(erroDeLogin("ana silva", "senha-1"), /usuário/);
  assert.match(erroDeLogin("ana", "12345"), /senha/);
  assert.match(erroDeLogin("ana", "x".repeat(201)), /senha/);
  assert.match(erroDeLogin("ana", undefined), /senha/);
});

test("lerJson aceita objeto e recusa JSON inválido, arrays e valores primitivos", async () => {
  assert.deepEqual(await lerJson(new Request("https://teste", { method: "POST", body: '{"nome":"Carla"}' })), { nome: "Carla" });
  for (const body of ["", "{", "null", "[]", '"carla"', "42", "true", "false"]) {
    assert.equal(await lerJson(new Request("https://teste", { method: "POST", body })), null, body);
  }
});

test("lerJson aceita 10 KB exatos e recusa um byte a mais, contando UTF-8", async () => {
  const objeto = { texto: "á".repeat(5114) };
  const body = JSON.stringify(objeto);
  assert.equal(new TextEncoder().encode(body).byteLength, 10 * 1024);
  assert.deepEqual(await lerJson(new Request("https://teste", { method: "POST", body })), objeto);
  assert.equal(await lerJson(new Request("https://teste", { method: "POST", body: `${body} ` })), null);
});
