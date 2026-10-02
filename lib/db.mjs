const NOME = "entrevista-campo";

let conexao;

const STORES = ["entrevistas", "audios", "pedacos"];

function criarStores(db) {
  if (!db.objectStoreNames.contains("entrevistas")) db.createObjectStore("entrevistas", { keyPath: "id" });
  if (!db.objectStoreNames.contains("audios")) {
    db.createObjectStore("audios", { keyPath: "id" }).createIndex("entrevistaId", "entrevistaId");
  }
  if (!db.objectStoreNames.contains("pedacos")) {
    db.createObjectStore("pedacos", { keyPath: "id" }).createIndex("gravacaoId", "gravacaoId");
  }
}

const abrirEm = (versao) =>
  new Promise((resolve, reject) => {
    const pedido = versao ? indexedDB.open(NOME, versao) : indexedDB.open(NOME);
    pedido.onupgradeneeded = () => criarStores(pedido.result);
    pedido.onsuccess = () => {
      const db = pedido.result;
      // Conexão guardada para sempre continua apontando para um banco morto quando o
      // navegador limpa os dados do site ou outra aba sobe a versão. Zerá-la aqui faz a
      // próxima operação reabrir, em vez de estourar "object stores was not found".
      db.onclose = () => (conexao = null);
      db.onversionchange = () => {
        db.close();
        conexao = null;
      };
      resolve(db);
    };
    pedido.onerror = () => reject(pedido.error);
    pedido.onblocked = () => reject(new Error("banco bloqueado por outra aba aberta"));
  });

function abrir() {
  if (conexao) return conexao;
  conexao = (async () => {
    let db = await abrirEm();
    // Um banco pode existir na versão atual e mesmo assim estar sem os stores, quando uma
    // limpeza de dados do site pega o meio do caminho. Só uma versão nova recria o que falta.
    if (STORES.some((nome) => !db.objectStoreNames.contains(nome))) {
      const proxima = db.version + 1;
      db.close();
      db = await abrirEm(proxima);
    }
    return db;
  })().catch((erro) => {
    conexao = null;
    throw erro;
  });
  return conexao;
}

async function transacao(stores, modo, tarefa, segundaTentativa = false) {
  let db;
  try {
    db = await abrir();
    return await executar(db, stores, modo, tarefa);
  } catch (erro) {
    // Banco morto devolve NotFoundError ou InvalidStateError. Reabrir resolve; repetir
    // uma vez só evita transformar erro real em laço infinito.
    const recuperavel = ["NotFoundError", "InvalidStateError"].includes(erro?.name);
    if (segundaTentativa || !recuperavel) throw erro;
    conexao = null;
    return transacao(stores, modo, tarefa, true);
  }
}

function executar(db, stores, modo, tarefa) {
  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(stores, modo);
    } catch (erro) {
      return reject(erro);
    }
    const pedido = tarefa(...stores.map((nome) => tx.objectStore(nome)));

    // O valor do pedido é lido em `onsuccess`, que sempre precede `oncomplete`. Ler dentro
    // do `oncomplete` devolvia o próprio IDBRequest, e quem esperava o dado ficava preso.
    let valor;
    if (pedido instanceof IDBRequest) pedido.onsuccess = () => (valor = pedido.result);

    // Só `oncomplete` garante gravação em disco; `onsuccess` do pedido ainda pode abortar.
    tx.oncomplete = () => resolve(valor);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const novoId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const salvarEntrevista = (entrevista) =>
  transacao(["entrevistas"], "readwrite", (store) =>
    store.put({ ...entrevista, atualizadaEm: new Date().toISOString() }),
  );

export const obterEntrevista = (id) => transacao(["entrevistas"], "readonly", (store) => store.get(id));

export const listarEntrevistas = () =>
  transacao(["entrevistas"], "readonly", (store) => store.getAll()).then((lista) =>
    (lista ?? []).sort((a, b) => b.iniciadaEm.localeCompare(a.iniciadaEm)),
  );

export const salvarAudio = (audio) => transacao(["audios"], "readwrite", (store) => store.put(audio));

export const obterAudio = (id) => transacao(["audios"], "readonly", (store) => store.get(id));

export const audiosDaEntrevista = (entrevistaId) =>
  transacao(["audios"], "readonly", (store) => store.index("entrevistaId").getAll(entrevistaId));

export const apagarEntrevista = (id) =>
  transacao(["entrevistas", "audios"], "readwrite", (entrevistas, audios) => {
    entrevistas.delete(id);
    const busca = audios.index("entrevistaId").getAllKeys(id);
    busca.onsuccess = () => busca.result.forEach((chave) => audios.delete(chave));
  });

export const salvarPedaco = (pedaco) => transacao(["pedacos"], "readwrite", (store) => store.put(pedaco));

export const listarPedacos = () => transacao(["pedacos"], "readonly", (store) => store.getAll());

export const apagarPedacos = (gravacaoId) =>
  transacao(["pedacos"], "readwrite", (store) => {
    const busca = store.index("gravacaoId").getAllKeys(gravacaoId);
    busca.onsuccess = () => busca.result.forEach((chave) => store.delete(chave));
  });
