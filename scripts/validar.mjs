// Bateria funcional: exercita o app no navegador de verdade, do jeito que ele roda em campo.
// Precisa de um Chrome com microfone falso, porque a gravação e a transcrição são o caminho
// que nenhum teste de unidade alcança:
//   chrome --headless=new --remote-debugging-port=9223 \
//     --use-fake-device-for-media-stream --use-fake-ui-for-media-stream \
//     --use-file-for-fake-audio-capture=<arquivo.wav>
//   npm run validar
import { comandos, conectar, espera } from "./cdp.mjs";

const BASE = process.env.BASE_URL ?? "https://formula-de-impacto.pages.dev";
const PORTA = Number(process.env.CDP_PORT ?? 9223);
const SO = process.env.CENARIO;
const SINCRONIZAR = process.env.SINCRONIZAR === "1";

const { cdp, js, fechar } = await conectar(PORTA);
const { clicar, preencher, passarPelaTranca, limparAparelho } = comandos(js);

const resultados = [];
function checar(nome, ok, detalhe = "") {
  resultados.push({ nome, ok, detalhe });
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
}

async function cenario(nome, corpo) {
  if (SO && !nome.startsWith(SO)) return;
  console.log(`\n## ${nome}`);
  try {
    await corpo();
  } catch (erro) {
    checar(`${nome}: rodou até o fim`, false, String(erro.message ?? erro).slice(0, 120));
  }
}

const irPara = async (rota = "/") => {
  await cdp("Page.navigate", { url: `${BASE}${rota}` });
  await espera(2600);
};

const rede = (offline) =>
  cdp("Network.emulateNetworkConditions", {
    offline,
    latency: 0,
    downloadThroughput: offline ? 0 : -1,
    uploadThroughput: offline ? 0 : -1,
  });

const textoDaTela = () => js(`return document.body.innerText;`);
const contarCartoes = () => js(`return document.querySelectorAll(".cartao").length;`);

const clicarOpcao = (rotulo) =>
  js(`
    const alvo = [...document.querySelectorAll(".opcao")].find((b) => b.textContent.trim() === ${JSON.stringify(rotulo)});
    if (!alvo) return false;
    alvo.click();
    return true;
  `);

const respostasGravadas = () =>
  js(`
    return new Promise((res) => {
      const abrir = indexedDB.open("entrevista-campo");
      abrir.onsuccess = () => {
        const db = abrir.result;
        if (!db.objectStoreNames.contains("entrevistas")) return res(null);
        const pedido = db.transaction(["entrevistas"], "readonly").objectStore("entrevistas").getAll();
        pedido.onsuccess = () => res(pedido.result.map((e) => ({ id: e.id, respostas: e.respostas, concluidaEm: e.concluidaEm ?? null })));
        pedido.onerror = () => res(null);
      };
      abrir.onerror = () => res(null);
      setTimeout(() => res("timeout"), 4000);
    });
  `);

// Espera uma condição na página em vez de dormir um tempo fixo: transcrição no servidor
// não tem duração previsível, e sleep generoso o bastante para o pior caso torna a
// bateria inutilizável.
async function ate(condicao, segundos, passo = 1000) {
  const limite = Date.now() + segundos * 1000;
  while (Date.now() < limite) {
    if (await condicao()) return true;
    await espera(passo);
  }
  return false;
}

await cdp("Page.enable");
await cdp("Runtime.enable");
await cdp("Network.enable");
if (!SINCRONIZAR) {
  await cdp("Network.setBlockedURLs", { urls: ["*/api/sincronizar*", "*/api/painel*"] });
}
await cdp("Emulation.setDeviceMetricsOverride", { width: 800, height: 1280, deviceScaleFactor: 1, mobile: true });

// ---------------------------------------------------------------------------

await cenario("1-tranca", async () => {
  await irPara("/");
  await limparAparelho();
  await irPara("/");

  checar("1-tranca: aparelho novo pede cadastro", await js(`return Boolean(document.querySelector("#nome"));`));
  await passarPelaTranca("1234");
  checar("1-tranca: acesso criado destranca", (await textoDaTela()).includes("Quem você vai entrevistar?"));

  await js(`sessionStorage.clear(); return true;`);
  await irPara("/");
  const pedePin = await js(`return Boolean(document.querySelector("#pin")) && !document.querySelector("#nome");`);
  checar("1-tranca: sessão encerrada volta a pedir PIN, não recadastro", pedePin);

  await passarPelaTranca("9999");
  const barrou = await js(`return Boolean(document.querySelector("#pin"));`);
  checar("1-tranca: PIN errado não entra", barrou, barrou ? "" : "entrou com 9999");

  await passarPelaTranca("1234");
  checar("1-tranca: PIN certo entra", (await textoDaTela()).includes("Quem você vai entrevistar?"));

  await irPara("/");
  checar("1-tranca: sessão aberta sobrevive ao reload", (await textoDaTela()).includes("Quem você vai entrevistar?"));
});

// ---------------------------------------------------------------------------

const abrirEntrevista = async (perfil) => {
  await irPara("/");
  // Cada cenário roda numa aba nova e a sessão destrancada mora no sessionStorage, que é
  // por aba: sem passar pela tranca aqui, a tela de perfil nem chega a existir.
  await passarPelaTranca("1234");
  for (const rotulo of perfil) {
    if (!(await clicar(rotulo))) throw new Error(`botão sumiu: ${rotulo}`);
    await espera(300);
  }
  await clicar("Começar entrevista");
  await espera(2400);
};

