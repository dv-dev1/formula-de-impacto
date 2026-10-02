import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import JSZip from "jszip";

import { LEIAME, audiosDaResposta, consolidar, duracaoMinutos, entrevistasDesde, juntarEntrevistas, lerExportacao, montarCsv, montarZip, pastaDa } from "../lib/exportar.mjs";
import { EXTENSOES } from "../lib/formatos-audio.mjs";

const banco = JSON.parse(readFileSync(new URL("../data/perguntas.json", import.meta.url)));

const entrevista = (id, perfil, respostas) => ({
  id,
  perfil,
  respostas,
  iniciadaEm: "2026-09-04T12:00:00.000Z",
  concluidaEm: null,
});

const jovem = { categoria: "agricultor", faixa: "jovem", genero: "masculino" };
const adulta = { categoria: "assentado", faixa: "adulto", genero: "feminino" };

test("CSV traz uma linha por entrevista mais o cabeçalho", () => {
  const csv = montarCsv(banco, [
    entrevista("a", jovem, { nome: "João" }),
    entrevista("b", adulta, { nome: "Maria" }),
  ]);
  assert.equal(csv.split("\r\n").length, 3);
  assert.ok(csv.startsWith('"id","data","categoria"'));
});

test("CSV escapa aspas e junta múltipla escolha numa célula só", () => {
  const csv = montarCsv(banco, [
    entrevista("a", jovem, { nome: 'Zé "do Sítio"', maiores_faltas: ["Água", "Estrada"] }),
  ]);
  assert.ok(csv.includes('"Zé ""do Sítio"""'));
  assert.ok(csv.includes('"Água | Estrada"'));
});

test("CSV marca resposta gravada como áudio e não despeja o objeto", () => {
  const csv = montarCsv(banco, [entrevista("a", jovem, { jovem_uma_mudanca: { audioId: "x1" } })]);
  assert.ok(csv.includes('"[áudio]"'));
  assert.ok(!csv.includes("audioId"));
});

test("CSV prefere o texto digitado quando existe junto do áudio", () => {
  const csv = montarCsv(banco, [
    entrevista("a", jovem, { jovem_uma_mudanca: { audioId: "x1", texto: "Queria internet" } }),
  ]);
  assert.ok(csv.includes('"Queria internet"'));
});

test("CSV tem uma coluna por pergunta do banco, para todo perfil caber na mesma planilha", () => {
  const [cabecalho] = montarCsv(banco, []).split("\r\n");
  const colunas = cabecalho.split('","').length;
  const comOutro = banco.perguntas.filter((p) => p.outro).length;
  assert.equal(colunas, banco.perguntas.length + comOutro + 9);
});

test("CSV põe o texto de Outra na coluna logo depois da pergunta dona", () => {
  const csv = montarCsv(banco, [
    entrevista("a", jovem, { agregacao_valor: ["Outra"], agregacao_valor_outro: "Mel em sachê" }),
  ]);
  const [cabecalho, linha] = csv.split("\r\n");
  const colunas = cabecalho.slice(1, -1).split('","');
  const dona = colunas.indexOf("agregacao_valor");
  assert.equal(colunas[dona + 1], "agregacao_valor_outro");
  assert.ok(linha.includes('"Outra","Mel em sachê"'));
});

test("CSV mantém a coluna de pergunta que saiu do banco, com a resposta antiga", () => {
  assert.ok(!banco.perguntas.some((p) => p.id === "maiores_faltas"));
  const [cabecalho] = montarCsv(banco, [entrevista("a", jovem, { maiores_faltas: ["Água"] })]).split("\r\n");
  assert.ok(cabecalho.includes('"maiores_faltas"'));
});

test("consolidado conta cada opção e ignora quem nunca recebeu a pergunta", () => {
  const linhas = consolidar(banco, [
    entrevista("a", jovem, { escoamento: "Só uma parte" }),
    entrevista("b", adulta, { escoamento: "Só uma parte" }),
    entrevista("c", { categoria: "poder_publico", cargo: "prefeito", faixa: "adulto" }, {}),
  ]);
  const escoamento = linhas.find((l) => l.pergunta.id === "escoamento");
  assert.equal(escoamento.alcance, 2, "prefeito não responde escoamento");
  assert.equal(escoamento.contagem.find((c) => c.opcao === "Só uma parte").total, 2);
  assert.equal(escoamento.contagem.find((c) => c.opcao === "Sim, toda").total, 0);
});

