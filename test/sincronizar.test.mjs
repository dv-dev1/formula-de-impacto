import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { daConta, entrevistaValida, hashDoSegredo, lerCredencial, pendentesDeEnvio, versaoDe } from "../lib/sincronizar.mjs";

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