await cenario("2-montagem", async () => {
  await abrirEntrevista(["Agricultor(a) familiar", "Jovem (até 29 anos)", "Mulher"]);
  const jovem = await contarCartoes();
  const temJuventude = (await textoDaTela()).includes("continuar morando na zona rural");
  checar("2-montagem: agricultora jovem recebe de 23 a 41 perguntas", jovem >= 23 && jovem <= 41, `${jovem} perguntas`);
  checar("2-montagem: perfil jovem recebe a pergunta de permanência no campo", temJuventude);

  await abrirEntrevista(["Poder público", "Prefeito(a)", "Homem"]);
  const prefeito = await contarCartoes();
  const tela = await textoDaTela();
  checar("2-montagem: prefeito recebe de 23 a 41 perguntas", prefeito >= 23 && prefeito <= 41, `${prefeito} perguntas`);
  checar("2-montagem: prefeito não recebe pergunta de juventude rural", !tela.includes("continuar morando na zona rural"));
  checar("2-montagem: prefeito recebe pergunta de gestão", tela.includes("gargalo"));
});

// ---------------------------------------------------------------------------

await cenario("3-condicional", async () => {
  await abrirEntrevista(["Agricultor(a) familiar", "Adulto", "Homem"]);

  await clicarOpcao("Só uma parte");
  await espera(700);
  const abriu = (await textoDaTela()).includes("O que impede escoar a produção");
  checar("3-condicional: resposta parcial abre a pergunta de obstáculo", abriu);

  await clicarOpcao("Falta de transporte");
  await espera(900);
  // Filtra pelo id da URL: `getAll` devolve na ordem da chave, que é um uuid, então a
  // última da lista não é a entrevista aberta.
  const daTela = async () => {
    const id = await js(`return new URLSearchParams(location.search).get("id");`);
    return (await respostasGravadas())?.find((e) => e.id === id)?.respostas ?? {};
  };
  const antes = await daTela();
  checar("3-condicional: resposta da condicional é gravada", "escoamento_obstaculo" in antes, Object.keys(antes).join(","));

  await clicarOpcao("Sim, toda");
  await espera(900);
  const fechou = !(await textoDaTela()).includes("O que impede escoar a produção");
  checar("3-condicional: mudar a resposta de origem fecha a condicional", fechou);

  const depois = await daTela();
  checar(
    "3-condicional: resposta órfã não sobra no banco",
    !("escoamento_obstaculo" in depois),
    "escoamento_obstaculo" in depois ? "ficou gravada e iria para o relatório" : "",
  );
});

// ---------------------------------------------------------------------------

await cenario("4-persistencia", async () => {
  await abrirEntrevista(["Agricultor(a) familiar", "Adulto", "Mulher"]);
  await preencher("Nome do entrevistado", "Maria das Graças Silva");
  await preencher("Comunidade", "Sítio Bom Jardim");
  await espera(1200);

  const url = await js(`return location.href;`);
  await cdp("Page.navigate", { url });
  await espera(2600);

  const tela = await textoDaTela();
  const campo = await js(`
    const c = [...document.querySelectorAll("input")].find((i) => (i.getAttribute("aria-label") || "").includes("Nome do entrevistado"));
    return c ? c.value : "";
  `);
  checar("4-persistencia: resposta sobrevive ao recarregar a aba", campo === "Maria das Graças Silva", campo);
  checar("4-persistencia: entrevista aberta volta pelo id da URL", !tela.includes("não encontrada"));
});

// ---------------------------------------------------------------------------

const acharGravador = () =>
  js(`
    const b = [...document.querySelectorAll("button")].find((x) => /Gravar resposta|Gravar de novo/.test(x.textContent));
    if (!b) return null;
    b.scrollIntoView({ block: "center" });
    return b.textContent.trim();
  `);

const gravar = async (segundos) => {
  if (!(await acharGravador())) throw new Error("nenhum botão de gravar na tela");
  await js(`
    const b = [...document.querySelectorAll("button")].find((x) => /Gravar resposta|Gravar de novo/.test(x.textContent));
    b.click();
    return true;
  `);
  const comecou = await ate(async () => (await textoDaTela()).includes("Parar —"), 8);
  if (!comecou) throw new Error("gravação não começou: microfone falso não entregou faixa");
  await espera(segundos * 1000);
  await js(`
    const b = [...document.querySelectorAll("button")].find((x) => /^Parar/.test(x.textContent.trim()));
    if (b) b.click();
    return true;
  `);
};

const transcricaoNaTela = () =>
  js(`
    const t = [...document.querySelectorAll("textarea")].map((x) => x.value.trim()).filter(Boolean);
    return t[0] ?? "";
  `);

const filaPendente = () => js(`return JSON.parse(localStorage.getItem("transcricoes-pendentes") || "[]");`);

await cenario("5-transcricao", async () => {
  await abrirEntrevista(["Agricultor(a) familiar", "Adulto", "Homem"]);
  await rede(false);

  await gravar(12);
  const salvou = await ate(async () => (await js(`return document.querySelectorAll("audio").length > 0;`)), 15);
  checar("5-transcricao: áudio gravado fica anexado à resposta", salvou);

  const veio = await ate(async () => (await transcricaoNaTela()).length > 10, 90, 2000);
  const texto = await transcricaoNaTela();
  checar("5-transcricao: servidor devolve texto do áudio", veio, texto.slice(0, 90));
  checar(
    "5-transcricao: texto sai em português, não traduzido",
    /\b(que|não|para|com|uma|dos|então|você|gente)\b/i.test(texto),
    texto ? "" : "nada voltou",
  );
  checar("5-transcricao: nada fica pendente quando havia sinal", (await filaPendente()).length === 0);
});