test("consolidado soma cada opção marcada numa múltipla escolha", () => {
  const linhas = consolidar(banco, [
    entrevista("a", jovem, { desafios_territorio: ["Crédito", "Logística"] }),
    entrevista("b", jovem, { desafios_territorio: ["Crédito"] }),
  ]);
  const desafios = linhas.find((l) => l.pergunta.id === "desafios_territorio").contagem;
  assert.equal(desafios.find((c) => c.opcao === "Crédito").total, 2);
  assert.equal(desafios.find((c) => c.opcao === "Logística").total, 1);
  assert.equal(desafios.find((c) => c.opcao === "Governança").total, 0);
});

test("consolidado não mostra pergunta condicional que não abriu para ninguém", () => {
  const linhas = consolidar(banco, [entrevista("a", jovem, { escoamento: "Sim, toda" })]);
  assert.ok(!linhas.some((l) => l.pergunta.id === "escoamento_obstaculo"));
});

test("consolidado deixa de fora pergunta aberta, que não tem o que contar", () => {
  const linhas = consolidar(banco, [entrevista("a", jovem, { nome: "João" })]);
  assert.ok(!linhas.some((l) => l.pergunta.tipo === "texto" || l.pergunta.tipo === "audio"));
});

test("consolidado sem entrevista nenhuma devolve lista vazia em vez de quebrar", () => {
  assert.deepEqual(consolidar(banco, []), []);
});

test("as instruções do ZIP varrem toda extensão que o gravador produz", () => {
  for (const extensao of EXTENSOES) {
    assert.ok(
      LEIAME.includes(`audios/*/*.${extensao}`),
      `o comando do LEIAME não varre .${extensao}, que é o que o Safari ou o Chrome gravam`,
    );
  }
});

test("ZIP leva só o áudio que a resposta aponta, não a gravação descartada", () => {
  const e = entrevista("a", jovem, { jovem_uma_mudanca: { audioId: "novo" } });
  const audios = [{ id: "velho", perguntaId: "jovem_uma_mudanca" }, { id: "novo", perguntaId: "jovem_uma_mudanca" }];
  assert.deepEqual(audiosDaResposta(e, audios).map((a) => a.id), ["novo"]);
});

test("juntar entrevistas de outro aparelho não duplica por id e a local vence", () => {
  const local = entrevista("a", jovem, { nome: "local" });
  const juntas = juntarEntrevistas([local], [entrevista("a", jovem, { nome: "outro" }), entrevista("b", adulta, {})]);
  assert.deepEqual(juntas.map((e) => e.id), ["a", "b"]);
  assert.equal(juntas[0].respostas.nome, "local");
});

test("juntarEntrevistas mantém a cópia mais recente e a primeira no empate", () => {
  const local = entrevista("a", jovem, { nome: "local" });
  const nova = { ...local, respostas: { nome: "corrigido" }, atualizadaEm: "2026-09-05T12:00:00.000Z" };
  const empate = { ...nova, respostas: { nome: "empate" } };
  assert.deepEqual(juntarEntrevistas([local], [nova, local, empate]), [nova]);
  assert.deepEqual(juntarEntrevistas([nova], [local, empate]), [nova]);
  assert.deepEqual(juntarEntrevistas([], [local, nova, empate]), [nova]);
  const iniciadaDepois = { ...local, iniciadaEm: "2026-09-06T12:00:00.000Z" };
  assert.deepEqual(juntarEntrevistas([nova], [iniciadaDepois]), [iniciadaDepois]);
});

test("importar ZIP lê entrevistas.json e descarta item malformado", async () => {
  const zip = new JSZip();
  zip.file(
    "entrevistas.json",
    JSON.stringify({ banco: "1", entrevistas: [entrevista("a", jovem, {}), { id: 7, perfil: {} }, null, { id: "c" }] }),
  );
  const arquivo = new File([await zip.generateAsync({ type: "uint8array" })], "tablet2.zip");
  assert.deepEqual((await lerExportacao(arquivo)).map((e) => e.id), ["a"]);
});

test("importar JSON solto também funciona", async () => {
  const arquivo = new File([JSON.stringify({ entrevistas: [entrevista("a", jovem, {})] })], "entrevistas.json");
  assert.equal((await lerExportacao(arquivo)).length, 1);
});


