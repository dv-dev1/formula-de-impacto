import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const codigo = (arquivo) => readFileSync(new URL(`../scripts/${arquivo}`, import.meta.url), "utf8");

async function painel({ cartoes = [], falha = false } = {}) {
  const fonte = codigo("validar.mjs");
  const trecho = fonte.slice(fonte.indexOf('await cenario("22-painel"'), fonte.indexOf('await cenario("23-sincronizar"'));
  const checagens = [];
  let media = "";
  const contexto = {
    cenario: async (nome, executar) => executar(),
    rede: async () => {}, irPara: async () => {}, limparAparelho: async () => {}, passarPelaTranca: async () => {}, guardar: async () => {},
    textoDaTela: async () => "Agricultor(a) familiar — 2 de 3",
    cdp: async (metodo, parametros) => { if (metodo === "Emulation.setEmulatedMedia") media = parametros.media; },
    checar: (nome, passou) => checagens.push({ nome, passou }),
    js: async (expressao) => {
      if (media === "print" && falha) throw new Error("Falha ao ler impressão.");
      return runInNewContext(`(async () => { ${expressao} })()`, {
        localStorage: { getItem: () => '{"id":"ana"}' }, innerWidth: 360,
        document: {
          documentElement: { scrollWidth: 360 },
          querySelectorAll: (seletor) => seletor === "h2" ? [{ textContent: "O que a maioria respondeu", parentElement: { innerText: "Muito boa — 100% (3 de 3)" } }]
            : seletor === "button" ? [{ textContent: "Salvar em PDF" }] : cartoes,
        },
        getComputedStyle: (elemento) => ({ breakInside: elemento.breakInside }),
      });
    },
  };
  let erro;
  try {
    await runInNewContext(`(async () => { ${trecho} })()`, contexto);
  } catch (falha) {
    erro = falha;
  }
  return { media, checagens, erro };
}

test("22-painel restaura mídia mesmo com erro na leitura de impressão", async () => {
  const resultado = await painel({ falha: true });
  assert.equal(resultado.erro?.message, "Falha ao ler impressão.");
  assert.equal(resultado.media, "");
});

test("22-painel recusa seletor vazio e cartões cortáveis", async () => {
  for (const [cartoes, esperado] of [[[], false], [[{ breakInside: "avoid" }], true], [[{ breakInside: "auto" }], false]]) {
    const resultado = await painel({ cartoes });
    assert.equal(resultado.erro, undefined);
    assert.equal(resultado.checagens.find((c) => c.nome.includes("pode ser cortado")).passou, esperado);
    assert.equal(resultado.media, "");
  }
});

test("usabilidade registra botao-sumido se Criar conta nova não existir", async () => {
  const fonte = codigo("usabilidade.mjs");
  const trecho = fonte.slice(fonte.indexOf('registrar(device, "tranca-entrar"'), fonte.indexOf("await semearConta();", fonte.indexOf('registrar(device, "tranca-entrar"')));
  for (const encontrou of [false, true]) {
    const problemas = [];
    await runInNewContext(`(async () => { ${trecho} })()`, {
      problemas, device: { nome: "tablet" }, AUDITORIA: "",
      registrar() {}, foto: async () => {}, espera: async () => {}, js: async () => [],
      clicar: async () => encontrou,
    });
    assert.deepEqual(problemas.map((p) => ({ ...p })), encontrou ? [] : [
      { device: "tablet", tela: "tranca-entrar", tipo: "botao-sumido", texto: "Criar conta nova" },
    ]);
  }
});