// ---------------------------------------------------------------------------

await cenario("6-offline", async () => {
  await abrirEntrevista(["Agricultor(a) familiar", "Adulto", "Homem"]);
  await js(`localStorage.removeItem("transcricoes-pendentes"); return true;`);

  await rede(true);
  await js(`window.dispatchEvent(new Event("offline")); return true;`);
  await gravar(6);

  const avisou = await ate(async () => (await textoDaTela()).includes("Sem sinal para passar para texto agora"), 20);
  checar("6-offline: sem sinal, a tela avisa que o áudio ficou guardado", avisou);

  const fila = await filaPendente();
  checar("6-offline: pendência fica anotada com entrevista, pergunta e áudio", fila.length === 1 && Boolean(fila[0]?.audioId), JSON.stringify(fila).slice(0, 120));

  const audioSalvo = await js(`
    return new Promise((res) => {
      const abrir = indexedDB.open("entrevista-campo");
      abrir.onsuccess = () => {
        const db = abrir.result;
        const p = db.transaction(["audios"], "readonly").objectStore("audios").count();
        p.onsuccess = () => res(p.result);
        p.onerror = () => res(-1);
      };
      abrir.onerror = () => res(-1);
      setTimeout(() => res(-1), 4000);
    });
  `);
  checar("6-offline: o áudio é gravado no aparelho mesmo sem rede", audioSalvo > 0, `${audioSalvo} áudios`);

  await rede(false);
  await js(`window.dispatchEvent(new Event("online")); return true;`);
  const voltou = await ate(async () => (await transcricaoNaTela()).length > 10, 90, 2000);
  checar("6-offline: a volta da rede transcreve sozinha, sem o entrevistador pedir", voltou, (await transcricaoNaTela()).slice(0, 90));
  checar("6-offline: a fila esvazia depois de transcrever", (await filaPendente()).length === 0);
});

// ---------------------------------------------------------------------------

await cenario("7-service-worker", async () => {
  await rede(false);
  await irPara("/");
  const ativou = await ate(
    async () => js(`const r = await navigator.serviceWorker.getRegistration(); return Boolean(r && r.active);`),
    25,
  );
  checar("7-service-worker: service worker registra e ativa", ativou);

  await rede(true);
  await irPara("/");
  // Aba nova sem sinal cai na tranca, porque a sessão destrancada vive no sessionStorage.
  // O que se mede aqui é o app ter subido do cache, não ter chegado à tela de perfil.
  const subiu = await js(`return Boolean(document.querySelector("#pin") || document.querySelector(".conteudo"));`);
  const tela = await textoDaTela();
  checar("7-service-worker: app sobe do cache sem sinal nenhum", subiu && !tela.includes("ERR_INTERNET"), tela.slice(0, 70).replace(/\n/g, " "));

  await passarPelaTranca("1234");
  checar("7-service-worker: dá para entrar e abrir a tela de perfil offline", (await textoDaTela()).includes("Quem você vai entrevistar?"));

  await irPara("/consolidado/");
  const consolidado = await textoDaTela();
  checar("7-service-worker: rota interna abre sem sinal", !consolidado.includes("ERR_INTERNET") && consolidado.length > 20, consolidado.slice(0, 60).replace(/\n/g, " "));
  await rede(false);
});

// ---------------------------------------------------------------------------

await cenario("8-banco-resiliente", async () => {
  await irPara("/");
  const antes = (await respostasGravadas())?.length ?? 0;

  // Simula o que aconteceu em produção: uma limpeza de dados do site apaga os stores e a
  // conexão guardada continua apontando para o banco morto. O app tem que recriar sozinho
  // e, principalmente, não pode levar junto as entrevistas já registradas.
  await js(`
    return new Promise((res) => {
      const abrir = indexedDB.open("entrevista-campo");
      abrir.onsuccess = () => {
        const db = abrir.result;
        const proxima = db.version + 1;
        db.close();
        const subir = indexedDB.open("entrevista-campo", proxima);
        subir.onupgradeneeded = () => subir.result.deleteObjectStore("audios");
        subir.onsuccess = () => { subir.result.close(); res(true); };
        subir.onerror = () => res(false);
      };
      abrir.onerror = () => res(false);
      setTimeout(() => res("timeout"), 5000);
    });
  `);

  await irPara("/");
  await passarPelaTranca("1234");
  const tela = await textoDaTela();
  checar("8-banco-resiliente: app abre depois de perder um store", tela.includes("Quem você vai entrevistar?"), tela.slice(0, 70).replace(/\n/g, " "));

  const recriou = await js(`
    return new Promise((res) => {
      const abrir = indexedDB.open("entrevista-campo");
      abrir.onsuccess = () => res([...abrir.result.objectStoreNames].sort().join(","));
      abrir.onerror = () => res("erro");
      setTimeout(() => res("timeout"), 4000);
    });
  `);
  checar("8-banco-resiliente: store perdido é recriado", recriou === "audios,entrevistas,importadas,pedacos", String(recriou));

  const depois = (await respostasGravadas())?.length ?? 0;
  checar("8-banco-resiliente: entrevistas já registradas não são perdidas", depois >= antes, `${antes} antes, ${depois} depois`);
});

// ---------------------------------------------------------------------------