test("pastas de homônimos no mesmo dia incluem o id e não se sobrescrevem", () => {
  const primeira = pastaDa(entrevista("12345678-aaaa", jovem, { nome: "João da Silva" }));
  const segunda = pastaDa(entrevista("87654321-bbbb", jovem, { nome: "João da Silva" }));
  assert.equal(primeira, "2026-09-04-joao-da-silva-12345678");
  assert.equal(segunda, "2026-09-04-joao-da-silva-87654321");
  assert.notEqual(primeira, segunda);
  assert.equal(pastaDa(entrevista("12345678-aaaa", jovem, {})), "2026-09-04-12345678");
});

test("ZIP inclui aparelho.json quando recebe o diagnóstico do aparelho", async (t) => {
  const anteriores = { indexedDB: globalThis.indexedDB, IDBRequest: globalThis.IDBRequest };
  t.after(() => Object.assign(globalThis, anteriores));
  globalThis.IDBRequest = class {};
  globalThis.indexedDB = {
    open: () => {
      const pedido = {};
      const db = {
        objectStoreNames: { contains: () => true },
        transaction: () => {
          const tx = {
            objectStore: () => ({
              getAll: () => {
                const leitura = new IDBRequest();
                leitura.result = [];
                queueMicrotask(() => {
                  leitura.onsuccess();
                  tx.oncomplete();
                });
                return leitura;
              },
            }),
          };
          return tx;
        },
      };
      queueMicrotask(() => { pedido.result = db; pedido.onsuccess(); });
      return pedido;
    },
  };
  const aparelho = { versao: "abc123", entrevistas: { total: 0, concluidas: 0 } };
  const { blob } = await montarZip(banco, { aparelho });
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  assert.ok(zip.file("aparelho.json"), "aparelho.json ausente no ZIP");
  assert.deepEqual(JSON.parse(await zip.file("aparelho.json").async("string")), aparelho);
  const semDiagnostico = await montarZip(banco);
  assert.equal((await JSZip.loadAsync(await semDiagnostico.blob.arrayBuffer())).file("aparelho.json"), null);
});

test("entrevistasDesde inclui novas e alteradas, exclui anteriores e a data igual", () => {
  const desde = "2026-09-05T12:00:00.000Z";
  const lista = [
    entrevista("antiga", jovem, {}),
    { ...entrevista("igual", jovem, {}), atualizadaEm: desde },
    { ...entrevista("alterada", jovem, {}), atualizadaEm: "2026-09-06T12:00:00.000Z" },
    { ...entrevista("nova", jovem, {}), iniciadaEm: "2026-09-07T12:00:00.000Z" },
  ];
  assert.deepEqual(entrevistasDesde(lista, desde).map((e) => e.id), ["alterada", "nova"]);
  assert.deepEqual(entrevistasDesde(lista), lista);
  assert.deepEqual(entrevistasDesde([], desde), []);
});

test("duracaoMinutos conta minutos inteiros e deixa entrevista aberta sem duração", () => {
  const aberta = entrevista("a", jovem, {});
  assert.equal(duracaoMinutos({ ...aberta, concluidaEm: "2026-09-04T12:07:59.000Z" }), 7);
  assert.equal(duracaoMinutos({ ...aberta, concluidaEm: "2026-09-04T12:00:30.000Z" }), 0);
  assert.equal(duracaoMinutos({ ...aberta, concluidaEm: "2026-09-05T12:00:00.000Z" }), 1440);
  assert.equal(duracaoMinutos(aberta), null);
});

test("CSV põe conclusão e duração depois de entrevistador, com vazio para entrevista aberta", () => {
  const concluida = { ...entrevista("a", jovem, {}), entrevistador: "Ana", concluidaEm: "2026-09-04T12:07:59.000Z" };
  const linhas = montarCsv(banco, [concluida, entrevista("b", jovem, {})]).split("\r\n");
  const colunas = linhas.map((linha) => linha.slice(1, -1).split('","'));
  assert.deepEqual(colunas[0].slice(6, 9), ["entrevistador", "concluida", "duracao_min"]);
  assert.deepEqual(colunas[1].slice(6, 9), ["Ana", "sim", "7"]);
  assert.deepEqual(colunas[2].slice(6, 9), ["", "não", ""]);
});
