import assert from "node:assert/strict";
import test from "node:test";

import { agruparPedacos, decidirRecuperacao } from "../lib/gravacao.mjs";

const pedaco = (gravacaoId, indice, entrevistaId = "e1", perguntaId = "p1") => ({
  id: `${gravacaoId}-${indice}`, gravacaoId, entrevistaId, perguntaId, indice,
  blob: new Blob([`${gravacaoId}-${indice}`]), mimeType: "audio/webm", extensao: "webm",
});

test("agruparPedacos separa gravações e ordena partes sem mudar a entrada", () => {
  const lista = [pedaco("g1", 2), pedaco("g2", 0, "e2", "p2"), pedaco("g1", 0), pedaco("g1", 1)];
  const copia = [...lista];
  const grupos = agruparPedacos(lista);
  assert.deepEqual(grupos, [
    { gravacaoId: "g1", entrevistaId: "e1", perguntaId: "p1", mimeType: "audio/webm", extensao: "webm", partes: [lista[2], lista[3], lista[0]] },
    { gravacaoId: "g2", entrevistaId: "e2", perguntaId: "p2", mimeType: "audio/webm", extensao: "webm", partes: [lista[1]] },
  ]);
  assert.deepEqual(lista, copia);
  assert.deepEqual(agruparPedacos([]), []);
});

test("decidirRecuperacao anexa quando falta áudio, inclusive se já há texto", () => {
  const grupo = { perguntaId: "p1", partes: [pedaco("g1", 0)] };
  assert.equal(decidirRecuperacao(grupo, { respostas: {} }), "anexar");
  assert.equal(decidirRecuperacao(grupo, { respostas: { p1: { texto: "Anotação" } } }), "anexar");
});

test("decidirRecuperacao descarta quando a resposta já tem áudio", () => {
  assert.equal(decidirRecuperacao({ perguntaId: "p1", partes: [pedaco("g1", 0)] }, { respostas: { p1: { audioId: "a1" } } }), "descartar");
});

test("decidirRecuperacao descarta quando a entrevista não existe", () => {
  assert.equal(decidirRecuperacao({ perguntaId: "p1", partes: [pedaco("g1", 0)] }, undefined), "descartar");
  assert.equal(decidirRecuperacao({ perguntaId: "p1", partes: [pedaco("g1", 0)] }, null), "descartar");
});

test("decidirRecuperacao descarta gravação sem o pedaço zero", () => {
  const [grupo] = agruparPedacos([pedaco("g1", 1), pedaco("g1", 2)]);
  assert.equal(decidirRecuperacao(grupo, { respostas: {} }), "descartar");
  assert.equal(decidirRecuperacao({ perguntaId: "p1", partes: [] }, { respostas: {} }), "descartar");
});