await cenario("9-api", async () => {
  // O fetch precisa sair de uma página da própria origem: de `about:blank` ele é
  // cross-origin e morre em "Failed to fetch" antes de a função ser chamada.
  await irPara("/");
  const vazio = await js(`
    const r = await fetch("${BASE}/api/transcrever", { method: "POST", body: new Blob([]) });
    return { status: r.status, corpo: await r.text() };
  `);
  checar("9-api: áudio vazio é recusado com mensagem, não com erro cru", vazio.status === 400, `${vazio.status} ${vazio.corpo.slice(0, 70)}`);

  const grande = await js(`
    const r = await fetch("${BASE}/api/transcrever", { method: "POST", body: new Blob([new Uint8Array(25 * 1024 * 1024)]) });
    return { status: r.status, corpo: await r.text() };
  `);
  checar("9-api: áudio acima do teto é recusado antes de chamar o modelo", grande.status === 413, `${grande.status} ${grande.corpo.slice(0, 70)}`);

  const lixo = await js(`
    const r = await fetch("${BASE}/api/transcrever", { method: "POST", body: new Blob([new Uint8Array(2048).fill(7)]) });
    return { status: r.status };
  `);
  checar("9-api: bytes que não são áudio não derrubam a função", lixo.status >= 400 && lixo.status < 600, `${lixo.status}`);
});


// ---------------------------------------------------------------------------

// Regressão encontrada pelo agente da TestSprite: `respondida` só olhava `audioId`, então
// quem digitava a resposta aberta em vez de gravar não contava no progresso, não ganhava o
// selo e saía como "não respondida" na ficha — com o texto na tela.
await cenario("10-resposta-escrita", async () => {
  await abrirEntrevista(["Agricultor(a) familiar", "Adulto", "Homem"]);

  // Lê o rodapé, não o corpo inteiro: "N de N" também aparece no contador de marcadas
  // de pergunta múltipla, e o primeiro casamento não é o progresso.
  const contar = () => js(`
    const r = document.querySelector(".rodape");
    const m = r && r.innerText.match(/(\\d+) de (\\d+)/);
    return m ? Number(m[1]) : -1;
  `);
  const antes = await contar();

  const escreveu = await preencher(
    "O que precisaria acontecer para a sua renda melhorar?",
    "Precisaria de estrada melhor para escoar a produção.",
  );
  checar("10-resposta-escrita: pergunta aberta aceita texto digitado", escreveu);
  await espera(1200);

  const depois = await contar();
  checar("10-resposta-escrita: texto digitado sobe o progresso", depois === antes + 1, `${antes} para ${depois}`);

  const concluirLiberado = await js(`
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Concluir");
    return Boolean(b) && !b.disabled;
  `);
  checar("10-resposta-escrita: dá para concluir com resposta só escrita", concluirLiberado);

  await clicar("Concluir");
  await espera(2600);
  const ficha = await textoDaTela();
  const achou = ficha.includes("Precisaria de estrada melhor para escoar a produção.");
  checar("10-resposta-escrita: a ficha imprime o texto, não \"não respondida\"", achou);
});

// ---------------------------------------------------------------------------

const respostaGravada = async () => {
  const id = await js(`return new URLSearchParams(location.search).get("id");`);
  const respostas = (await respostasGravadas())?.find((e) => e.id === id)?.respostas ?? {};
  return { id, valor: Object.values(respostas).find((r) => r?.audioId) };
};

// A duração vinha do estado preso no closure de quando a gravação começou: 0 na primeira,
// e a da gravação anterior no "Gravar de novo".
await cenario("11-duracao", async () => {
  await abrirEntrevista(["Agricultor(a) familiar", "Adulto", "Homem"]);
  await rede(true);
  await gravar(6);
  await ate(async () => Boolean((await respostaGravada()).valor), 15);
  const primeira = (await respostaGravada()).valor?.duracao;
  checar("11-duracao: primeira gravação guarda a duração real", primeira >= 5 && primeira <= 8, `${primeira} s`);

  await gravar(3);
  const antigo = (await respostaGravada()).valor?.audioId;
  await ate(async () => (await respostaGravada()).valor?.duracao !== primeira, 15);
  const segunda = (await respostaGravada()).valor?.duracao;
  checar("11-duracao: regravar guarda a duração nova, não a anterior", segunda >= 2 && segunda <= 5, `${segunda} s, antes ${primeira} s (${antigo})`);
  await rede(false);
});

// ---------------------------------------------------------------------------

// A fila só andava com o gravador daquela pergunta montado. Recarregar e sair da entrevista
// deixava o áudio pendente para sempre.
await cenario("12-fila-recarregada", async () => {
  await abrirEntrevista(["Agricultor(a) familiar", "Adulto", "Homem"]);
  await js(`localStorage.removeItem("transcricoes-pendentes"); return true;`);
  await rede(true);
  await gravar(8);
  const anotou = await ate(async () => (await filaPendente()).length === 1, 20);
  checar("12-fila-recarregada: sem sinal, o áudio entra na fila", anotou);
  const { id } = await respostaGravada();

  await rede(false);
  await irPara("/");
  const esvaziou = await ate(async () => (await filaPendente()).length === 0, 90, 2000);
  checar("12-fila-recarregada: fora da entrevista, a fila esvazia sozinha", esvaziou);
  const texto = await ate(async () => {
    const entrevista = (await respostasGravadas())?.find((e) => e.id === id);
    return Object.values(entrevista?.respostas ?? {}).some((r) => r?.audioId && (r.texto ?? "").length > 10);
  }, 10);
  checar("12-fila-recarregada: o texto chega na resposta gravada no aparelho", texto);
});

// ---------------------------------------------------------------------------

// Fica por último: o limite dura um minuto e derrubaria as transcrições dos outros cenários.
await cenario("13-limite", async () => {
  await irPara("/");
  const status = await js(`
    const lista = [];
    for (let i = 0; i < 25; i++) {
      const r = await fetch("${BASE}/api/transcrever", { method: "POST", body: new Blob([]) });
      lista.push(r.status);
    }
    return lista;
  `);
  checar("13-limite: rajada de pedidos do mesmo IP recebe 429", status.includes(429), status.join(","));
});

// ---------------------------------------------------------------------------

await cenario("14-sw-precache", async () => {
  await rede(false);
  await irPara("/");
  await passarPelaTranca("1234");
  const controla = await ate(() => js(`return Boolean(navigator.serviceWorker?.controller);`), 25);
  checar("14-sw-precache: service worker controla a página", controla);
  if (!controla) throw new Error("service worker não assumiu o controle");
  await cdp("Network.setCacheDisabled", { cacheDisabled: true });
  try {
    await rede(true);
    await irPara("/aparelho/");
    const aparelho = await textoDaTela();
    checar("14-sw-precache: aparelho abre offline sem visita anterior no cenário",
      aparelho.includes("Versão do app:") && !aparelho.includes("Quem você vai entrevistar?"), aparelho.slice(0, 120));
    await irPara("/relatorio/");
    const ficha = await textoDaTela();
    checar("14-sw-precache: relatório abre offline sem cair na página inicial",
      ficha.includes("Entrevista não encontrada neste aparelho.") && !ficha.includes("Quem você vai entrevistar?"), ficha.slice(0, 120));
  } finally {
    await rede(false);
    await cdp("Network.setCacheDisabled", { cacheDisabled: false });
  }
});

await cenario("15-gravador-falha", async () => {
  await abrirEntrevista(["Agricultor(a) familiar", "Adulto", "Homem"]);
  await js(`
    window.__gravarOriginal = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...argumentos) {
      if (this.name === "audios") throw new Error("falha de armazenamento simulada");
      return window.__gravarOriginal.apply(this, argumentos);
    };
    const botao = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Gravar resposta");
    window.__gravadorSabotado = botao?.parentElement;
    return Boolean(botao);
  `);
  try {
    await gravar(3);
    const avisou = await ate(() => js(`
      return Boolean(window.__gravadorSabotado?.innerText.includes("Não consegui guardar o áudio no aparelho. Anote a resposta no campo abaixo."));
    `), 10);
    checar("15-gravador-falha: falha ao guardar áudio aparece na tela", avisou);
    const liberou = await js(`
      const botao = window.__gravadorSabotado?.querySelector("button");
      return Boolean(botao) && botao.textContent.trim() === "Gravar resposta" && !botao.disabled;
    `);
    checar("15-gravador-falha: botão volta para Gravar", liberou);
  } finally {
    await js(`
      IDBObjectStore.prototype.put = window.__gravarOriginal;
      delete window.__gravarOriginal;
      delete window.__gravadorSabotado;
      return true;
    `);
  }
});

await cenario("16-pedacos", async () => {
  await rede(false);
  await abrirEntrevista(["Agricultor(a) familiar", "Adulto", "Homem"]);
  await acharGravador();
  const perguntaId = await js(`
    const botao = [...document.querySelectorAll("button")].find((b) => /Gravar resposta/.test(b.textContent));
    const id = botao.closest(".cartao").id.slice(2);
    botao.click();
    return id;
  `);
  const comecou = await ate(async () => (await textoDaTela()).includes("Parar —"), 8);
  if (!comecou) throw new Error("gravação não começou");
  await espera(12000);
  const contarPedacos = () => js(`
    return new Promise((res, rejeitar) => {
      const abrir = indexedDB.open("entrevista-campo");
      abrir.onsuccess = () => {
        const db = abrir.result;
        const tx = db.transaction("pedacos", "readonly");
        const pedido = tx.objectStore("pedacos").count();
        pedido.onsuccess = () => res(pedido.result);
        tx.oncomplete = () => db.close();
        tx.onerror = () => rejeitar(tx.error);
      };
      abrir.onerror = () => rejeitar(abrir.error);
    });
  `);
  checar("16-pedacos: gravação salva pelo menos um pedaço antes de parar", (await contarPedacos()) > 0);
  const id = await js(`return new URLSearchParams(location.search).get("id");`);
  await cdp("Page.reload", { ignoreCache: true });
  const recuperou = await ate(async () => {
    const entrevista = (await respostasGravadas())?.find((e) => e.id === id);
    return Boolean(entrevista?.respostas[perguntaId]?.audioId);
  }, 20);
  checar("16-pedacos: recarregar durante a gravação recupera áudio na pergunta", recuperou);
  const limpou = await ate(async () => (await contarPedacos()) === 0, 10);
  checar("16-pedacos: recuperação esvazia o store de pedaços", limpou);
  const anexado = await ate(() => js(`return Boolean(document.querySelector("#p-${perguntaId} audio"));`), 10);
  checar("16-pedacos: tela aberta recebe o áudio recuperado", anexado);
});

await cenario("17-indice", async () => {
  await rede(false);
  await abrirEntrevista(["Agricultor(a) familiar", "Adulto", "Mulher"]);
  for (const largura of [390, 820]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width: largura, height: 1280, deviceScaleFactor: 1, mobile: true });
    await js(`document.querySelector(".indice a:last-child").click(); return true;`);
    await espera(300);
    const posicao = await js(`
      const indice = document.querySelector(".indice");
      const chip = indice.querySelector("a:last-child");
      const secao = document.getElementById(chip.hash.slice(1));
      const topo = secao.getBoundingClientRect().top;
      const base = indice.getBoundingClientRect().bottom;
      return { topo, base, cabe: document.documentElement.scrollWidth <= innerWidth };
    `);
    checar(`17-indice: chip leva seção para perto do topo em ${largura} px`, posicao.topo >= posicao.base && posicao.topo - posicao.base < 45, JSON.stringify(posicao));
    checar(`17-indice: índice cabe sem alargar a página em ${largura} px`, posicao.cabe);
  }
  await preencher("Nome do entrevistado", "Entrevista retomada");
  await preencher("Comunidade", "Comunidade do teste");
  await espera(1200);
  const primeiraPendente = await js(`
    return [...document.querySelectorAll(".cartao[id]")].find((c) => !c.querySelector(".selo-feito"))?.id;
  `);
  const id = await js(`return new URLSearchParams(location.search).get("id");`);
  await irPara("/");
  await irPara(`/entrevista/?id=${id}`);
  const posicao = await js(`
    const cartao = document.getElementById(${JSON.stringify(primeiraPendente)});
    const topo = cartao.getBoundingClientRect().top;
    const base = document.querySelector(".indice").getBoundingClientRect().bottom;
    return { topo, base };
  `);
  checar("17-indice: reabrir entrevista rola até a primeira pendente", posicao.topo >= posicao.base && posicao.topo - posicao.base < 45, JSON.stringify(posicao));
});

const guardar = (store, lista) => js(`
  return new Promise((res, rejeitar) => {
    const abrir = indexedDB.open("entrevista-campo");
    abrir.onsuccess = () => {
      const db = abrir.result;
      const tx = db.transaction(${JSON.stringify(store)}, "readwrite");
      const store = tx.objectStore(${JSON.stringify(store)});
      ${JSON.stringify(lista)}.forEach((entrevista) => store.put(entrevista));
      tx.oncomplete = () => { db.close(); res(true); };
      tx.onerror = () => { db.close(); rejeitar(tx.error); };
      tx.onabort = () => { db.close(); rejeitar(tx.error); };
    };
    abrir.onerror = () => rejeitar(abrir.error);
  });
`);

await cenario("18-consolidado", async () => {
  await rede(false);
  await irPara("/");
  await passarPelaTranca("1234");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 820, height: 1280, deviceScaleFactor: 1, mobile: true });
  const prefixo = `validacao-consolidado-${Date.now()}`;
  const entrevistas = ["agricultor", "ater"].map((categoria, indice) => ({
    id: `${prefixo}-${indice}`,
    perfil: { categoria, faixa: "adulto", genero: "feminino" },
    respostas: { nome: `Consolidado ${indice}`, comunidade: "Sítio Novo", qualidade_de_vida: "Muito boa" },
    entrevistador: "Validação",
    iniciadaEm: "2026-10-01T12:00:00.000Z",
    concluidaEm: "2026-10-01T12:20:00.000Z",
  }));
  await guardar("entrevistas", entrevistas);
  await irPara("/consolidado/");
  const contar = () => js(`return Number(document.querySelector("#total-entrevistas")?.dataset.total ?? -1);`);
  const carregou = await ate(async () => (await contar()) >= 2, 10);
  checar("18-consolidado: mapa de visão aparece", carregou && await js(`return Boolean(document.querySelector("table.mapa-visao"));`));
  const largura = await js(`
    return Math.max(0, ...[...document.querySelectorAll(".contagem .trilho.dados span")].map((barra) => barra.getBoundingClientRect().width));
  `);
  checar("18-consolidado: barra tem mais de 200 px numa janela de 820 px", largura > 200, `${largura} px`);
  const antes = await contar();
  await guardar("importadas", [{ ...entrevistas[0], id: `${prefixo}-importada`, respostas: { ...entrevistas[0].respostas, nome: "Importada persistida" } }]);
  await cdp("Page.reload", { ignoreCache: true });
  const contou = await ate(async () => (await contar()) === antes + 1, 10);
  checar("18-consolidado: entrevista importada continua contada após recarregar", contou, `${antes} antes, ${await contar()} depois`);
  await cdp("Page.reload", { ignoreCache: true });
  const persistiu = await ate(async () => (await contar()) === antes + 1, 10);
  checar("18-consolidado: importada sobrevive a outro reload", persistiu);
});

await cenario("22-painel", async () => {
  await rede(false);
  await irPara("/");
  await limparAparelho();
  await irPara("/");
  await passarPelaTranca("1234");
  const conta = await js(`return JSON.parse(localStorage.getItem("acesso-formula-impacto"));`);
  if (!conta?.id) throw new Error("cadastro não criou o ID do entrevistador");
  const prefixo = `validacao-painel-${Date.now()}`;
  await guardar("entrevistas", ["agricultor", "agricultor", "ater"].map((categoria, i) => ({
    id: `${prefixo}-${i}`,
    perfil: { categoria, faixa: "adulto", genero: "feminino" },
    respostas: { nome: `Painel ${i}`, comunidade: "Sítio Novo", qualidade_de_vida: "Muito boa" },
    entrevistadorId: conta.id,
    entrevistador: conta.nome,
    iniciadaEm: "2026-10-02T12:00:00.000Z",
    concluidaEm: "2026-10-02T12:20:00.000Z",
  })));
  await cdp("Emulation.setDeviceMetricsOverride", { width: 360, height: 800, deviceScaleFactor: 1, mobile: true });
  try {
    await irPara("/painel/");
    const tela = await textoDaTela();
    checar("22-painel: mostra o grupo mais ouvido", tela.includes("Agricultor(a) familiar — 2 de 3"));
    const maioria = await js(`
      const titulo = [...document.querySelectorAll("h2")].find((h) => h.textContent === "O que a maioria respondeu");
      return Boolean(titulo?.parentElement.innerText.includes("Muito boa — 100% (3 de 3)"));
    `);
    checar("22-painel: maioria usa o alcance dos três perfis", maioria);
    checar("22-painel: cabe sem rolagem horizontal em 360 px", await js(`return document.documentElement.scrollWidth <= innerWidth;`));
  } finally {
    await cdp("Emulation.setDeviceMetricsOverride", { width: 800, height: 1280, deviceScaleFactor: 1, mobile: true });
  }
});

await cenario("23-sincronizar", async () => {
  if (!SINCRONIZAR) {
    console.log("pulado 23-sincronizar: use SINCRONIZAR=1 para gravar no banco");
    return;
  }
  await rede(false);
  await irPara("/");
  await limparAparelho();
  try {
    await rede(true);
    await irPara("/");
    await passarPelaTranca("1234");
    const conta = await js(`return JSON.parse(localStorage.getItem("acesso-formula-impacto"));`);
    const id = `validacao-envio-${Date.now()}`;
    const versao = new Date().toISOString();
    await guardar("entrevistas", [{
      id, entrevistadorId: conta.id, entrevistador: conta.nome,
      perfil: { categoria: "ater", genero: "feminino" }, respostas: { nome: "Sem sinal" },
      iniciadaEm: versao, atualizadaEm: versao,
    }]);
    await rede(false);
    await js(`window.dispatchEvent(new Event("online")); return true;`);
    const chegou = await ate(() => js(`
      try {
        const conta = JSON.parse(localStorage.getItem("acesso-formula-impacto"));
        const resposta = await fetch("/api/painel", { headers: { authorization: "Bearer " + conta.id + "." + conta.segredo } });
        if (!resposta.ok) return false;
        return (await resposta.json()).entrevistas.some((e) => e.id === ${JSON.stringify(id)});
      } catch { return false; }
    `), 20);
    checar("23-sincronizar: entrevista offline chega ao banco quando a rede volta", chegou);
    const marcada = await ate(() => js(`
      return new Promise((res, rejeitar) => {
        const abrir = indexedDB.open("entrevista-campo");
        abrir.onsuccess = () => {
          const db = abrir.result;
          const tx = db.transaction("entrevistas", "readonly");
          const pedido = tx.objectStore("entrevistas").get(${JSON.stringify(id)});
          pedido.onsuccess = () => res(pedido.result?.enviadaEm === ${JSON.stringify(versao)});
          tx.oncomplete = () => db.close();
          tx.onerror = () => { db.close(); rejeitar(tx.error); };
        };
        abrir.onerror = () => rejeitar(abrir.error);
      });
    `), 5);
    checar("23-sincronizar: enviadaEm fica gravado no IndexedDB", marcada);
  } finally {
    await rede(false);
  }
});

await cenario("24-isolamento", async () => {
  if (!SINCRONIZAR) {
    console.log("pulado 24-isolamento: use SINCRONIZAR=1 para gravar no banco");
    return;
  }
  const conta = (nome) => ({ id: crypto.randomUUID(), nome, segredo: [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("") });
  const a = conta("Validação A");
  const b = conta("Validação B");
  const a1 = crypto.randomUUID();
  const b1 = crypto.randomUUID();
  const headers = (c) => ({ authorization: `Bearer ${c.id}.${c.segredo}`, "content-type": "application/json" });
  const postar = (c, id) => fetch(`${BASE}/api/sincronizar`, {
    method: "POST", headers: headers(c),
    body: JSON.stringify({ nome: c.nome, entrevistas: [{ id, perfil: { categoria: "ater" }, respostas: {}, iniciadaEm: new Date().toISOString() }], apagadas: [] }),
  });
  checar("24-isolamento: A envia sua entrevista", (await postar(a, a1)).ok);
  checar("24-isolamento: B envia sua entrevista", (await postar(b, b1)).ok);
  const resposta = await fetch(`${BASE}/api/painel`, { headers: headers(a) });
  const dados = await resposta.json();
  checar("24-isolamento: A lê a1 e não lê b1", resposta.ok && dados.entrevistas.some((e) => e.id === a1) && !dados.entrevistas.some((e) => e.id === b1));
  const errado = await fetch(`${BASE}/api/painel`, { headers: headers({ ...a, segredo: b.segredo }) });
  checar("24-isolamento: segredo errado de A recebe 401", errado.status === 401);
});

await cenario("19-csp", async () => {
  await rede(false);
  await irPara("/");
  await passarPelaTranca("1234");
  const cabecalho = await js(`
    const resposta = await fetch("/", { cache: "no-store" });
    return resposta.headers.get("content-security-policy");
  `);
  checar("19-csp: resposta da página inicial traz CSP", Boolean(cabecalho), cabecalho || "ausente");
  await js(`sessionStorage.setItem("validacao-csp", "[]"); return true;`);
  const script = await cdp("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      window.addEventListener("securitypolicyviolation", (evento) => {
        const lista = JSON.parse(sessionStorage.getItem("validacao-csp") || "[]");
        lista.push({ rota: location.pathname, diretiva: evento.effectiveDirective, bloqueado: evento.blockedURI });
        sessionStorage.setItem("validacao-csp", JSON.stringify(lista));
      });
    `,
  });
  if (!script.identifier) throw new Error("não consegui instalar o listener de CSP");
  try {
    for (const rota of ["/", "/aparelho/", "/relatorio/", "/consolidado/", "/painel/", "/entrevista/"]) {
      await irPara(rota);
    }
    const violacoes = await js(`return JSON.parse(sessionStorage.getItem("validacao-csp") || "[]");`);
    checar("19-csp: navegação pelas rotas não viola a política", violacoes.length === 0, JSON.stringify(violacoes));
  } finally {
    await cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier: script.identifier });
    await js(`sessionStorage.removeItem("validacao-csp"); return true;`);
  }
});

const iniciarGravacaoDeTeste = async () => {
  if (!(await acharGravador())) throw new Error("nenhum botão de gravar na tela");
  const origem = await js(`
    const botao = [...document.querySelectorAll("button")].find((b) => /Gravar resposta/.test(b.textContent));
    if (!botao) throw new Error("botão de gravar não encontrado");
    const perguntaId = botao.closest(".cartao").id.slice(2);
    const entrevistaId = new URLSearchParams(location.search).get("id");
    botao.click();
    return { entrevistaId, perguntaId };
  `);
  const comecou = await ate(async () => (await textoDaTela()).includes("Parar —"), 8);
  if (!comecou) throw new Error("gravação não começou");
  return origem;
};

const consultaGravacaoNoBanco = (entrevistaId, perguntaId) => `
  return new Promise((res, rejeitar) => {
    const abrir = indexedDB.open("entrevista-campo");
    abrir.onsuccess = () => {
      const db = abrir.result;
      const tx = db.transaction(["entrevistas", "audios", "pedacos"], "readonly");
      let audioId;
      let audioExiste = false;
      let pedacos;
      const entrevista = tx.objectStore("entrevistas").get(${JSON.stringify(entrevistaId)});
      entrevista.onsuccess = () => {
        audioId = entrevista.result?.respostas?.[${JSON.stringify(perguntaId)}]?.audioId;
        if (!audioId) return;
        const audio = tx.objectStore("audios").get(audioId);
        audio.onsuccess = () => { audioExiste = Boolean(audio.result); };
      };
      const quantidade = tx.objectStore("pedacos").count();
      quantidade.onsuccess = () => { pedacos = quantidade.result; };
      tx.oncomplete = () => { db.close(); res({ audioId, audioExiste, pedacos }); };
      tx.onerror = () => { db.close(); rejeitar(tx.error); };
      tx.onabort = () => { db.close(); rejeitar(tx.error); };
    };
    abrir.onerror = () => rejeitar(abrir.error);
  });
`;

await cenario("20-sair-gravando", async () => {
  await rede(false);
  await abrirEntrevista(["Agricultor(a) familiar", "Adulto", "Homem"]);
  const { entrevistaId, perguntaId } = await iniciarGravacaoDeTeste();
  await espera(12000);
  const saiu = await js(`
    const voltar = document.querySelector('.topo a[aria-label="Voltar"]');
    if (!voltar) return false;
    voltar.click();
    return true;
  `);
  if (!saiu) throw new Error("Voltar do topo não encontrado");
  await espera(2000);
  checar("20-sair-gravando: Voltar sai da entrevista", await js(`return !location.pathname.startsWith("/entrevista");`));
  const gravacao = await js(consultaGravacaoNoBanco(entrevistaId, perguntaId));
  checar("20-sair-gravando: resposta já aponta para o áudio no banco", Boolean(gravacao.audioId));
  checar("20-sair-gravando: áudio existe no store audios", gravacao.audioExiste);
  checar("20-sair-gravando: store pedacos está vazio", gravacao.pedacos === 0, `${gravacao.pedacos} pedaços`);
});

await cenario("21-audio-no-banco", async () => {
  await rede(false);
  await abrirEntrevista(["Agricultor(a) familiar", "Adulto", "Homem"]);
  const { entrevistaId, perguntaId } = await iniciarGravacaoDeTeste();
  await espera(3000);
  const gravacao = await js(`
    const cartao = document.getElementById(${JSON.stringify(`p-${perguntaId}`)});
    const botao = [...cartao.querySelectorAll("button")].find((b) => /^Parar/.test(b.textContent.trim()));
    if (!botao) throw new Error("botão de parar não encontrado");
    botao.click();
    const limite = Date.now() + 10000;
    while (!/^Gravar/.test(botao.textContent.trim())) {
      if (Date.now() >= limite) throw new Error("botão não voltou para Gravar em 10 s");
      await new Promise((res) => setTimeout(res, 10));
    }
    ${consultaGravacaoNoBanco(entrevistaId, perguntaId)}
  `);
  checar("21-audio-no-banco: resposta já tem audioId antes do autosave", Boolean(gravacao.audioId));
  checar("21-audio-no-banco: áudio já existe no store audios", gravacao.audioExiste);
});

fechar();

const falhas = resultados.filter((r) => !r.ok);
console.log(`\n${resultados.length} verificações · ${resultados.length - falhas.length} passaram · ${falhas.length} falharam`);
for (const f of falhas) console.log(`  FALHA ${f.nome}${f.detalhe ? ` — ${f.detalhe}` : ""}`);
process.exit(falhas.length ? 1 : 0);
