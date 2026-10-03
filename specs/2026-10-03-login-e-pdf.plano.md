# Login no banco e PDF do painel — plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: `subagent-driven-development` (recomendado) ou `executing-plans`.
> Cada tarefa usa checkbox (`- [ ]`). O agente pai commita ao fim de cada tarefa; o executor **não** commita.

**Objetivo:** o entrevistador entra com usuário e senha em qualquer aparelho, e o painel e o consolidado
juntam as entrevistas do aparelho com as que a conta já mandou ao D1. O painel ganha "Salvar em PDF".

**Arquitetura:** a migração `0002` põe usuário e senha (PBKDF2) em `entrevistadores` e cria `sessoes`,
uma linha por aparelho. O `segredo_hash` de cada tablet antigo vira a primeira sessão dele. O
`autenticar(db, cabecalho)` substitui a checagem repetida em `painel.js` e `sincronizar.js`. O cliente
guarda o token no campo `segredo` da conta local, então todo `Bearer id.segredo` existente continua
funcionando. A senha também destrava o aparelho offline, pelo hash local `sha256(sal:senha)`.

**Tech stack:** Next.js 15 (export estático), Cloudflare Pages Functions, D1 (SQLite), `node:test` +
`node:sqlite`, Chrome via CDP cru (`scripts/cdp.mjs`).

**Spec:** `specs/2026-10-03-login-e-pdf.md` (leia antes de cada tarefa). Contexto anterior:
`specs/2026-10-02-painel-e-banco.md`.

Todos os caminhos são relativos a `repo/` (`/Users/dvdev/Documents/agent-memory/projects/form-workspace/repo`),
branch `login-e-pdf`.

## Restrições globais

- Não mudar o fluxo da entrevista nem `data/perguntas.json`.
- Usuário: `trim()` + `toLowerCase()`, casa com `/^[a-z0-9._-]{3,40}$/`, único no banco. Sem e-mail.
- Senha: de 6 a 200 caracteres. PBKDF2-SHA256, **100000** iterações (o teto do Workers), sal aleatório.
- Bloqueio: 10 erros seguidos → `bloqueado_ate = agora + 15 min`, e a resposta é 429 mesmo com a senha
  certa. Um acerto zera `falhas` e `bloqueado_ate`.
- O servidor responde `{ id, token, nome, papel, usuario }` em `/api/conta` e `/api/entrar`.
- O registro implícito em `functions/api/sincronizar.js` continua, para tablets antigos.
- Estilo: ES modules, ponto e vírgula, aspas duplas, `.mjs` em `lib/`. Mensagens ao usuário em pt-BR.
- Comentário só diz **por quê**, no máximo uma linha de comentário a cada dez de código. Sem banner.
- **`lib/enviar.mjs`: cada `import` fica numa linha só.** O `test/enviar.test.mjs` remove os imports com
  `/^import .*;$/gm` e roda o módulo numa VM; import em várias linhas quebra o teste.
- Sem dependência nova.
- Commit é do agente pai. Mensagens sem trailer `Co-Authored-By` nem rodapé de ferramenta.

## Review Focus

Entradas que a spec implica e que os testes de cada tarefa precisam cobrir (o teste está na tarefa dona):

1. Usuário digitado com maiúscula e espaço (`" Carla "`) entra como `carla`, e `"CARLA"` repetido dá 409 — Tarefa 2.
2. Token válido de uma conta enviado com o `id` de outra conta recebe 401 — Tarefa 1.
3. Bloqueio vencido: a senha certa volta a entrar e zera as falhas — Tarefa 2.
4. "Sair deste aparelho" com entrevista não enviada, apagada pendente ou conta sem usuário é recusado,
   porque apagar a conta local perderia o acesso — Tarefa 4.
5. Primeiro acesso sem internet mostra "Sem internet" e não grava conta nenhuma no aparelho — Tarefa 4
   (unidade) e Tarefa 7 (`1-tranca`).

---

### Tarefa 1: migração 0002, `sessoes` e `autenticar`

**Arquivos:**
- Criar: `migrations/0002_login.sql`
- Modificar: `lib/sincronizar.mjs` (acrescentar `responder`, `lerJson`, `autenticar`)
- Modificar: `functions/api/sincronizar.js` (usar `autenticar`; o registro implícito abre sessão)
- Modificar: `functions/api/painel.js` (usar `autenticar`)
- Teste: `test/servidor.test.mjs`

**Interfaces:**
- Produz, em `lib/sincronizar.mjs`:
  - `responder(dados, status = 200): Response` — JSON com `content-type: application/json; charset=utf-8` e `cache-control: no-store`;
  - `lerJson(request): Promise<object | null>` — `null` se o corpo passar de 10 KB, não for JSON ou não for objeto;
  - `autenticar(db, cabecalho): Promise<linha de entrevistadores | null>`.
- Tabela `sessoes(token_hash TEXT PK, entrevistador_id TEXT, criada_em TEXT)`; colunas novas em
  `entrevistadores`: `usuario`, `senha_hash`, `senha_sal`, `falhas` (INTEGER, padrão 0), `bloqueado_ate`.

- [ ] **Passo 1: trocar o banco falso para aplicar as duas migrações e escrever os testes**

Em `test/servidor.test.mjs`, troque o começo de `bancoFalso` por:

```js
function bancoFalso(t, entreMigracoes = () => {}) {
  const sqlite = new DatabaseSync(":memory:");
  const migracao = (arquivo) => readFileSync(new URL(`../migrations/${arquivo}`, import.meta.url), "utf8");
  sqlite.exec(migracao("0001_inicial.sql"));
  entreMigracoes(sqlite);
  sqlite.exec(migracao("0002_login.sql"));
  t.after(() => sqlite.close());
```

(o resto da função fica igual). Acrescente no fim do arquivo:

```js
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
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `node --test test/servidor.test.mjs`
Esperado: FAIL em todos os testes, com `ENOENT ... 0002_login.sql`.

- [ ] **Passo 3: criar a migração**

`migrations/0002_login.sql`:

```sql
-- Login por usuário e senha. Cada aparelho que entra ganha uma sessão; o segredo de cada
-- tablet antigo vira a primeira sessão dele, para nenhum tablet perder o acesso.
ALTER TABLE entrevistadores ADD COLUMN usuario TEXT;
ALTER TABLE entrevistadores ADD COLUMN senha_hash TEXT;
ALTER TABLE entrevistadores ADD COLUMN senha_sal TEXT;
ALTER TABLE entrevistadores ADD COLUMN falhas INTEGER NOT NULL DEFAULT 0;
ALTER TABLE entrevistadores ADD COLUMN bloqueado_ate TEXT;
CREATE UNIQUE INDEX entrevistadores_usuario ON entrevistadores (usuario);

CREATE TABLE sessoes (
  token_hash TEXT PRIMARY KEY,
  entrevistador_id TEXT NOT NULL REFERENCES entrevistadores (id),
  criada_em TEXT NOT NULL
);

INSERT INTO sessoes (token_hash, entrevistador_id, criada_em)
SELECT segredo_hash, id, criado_em FROM entrevistadores;
```

Rode de novo: o segundo teste novo continua falhando, porque o cadastro implícito ainda não abre sessão
(`sessao?.entrevistador_id` é `undefined`). O primeiro já pode passar, porque o código antigo ainda
compara `segredo_hash`; o vermelho dele foi o `ENOENT` do Passo 2.

- [ ] **Passo 4: `autenticar`, `responder` e `lerJson` em `lib/sincronizar.mjs`**

Acrescente ao fim de `lib/sincronizar.mjs`:

```js
export const responder = (dados, status = 200) =>
  new Response(JSON.stringify(dados), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export async function lerJson(request) {
  const texto = await request.text();
  if (new TextEncoder().encode(texto).byteLength > 10 * 1024) return null;
  try {
    const valor = JSON.parse(texto);
    return objeto(valor) ? valor : null;
  } catch {
    return null;
  }
}

export async function autenticar(db, cabecalho) {
  const credencial = lerCredencial(cabecalho);
  if (!credencial) return null;
  return db.prepare(`
    SELECT e.* FROM sessoes s JOIN entrevistadores e ON e.id = s.entrevistador_id
    WHERE s.token_hash = ? AND s.entrevistador_id = ?
  `).bind(await hashDoSegredo(credencial.segredo), credencial.id).first();
}
```

- [ ] **Passo 5: usar `autenticar` nos dois handlers**

`functions/api/painel.js`: apague a constante local `responder`, importe
`import { autenticar, responder } from "../../lib/sincronizar.mjs";` e troque as linhas de credencial
(hoje `lerCredencial` + `SELECT * FROM entrevistadores` + comparação de `segredo_hash`) por:

```js
  const entrevistador = await autenticar(env.DB, request.headers.get("authorization"));
  if (!entrevistador) return responder({ erro: "Credencial inválida." }, 401);
```

e troque `credencial.id` por `entrevistador.id` na consulta do entrevistador comum.

`functions/api/sincronizar.js`: apague a constante local `responder` e importe
`import { autenticar, entrevistaValida, hashDoSegredo, lerCredencial, responder, versaoDe } from "../../lib/sincronizar.mjs";`.
Troque o bloco que vai de `const { id, segredo } = credencial;` até o `else if (... segredo_hash !== hash)`
inclusive por:

```js
  const { id, segredo } = credencial;
  const agora = new Date().toISOString();
  if (!(await autenticar(env.DB, request.headers.get("authorization")))) {
    if (await env.DB.prepare("SELECT 1 FROM entrevistadores WHERE id = ?").bind(id).first()) {
      return responder({ erro: "Credencial inválida." }, 401);
    }
    const nome = typeof corpo.nome === "string" ? corpo.nome.trim() : "";
    if (!nome || nome.length > 80) return responder({ erro: "Informe um nome de até 80 caracteres." }, 400);
    const hash = await hashDoSegredo(segredo);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO entrevistadores (id, nome, segredo_hash, criado_em) VALUES (?, ?, ?, ?)").bind(id, nome, hash, agora),
      env.DB.prepare("INSERT INTO sessoes (token_hash, entrevistador_id, criada_em) VALUES (?, ?, ?)").bind(hash, id, agora),
    ]);
  }
```

Mantenha o comentário `ponytail:` do topo do handler.

- [ ] **Passo 6: rodar e ver passar**

Run: `npm test`
Esperado: `ℹ fail 0`, incluindo os testes antigos de `servidor.test.mjs`.

- [ ] **Passo 7: commit (agente pai)**

```bash
git add migrations/0002_login.sql lib/sincronizar.mjs functions/api/sincronizar.js functions/api/painel.js test/servidor.test.mjs
git commit -m "feat: sessões por aparelho no D1 e autenticar compartilhado"
```

---

### Tarefa 2: `/api/conta` e `/api/entrar`, com bloqueio

**Arquivos:**
- Modificar: `lib/sincronizar.mjs` (acrescentar `normalizarUsuario`, `erroDeLogin`, `novoToken`, `hashDaSenha`)
- Criar: `functions/api/conta/index.js` (rota `/api/conta`)
- Criar: `functions/api/entrar.js` (rota `/api/entrar`)
- Teste: `test/sincronizar.test.mjs`, `test/servidor.test.mjs`

**Interfaces:**
- Consome: `responder`, `lerJson`, `hashDoSegredo` (Tarefa 1).
- Produz, em `lib/sincronizar.mjs` (o cliente também usa as duas primeiras):
  - `normalizarUsuario(valor): string` — `""` se não for string;
  - `erroDeLogin(usuario, senha): string` — `""` se válidos; senão a mensagem (a do usuário contém "usuário", a da senha contém "senha");
  - `novoToken(): string` — 64 hex;
  - `hashDaSenha(senha, sal): Promise<string>` — 64 hex.
- `POST /api/conta` `{ nome, usuario, senha }` → 200 `{ id, token, nome, papel: "entrevistador", usuario }`; 400 inválido; 409 repetido; 503 sem banco.
- `POST /api/entrar` `{ usuario, senha }` → 200 `{ id, token, nome, papel, usuario }`; 401 `{ erro: "Usuário ou senha errados." }`; 429 `{ erro: "Muitas tentativas erradas. Tente de novo em 15 minutos." }`.

- [ ] **Passo 1: testes de unidade**

Em `test/sincronizar.test.mjs`, acrescente `erroDeLogin, hashDaSenha, normalizarUsuario` ao import de
`../lib/sincronizar.mjs` e, no fim:

```js
test("hashDaSenha é PBKDF2-SHA256 com 100 mil iterações", async () => {
  assert.equal(await hashDaSenha("senha-123", "sal-fixo"), "bc03202770dd9f1517b38af0aeed5b8a9d8a02d4c154b6d6648e48264bbb4000");
  assert.notEqual(await hashDaSenha("senha-123", "outro-sal"), await hashDaSenha("senha-123", "sal-fixo"));
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
```

(O valor esperado veio de `crypto.pbkdf2Sync("senha-123", "sal-fixo", 100000, 32, "sha256")`.)

- [ ] **Passo 2: testes dos handlers**

Em `test/servidor.test.mjs`, acrescente os imports:

```js
import { onRequestPost as criarConta } from "../functions/api/conta/index.js";
import { onRequestPost as entrar } from "../functions/api/entrar.js";
```

troque o import de `../lib/sincronizar.mjs` por `import { hashDaSenha, hashDoSegredo } from "../lib/sincronizar.mjs";`
e acrescente depois de `const ler = ...`:

```js
const pedir = (handler, env, rota, corpo, headers = {}) => handler({
  env, request: new Request(`https://teste${rota}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(corpo) }),
});
const LOGIN = { nome: "Carla", usuario: "carla", senha: "senha-123" };
const tentar = (env, senha) => pedir(entrar, env, "/api/entrar", { usuario: "carla", senha });
```

No fim do arquivo:

```js
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
```

- [ ] **Passo 3: rodar e ver falhar**

Run: `npm test`
Esperado: FAIL — `hashDaSenha` não exportado / `Cannot find module .../functions/api/conta/index.js`.

- [ ] **Passo 4: funções em `lib/sincronizar.mjs`**

Troque `hashDoSegredo` e acrescente as funções novas:

```js
const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function hashDoSegredo(segredo) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(segredo)));
}

export const novoToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));

export async function hashDaSenha(senha, sal) {
  const chave = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveBits"]);
  // 100 mil é o teto do PBKDF2 no Workers: acima disso o deriveBits lança erro em produção.
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(sal), iterations: 100000 }, chave, 256);
  return hex(bits);
}

export const normalizarUsuario = (valor) => typeof valor === "string" ? valor.trim().toLowerCase() : "";

export function erroDeLogin(usuario, senha) {
  if (!/^[a-z0-9._-]{3,40}$/.test(usuario)) return "O usuário precisa ter de 3 a 40 letras sem acento, números, ponto, hífen ou sublinhado.";
  if (typeof senha !== "string" || senha.length < 6 || senha.length > 200) return "A senha precisa ter de 6 a 200 caracteres.";
  return "";
}
```

- [ ] **Passo 5: `functions/api/conta/index.js`**

```js
import { erroDeLogin, hashDaSenha, hashDoSegredo, lerJson, normalizarUsuario, novoToken, responder } from "../../../lib/sincronizar.mjs";

export async function onRequestPost({ request, env }) {
  // ponytail: cadastro aberto, como o do tablet; quem tiver o endereço cria conta.
  if (!env.DB) return responder({ erro: "Banco não está configurado." }, 503);
  const corpo = await lerJson(request);
  const nome = typeof corpo?.nome === "string" ? corpo.nome.trim() : "";
  const usuario = normalizarUsuario(corpo?.usuario);
  if (!nome || nome.length > 80) return responder({ erro: "Informe um nome de até 80 caracteres." }, 400);
  const invalido = erroDeLogin(usuario, corpo?.senha);
  if (invalido) return responder({ erro: invalido }, 400);
  const id = crypto.randomUUID();
  const token = novoToken();
  const tokenHash = await hashDoSegredo(token);
  const sal = novoToken().slice(0, 32);
  const agora = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO entrevistadores (id, nome, segredo_hash, criado_em, usuario, senha_hash, senha_sal) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(id, nome, tokenHash, agora, usuario, await hashDaSenha(corpo.senha, sal), sal),
      env.DB.prepare("INSERT INTO sessoes (token_hash, entrevistador_id, criada_em) VALUES (?, ?, ?)").bind(tokenHash, id, agora),
    ]);
  } catch (erro) {
    if (/UNIQUE/i.test(String(erro?.message))) return responder({ erro: "Este usuário já existe. Escolha outro." }, 409);
    throw erro;
  }
  return responder({ id, token, nome, papel: "entrevistador", usuario });
}
```

- [ ] **Passo 6: `functions/api/entrar.js`**

O `UPDATE` de falha é atômico (`falhas + 1` no SQL): ler, somar no JS e gravar deixaria tentativas em
paralelo zerarem a contagem umas das outras. Use só `?` posicional (o banco falso dos testes troca `?N`
por `?`, e um `?N` repetido desalinha os parâmetros).

```js
import { hashDaSenha, hashDoSegredo, lerJson, normalizarUsuario, novoToken, responder } from "../../lib/sincronizar.mjs";

const ERRADO = { erro: "Usuário ou senha errados." };
const BLOQUEIO_MS = 15 * 60 * 1000;

export async function onRequestPost({ request, env }) {
  if (!env.DB) return responder({ erro: "Banco não está configurado." }, 503);
  const corpo = await lerJson(request);
  const usuario = normalizarUsuario(corpo?.usuario);
  const senha = typeof corpo?.senha === "string" ? corpo.senha : "";
  if (!usuario || !senha || senha.length > 200) return responder(ERRADO, 401);
  const conta = await env.DB.prepare("SELECT * FROM entrevistadores WHERE usuario = ?").bind(usuario).first();
  if (!conta?.senha_hash) return responder(ERRADO, 401);
  const agora = new Date();
  // ponytail: tentativas simultâneas passam desta checagem antes do UPDATE; o teto é por rajada, não exato.
  if (conta.bloqueado_ate && conta.bloqueado_ate > agora.toISOString()) {
    return responder({ erro: "Muitas tentativas erradas. Tente de novo em 15 minutos." }, 429);
  }
  if (await hashDaSenha(senha, conta.senha_sal) !== conta.senha_hash) {
    await env.DB.prepare(`
      UPDATE entrevistadores SET
        bloqueado_ate = CASE WHEN falhas + 1 >= 10 THEN ? ELSE bloqueado_ate END,
        falhas = CASE WHEN falhas + 1 >= 10 THEN 0 ELSE falhas + 1 END
      WHERE id = ?
    `).bind(new Date(agora.getTime() + BLOQUEIO_MS).toISOString(), conta.id).run();
    return responder(ERRADO, 401);
  }
  const token = novoToken();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sessoes (token_hash, entrevistador_id, criada_em) VALUES (?, ?, ?)").bind(await hashDoSegredo(token), conta.id, agora.toISOString()),
    env.DB.prepare("UPDATE entrevistadores SET falhas = 0, bloqueado_ate = NULL WHERE id = ?").bind(conta.id),
  ]);
  return responder({ id: conta.id, token, nome: conta.nome, papel: conta.papel, usuario });
}
```

- [ ] **Passo 7: rodar e ver passar**

Run: `npm test`
Esperado: `ℹ fail 0`.

- [ ] **Passo 8: commit (agente pai)**

```bash
git add lib/sincronizar.mjs functions/api/conta/index.js functions/api/entrar.js test/sincronizar.test.mjs test/servidor.test.mjs
git commit -m "feat: criar conta e entrar com usuário e senha, com bloqueio após 10 erros"
```

---

### Tarefa 3: `/api/conta/vincular` para a conta antiga

**Arquivos:**
- Criar: `functions/api/conta/vincular.js` (rota `/api/conta/vincular`)
- Teste: `test/servidor.test.mjs`

**Interfaces:**
- Consome: `autenticar`, `responder`, `lerJson` (Tarefa 1); `erroDeLogin`, `normalizarUsuario`, `hashDaSenha`, `novoToken` (Tarefa 2).
- `POST /api/conta/vincular` com `authorization: Bearer id.segredo` e `{ usuario, senha }` → 200 `{ usuario }`;
  401 sem credencial válida; 409 se a conta já tem usuário ou o usuário é de outra conta; 400 inválido.

- [ ] **Passo 1: testes**

Em `test/servidor.test.mjs`, acrescente `import { onRequestPost as vincular } from "../functions/api/conta/vincular.js";` e:

```js
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
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `npm test`
Esperado: FAIL — `Cannot find module .../functions/api/conta/vincular.js`.

- [ ] **Passo 3: implementar**

`functions/api/conta/vincular.js`:

```js
import { autenticar, erroDeLogin, hashDaSenha, lerJson, normalizarUsuario, novoToken, responder } from "../../../lib/sincronizar.mjs";

export async function onRequestPost({ request, env }) {
  if (!env.DB) return responder({ erro: "Banco não está configurado." }, 503);
  const conta = await autenticar(env.DB, request.headers.get("authorization"));
  if (!conta) return responder({ erro: "Credencial inválida." }, 401);
  if (conta.usuario) return responder({ erro: "Esta conta já tem usuário." }, 409);
  const corpo = await lerJson(request);
  const usuario = normalizarUsuario(corpo?.usuario);
  const invalido = erroDeLogin(usuario, corpo?.senha);
  if (invalido) return responder({ erro: invalido }, 400);
  const sal = novoToken().slice(0, 32);
  try {
    await env.DB.prepare("UPDATE entrevistadores SET usuario = ?, senha_hash = ?, senha_sal = ? WHERE id = ? AND usuario IS NULL")
      .bind(usuario, await hashDaSenha(corpo.senha, sal), sal, conta.id).run();
  } catch (erro) {
    if (/UNIQUE/i.test(String(erro?.message))) return responder({ erro: "Este usuário já existe. Escolha outro." }, 409);
    throw erro;
  }
  return responder({ usuario });
}
```

- [ ] **Passo 4: rodar e ver passar**

Run: `npm test`
Esperado: `ℹ fail 0`.

- [ ] **Passo 5: commit (agente pai)**

```bash
git add functions/api/conta/vincular.js test/servidor.test.mjs
git commit -m "feat: conta antiga ganha usuário e senha por /api/conta/vincular"
```

---

### Tarefa 4: cliente — `acessar`, `vincular`, `buscarDoBanco`, `sair` e `minhasEntrevistas`

**Arquivos:**
- Modificar: `lib/enviar.mjs`
- Modificar: `lib/painel.mjs` (acrescentar `minhasEntrevistas`)
- Teste: `test/enviar.test.mjs`, `test/painel.test.mjs`

**Interfaces:**
- Consome: `POST /api/conta`, `/api/entrar`, `/api/conta/vincular` e `GET /api/painel` (Tarefas 1–3);
  `juntarEntrevistas(locais, importadas)` de `lib/exportar.mjs`; `daConta` de `lib/sincronizar.mjs`.
- Produz, em `lib/enviar.mjs`:
  - `ABERTA = "acesso-liberado"` (chave do `sessionStorage`, hoje constante privada da Tranca);
  - `embaralhar(senha, sal): Promise<string>` — `sha256("${sal}:${senha}")` em hex (o mesmo cálculo da Tranca hoje, compatível com as contas gravadas);
  - `acessar(caminho, campos): Promise<conta>` — `caminho` é `"/api/conta"` ou `"/api/entrar"`; grava em `localStorage[CHAVE]` `{ nome, usuario, sal, resumo, id, segredo: token, registrada: true }`; lança `Error` com a mensagem do servidor, ou `"Sem internet. Conecte o aparelho e tente de novo."` sem rede;
  - `vincular(usuario, senha): Promise<conta>` — sincroniza antes, posta com `Bearer`, troca `usuario`, `sal` e `resumo` locais;
  - `buscarDoBanco(): Promise<{ papel, entrevistadores, entrevistas } | null>` — nunca rejeita;
  - `sair(): Promise<string>` — `""` se saiu; senão o motivo da recusa.
- Produz, em `lib/painel.mjs`: `minhasEntrevistas(conta, locais, doBanco): entrevista[]`.

- [ ] **Passo 1: estender o harness e escrever os testes de `enviar`**

Em `test/enviar.test.mjs`, troque a função `aparelho` inteira por:

```js
function aparelho(fetch, AbortSignal = { timeout: () => undefined }, conta = { id: "ana", nome: "Ana", segredo: "ab".repeat(32), registrada: true }) {
  const entrevista = { id: "a1", entrevistadorId: conta?.id ?? "ana", perfil: {}, respostas: {}, iniciadaEm: "2026-10-01T12:00:00Z" };
  const erros = [];
  const armazem = new Map(conta ? [["acesso-formula-impacto", JSON.stringify(conta)]] : []);
  const contexto = {
    CHAVE: "acesso-formula-impacto", fetch, AbortSignal, TypeError, TextEncoder,
    crypto, Event, navigator: { onLine: true }, window: { dispatchEvent() {} },
    localStorage: { getItem: (chave) => armazem.get(chave) ?? null, setItem: (chave, valor) => armazem.set(chave, valor), removeItem: (chave) => armazem.delete(chave) },
    sessionStorage: { removeItem() {} },
    daConta, pendentesDeEnvio, versaoDe,
    listarEntrevistas: async () => [structuredClone(entrevista)],
    marcarEnviada: async (id, versao) => { if (id === entrevista.id) entrevista.enviadaEm = versao; },
    novoId: () => crypto.randomUUID(), registrarErro: (onde, erro) => erros.push([onde, erro.message]),
  };
  // A VM troca só as dependências do navegador; o envio executa o código do módulo.
  const modulo = runInNewContext(`${codigo}\n({ sincronizar, acessar, vincular, sair, buscarDoBanco, embaralhar });`, contexto);
  return { ...modulo, entrevista, erros, armazem };
}

const lerConta = (app) => JSON.parse(app.armazem.get("acesso-formula-impacto") ?? "null");
const ANA = { id: "ana", nome: "Ana", usuario: "ana", segredo: "ab".repeat(32), registrada: true };
```

Os objetos que voltam da VM são de outro realm: compare campo a campo (`assert.equal`), nunca o objeto
inteiro com `deepEqual`. Acrescente no fim:

```js
test("acessar grava a conta com o token no segredo e só o hash local da senha", async () => {
  const pedidos = [];
  const app = aparelho(async (url, opcoes) => {
    pedidos.push([url, JSON.parse(opcoes.body)]);
    return Response.json({ id: "id-1", token: "cd".repeat(32), nome: "Ana", papel: "entrevistador", usuario: "ana" });
  }, undefined, null);
  await app.acessar("/api/entrar", { usuario: "Ana", senha: "senha-123" });
  assert.deepEqual(pedidos, [["/api/entrar", { usuario: "Ana", senha: "senha-123" }]]);
  const conta = lerConta(app);
  assert.equal(conta.id, "id-1");
  assert.equal(conta.segredo, "cd".repeat(32));
  assert.equal(conta.usuario, "ana");
  assert.equal(conta.nome, "Ana");
  assert.equal(conta.registrada, true);
  assert.equal(conta.senha, undefined);
  assert.equal(conta.resumo, await app.embaralhar("senha-123", conta.sal));
  assert.notEqual(conta.resumo, await app.embaralhar("senha-errada", conta.sal));
});

test("acessar recusado mostra a mensagem do servidor e não grava conta", async () => {
  const app = aparelho(async () => Response.json({ erro: "Usuário ou senha errados." }, { status: 401 }), undefined, null);
  await assert.rejects(app.acessar("/api/entrar", { usuario: "ana", senha: "senha-123" }), /Usuário ou senha errados\./);
  assert.equal(lerConta(app), null);
});

test("acessar sem rede avisa que falta internet e não grava conta", async () => {
  const app = aparelho(async () => { throw new TypeError("Failed to fetch"); }, undefined, null);
  await assert.rejects(app.acessar("/api/conta", { nome: "Ana", usuario: "ana", senha: "senha-123" }), /Sem internet/);
  assert.equal(lerConta(app), null);
});

test("vincular envia com a credencial da conta e troca o hash local pela senha", async () => {
  const pedidos = [];
  const app = aparelho(async (url, opcoes) => {
    pedidos.push([url, opcoes.headers.authorization, JSON.parse(opcoes.body)]);
    return url === "/api/conta/vincular" ? Response.json({ usuario: "ana" }) : resposta();
  });
  await app.vincular("Ana", "senha-123");
  assert.deepEqual(pedidos.map(([url]) => url), ["/api/sincronizar", "/api/conta/vincular"]);
  assert.equal(pedidos[1][1], `Bearer ana.${"ab".repeat(32)}`);
  assert.deepEqual(pedidos[1][2], { usuario: "Ana", senha: "senha-123" });
  const conta = lerConta(app);
  assert.equal(conta.usuario, "ana");
  assert.equal(conta.id, "ana");
  assert.equal(conta.segredo, "ab".repeat(32));
  assert.equal(conta.resumo, await app.embaralhar("senha-123", conta.sal));
});

test("vincular sem a conta no banco pede internet em vez de mandar credencial desconhecida", async () => {
  const urls = [];
  const app = aparelho(async (url) => { urls.push(url); throw new TypeError("Failed to fetch"); }, undefined, { ...ANA, usuario: undefined, registrada: false });
  await assert.rejects(app.vincular("ana", "senha-123"), /ainda não chegou ao banco/);
  assert.deepEqual(urls, ["/api/sincronizar"]);
});

test("sair recusa conta sem usuário e entrevista não enviada, e sai depois do envio", async () => {
  assert.match(await aparelho(async () => resposta()).sair(), /usuário e senha/);
  const app = aparelho(async () => resposta(), undefined, ANA);
  assert.match(await app.sair(), /não enviadas/);
  assert.notEqual(lerConta(app), null);
  await app.sincronizar();
  assert.equal(await app.sair(), "");
  assert.equal(lerConta(app), null);
});

test("buscarDoBanco devolve null sem rede e o JSON do painel com a credencial", async () => {
  assert.equal(await aparelho(async () => { throw new TypeError("Failed to fetch"); }).buscarDoBanco(), null);
  assert.equal(await aparelho(async () => new Response("", { status: 401 })).buscarDoBanco(), null);
  let cabecalho;
  const app = aparelho(async (url, opcoes) => {
    cabecalho = [url, opcoes.headers.authorization];
    return Response.json({ papel: "entrevistador", entrevistadores: [], entrevistas: [{ id: "a1" }] });
  });
  const dados = await app.buscarDoBanco();
  assert.deepEqual(cabecalho, ["/api/painel", `Bearer ana.${"ab".repeat(32)}`]);
  assert.equal(dados.entrevistas[0].id, "a1");
});
```

- [ ] **Passo 2: teste de `minhasEntrevistas`**

Em `test/painel.test.mjs`, troque o import por `import { minhasEntrevistas, resumoDoPainel } from "../lib/painel.mjs";` e acrescente:

```js
test("minhasEntrevistas junta aparelho e banco só da conta, com a versão mais nova", () => {
  const conta = { id: "ana", nome: "Ana" };
  const base = { perfil: {}, respostas: {}, iniciadaEm: "2026-10-01T12:00:00Z" };
  const locais = [{ ...base, id: "a1", entrevistadorId: "ana", respostas: { nome: "velha" } }, { ...base, id: "x1", entrevistadorId: "bia" }];
  const doBanco = [
    { ...base, id: "a1", entrevistadorId: "ana", atualizadaEm: "2026-10-02T12:00:00Z", respostas: { nome: "nova" } },
    { ...base, id: "a2", entrevistadorId: "ana" },
    { ...base, id: "b1", entrevistadorId: "bia" },
  ];
  const minhas = minhasEntrevistas(conta, locais, doBanco);
  assert.deepEqual(minhas.map((e) => e.id).sort(), ["a1", "a2"]);
  assert.equal(minhas.find((e) => e.id === "a1").respostas.nome, "nova");
});
```

- [ ] **Passo 3: rodar e ver falhar**

Run: `npm test`
Esperado: FAIL — `acessar is not defined` na VM e `minhasEntrevistas is not a function`.

- [ ] **Passo 4: implementar em `lib/enviar.mjs`**

Acrescente depois de `let deNovo = false;` (imports continuam um por linha, sem mudar os existentes):

```js
export const ABERTA = "acesso-liberado";
const SEM_INTERNET = "Sem internet. Conecte o aparelho e tente de novo.";

// Isto tranca a tela, não protege o dado: quem abrir o devtools lê as entrevistas no IndexedDB.
export async function embaralhar(senha, sal) {
  const resumo = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${sal}:${senha}`));
  return [...new Uint8Array(resumo)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function postar(caminho, corpo, conta) {
  let resposta;
  try {
    resposta = await fetch(caminho, {
      method: "POST",
      signal: AbortSignal.timeout?.(30000),
      headers: { "content-type": "application/json", ...(conta && { authorization: `Bearer ${conta.id}.${conta.segredo}` }) },
      body: JSON.stringify(corpo),
    });
  } catch (erro) {
    if (erro instanceof TypeError || erro?.name === "TimeoutError") throw new Error(SEM_INTERNET);
    throw erro;
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(dados.erro || `O servidor recusou (HTTP ${resposta.status}).`);
  return dados;
}

export async function acessar(caminho, campos) {
  const dados = await postar(caminho, campos);
  const sal = crypto.randomUUID();
  const conta = { nome: dados.nome, usuario: dados.usuario, sal, resumo: await embaralhar(campos.senha, sal), id: dados.id, segredo: dados.token, registrada: true };
  localStorage.setItem(CHAVE, JSON.stringify(conta));
  return conta;
}

export async function vincular(usuario, senha) {
  await sincronizar();
  const conta = garantirIdentidade();
  if (!conta?.registrada) throw new Error("A conta ainda não chegou ao banco. Conecte à internet e tente de novo.");
  const dados = await postar("/api/conta/vincular", { usuario, senha }, conta);
  const sal = crypto.randomUUID();
  const atual = { ...garantirIdentidade(), usuario: dados.usuario, sal, resumo: await embaralhar(senha, sal) };
  localStorage.setItem(CHAVE, JSON.stringify(atual));
  return atual;
}

export async function buscarDoBanco() {
  const conta = garantirIdentidade();
  if (!conta?.id || !conta.segredo || navigator.onLine === false) return null;
  try {
    const resposta = await fetch("/api/painel", { signal: AbortSignal.timeout?.(30000), headers: { authorization: `Bearer ${conta.id}.${conta.segredo}` } });
    return resposta.ok ? await resposta.json() : null;
  } catch {
    return null;
  }
}
```

E, depois de `anotarApagada` (precisa de `lerApagadas`, que fica acima):

```js
export async function sair() {
  const conta = garantirIdentidade();
  if (conta && !conta.usuario) return "Crie usuário e senha antes de sair: sem eles a conta não volta.";
  if (conta && (lerApagadas().length || pendentesDeEnvio(await listarEntrevistas()).some((e) => daConta(e, conta)))) {
    return "Há entrevistas ainda não enviadas ao banco. Conecte à internet e espere o envio antes de sair.";
  }
  localStorage.removeItem(CHAVE);
  sessionStorage.removeItem(ABERTA);
  return "";
}
```

`vincular` chama `sincronizar`, que é declarada mais abaixo como `function` — o hoisting resolve; não mova nada.

- [ ] **Passo 5: implementar em `lib/painel.mjs`**

Troque a primeira linha por `import { consolidar, duracaoMinutos, juntarEntrevistas } from "./exportar.mjs";`,
acrescente `import { daConta } from "./sincronizar.mjs";` e, no fim:

```js
export const minhasEntrevistas = (conta, locais, doBanco) =>
  juntarEntrevistas(locais.filter((e) => daConta(e, conta)), doBanco.filter((e) => e.entrevistadorId === conta.id));
```

- [ ] **Passo 6: rodar e ver passar**

Run: `npm test` e `npm run build`
Esperado: `ℹ fail 0`; build gera `out/index.html` (a Tranca ainda tem o próprio `embaralhar`; tudo bem até a Tarefa 5).

- [ ] **Passo 7: commit (agente pai)**

```bash
git add lib/enviar.mjs lib/painel.mjs test/enviar.test.mjs test/painel.test.mjs
git commit -m "feat: cliente entra no banco, vincula conta antiga, lê o painel e sai do aparelho"
```

---

### Tarefa 5: Tranca com usuário e senha, aviso no Início e conta em `/aparelho/`

**Arquivos:**
- Modificar (reescrever): `components/Tranca.jsx`
- Modificar: `app/page.jsx` (aviso da conta antiga)
- Modificar (reescrever): `app/aparelho/page.jsx` (cartão "Conta")
- Modificar: `app/globals.css:264-266` (campo de senha com o mesmo estilo do de texto)

**Interfaces:**
- Consome: `ABERTA`, `acessar`, `embaralhar`, `vincular`, `sair`, `garantirIdentidade` (Tarefa 4);
  `erroDeLogin`, `normalizarUsuario` (Tarefa 2).
- Produz, para a bateria (Tarefa 7) — **ids e textos exatos**:
  - 1º acesso, modo entrar: `#usuario`, `#senha`, botão submit "Entrar", botão "Criar conta nova";
  - 1º acesso, modo criar: `#nome`, `#usuario`, `#senha`, `#confirmacao`, submit "Criar conta", botão "Já tenho conta";
  - conta com `usuario`: `#senha` (sem `#usuario`), submit "Entrar";
  - conta antiga (sem `usuario`): `#pin` de 4 números, submit "Entrar";
  - erro sempre em `p.aviso`; o Início da conta antiga mostra o texto "Crie usuário e senha".

- [ ] **Passo 1: reescrever `components/Tranca.jsx`**

```jsx
"use client";

import { useEffect, useState } from "react";

import { ABERTA, acessar, embaralhar } from "@/lib/enviar.mjs";
import { erroDeLogin, normalizarUsuario } from "@/lib/sincronizar.mjs";

import Icone from "./Icone";

export const CHAVE = "acesso-formula-impacto";
const TAMANHO = 4;
// Fora do https o navegador nem expõe `crypto.subtle`, e nenhuma senha funcionaria nunca.
const FORA_DO_HTTPS = "Este endereço não é seguro (precisa ser https ou localhost) e a senha não funciona nele.";

const ler = () => {
  try {
    return JSON.parse(localStorage.getItem(CHAVE) || "null");
  } catch {
    return null;
  }
};

export default function Tranca({ children }) {
  const [acesso, setAcesso] = useState(undefined);
  const [liberado, setLiberado] = useState(false);
  const [criar, setCriar] = useState(false);
  const [nome, setNome] = useState("");
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    setAcesso(ler());
    try {
      setLiberado(sessionStorage.getItem(ABERTA) === "1");
    } catch {
      setLiberado(false);
    }
  }, []);

  const abrir = () => {
    try {
      sessionStorage.setItem(ABERTA, "1");
    } catch {
      /* aba anônima: vale só enquanto a tela estiver aberta */
    }
    setLiberado(true);
    setSenha("");
    setErro("");
  };

  const digitar = (guardar) => (evento) => {
    guardar(evento.target.value);
    setErro("");
  };

  async function primeiroAcesso(evento) {
    evento.preventDefault();
    if (criar && !nome.trim()) return setErro("Diga seu nome — ele vai junto de cada entrevista.");
    const invalido = erroDeLogin(normalizarUsuario(usuario), senha);
    if (invalido) return setErro(invalido);
    if (criar && senha !== confirmacao) return setErro("As duas senhas não são iguais.");
    if (!window.isSecureContext) return setErro(FORA_DO_HTTPS);
    setOcupado(true);
    try {
      const conta = await acessar(criar ? "/api/conta" : "/api/entrar", criar ? { nome: nome.trim(), usuario, senha } : { usuario, senha });
      setAcesso(conta);
      abrir();
    } catch (falha) {
      setSenha("");
      setConfirmacao("");
      setErro(falha.message);
    } finally {
      setOcupado(false);
    }
  }

  async function destravar(evento) {
    evento.preventDefault();
    try {
      if ((await embaralhar(senha, acesso.sal)) !== acesso.resumo) {
        setSenha("");
        return setErro(acesso.usuario ? "Senha errada." : "Código errado.");
      }
      abrir();
    } catch {
      setErro(window.isSecureContext ? "Não consegui conferir a senha. Feche e abra o app." : FORA_DO_HTTPS);
    }
  }

  if (acesso === undefined) return null;
  if (liberado) return children;

  const primeiro = acesso === null;
  const antiga = !primeiro && !acesso.usuario;
  const novaConta = primeiro && criar;

  return (
    <>
      <header className="topo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="marca-topo" src="/icone-192.png" alt="" width={48} height={48} />
        <h1>
          <b>CAIXA</b> Fórmula de Impacto
        </h1>
      </header>

      <div className="marca-abertura">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="CAIXA Fórmula de Impacto" width={196} height={248} />
      </div>

      <div className="folha">
        <main className="conteudo">
          <form className="cartao" onSubmit={primeiro ? primeiroAcesso : destravar}>
            <p className="enunciado">{primeiro ? (criar ? "Nova conta" : "Entre com sua conta") : `Olá, ${acesso.nome}`}</p>

            {novaConta && (
              <>
                <label className="rotulo" htmlFor="nome">Seu nome</label>
                <input id="nome" type="text" value={nome} onChange={digitar(setNome)} placeholder="Quem vai fazer as entrevistas" autoComplete="name" />
              </>
            )}

            {primeiro && (
              <>
                <label className="rotulo" htmlFor="usuario">Usuário</label>
                <input id="usuario" type="text" value={usuario} onChange={digitar(setUsuario)} autoComplete="username" autoCapitalize="none" spellCheck={false} />
              </>
            )}

            {antiga ? (
              <>
                <label className="rotulo" htmlFor="pin">Seu código</label>
                <input
                  id="pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="current-password"
                  className="pin"
                  size={TAMANHO}
                  maxLength={TAMANHO}
                  value={senha}
                  onChange={(e) => {
                    setSenha(e.target.value.replace(/\D/g, ""));
                    setErro("");
                  }}
                />
              </>
            ) : (
              <>
                <label className="rotulo" htmlFor="senha">{novaConta ? "Crie uma senha (pelo menos 6 caracteres)" : "Sua senha"}</label>
                <input id="senha" type="password" autoComplete={novaConta ? "new-password" : "current-password"} value={senha} onChange={digitar(setSenha)} />
              </>
            )}

            {novaConta && (
              <>
                <label className="rotulo" htmlFor="confirmacao">Repita a senha</label>
                <input id="confirmacao" type="password" autoComplete="new-password" value={confirmacao} onChange={digitar(setConfirmacao)} />
              </>
            )}

            {erro && <p className="aviso">{erro}</p>}

            <button type="submit" className="botao" disabled={ocupado} style={{ width: "100%", marginTop: 18 }}>
              <Icone nome="feito" />
              {ocupado ? "Conferindo…" : novaConta ? "Criar conta" : "Entrar"}
            </button>

            {primeiro && (
              <button type="button" className="botao secundario" style={{ width: "100%", marginTop: 12 }} onClick={() => { setCriar(!criar); setErro(""); }}>
                {criar ? "Já tenho conta" : "Criar conta nova"}
              </button>
            )}

            <p className="discreto" style={{ margin: "16px 0 0" }}>
              {primeiro
                ? "O primeiro acesso em cada aparelho precisa de internet. Depois, a senha destrava este aparelho mesmo sem sinal."
                : antiga
                  ? "Esqueceu o código? Ele fica neste aparelho — quem tiver acesso ao navegador consegue apagá-lo."
                  : "Esqueceu a senha? Fale com a coordenação."}
            </p>
          </form>
        </main>
      </div>
    </>
  );
}
```

- [ ] **Passo 2: campo de senha com o estilo do campo de texto**

Em `app/globals.css`, linha 264, troque o seletor `input[type="text"],\ninput[type="number"],\ntextarea {` por:

```css
input[type="text"],
input[type="number"],
input[type="password"],
textarea {
```

(`input.pin`, mais abaixo, continua sobrepondo tamanho e espaçamento do código de 4 números.)

- [ ] **Passo 3: aviso da conta antiga no Início (`app/page.jsx`)**

Acrescente o estado `const [contaAntiga, setContaAntiga] = useState(false);` junto dos outros e, dentro do
`useEffect`, logo depois de `setUltimaExportacao(lerLocal(ULTIMA_EXPORTACAO));`:

```js
    const conta = garantirIdentidade();
    setContaAntiga(Boolean(conta && !conta.usuario));
```

Como primeiro filho de `<main className="conteudo">`, antes do primeiro `<Escolha`:

```jsx
        {contaAntiga && (
          <div className="cartao">
            <p>Crie usuário e senha para ver suas entrevistas em outro aparelho.</p>
            <Link href="/aparelho/" className="botao secundario">Criar usuário e senha</Link>
          </div>
        )}
```

- [ ] **Passo 4: reescrever `app/aparelho/page.jsx`**

Mantém tudo o que a página mostra hoje e acrescenta o cartão "Conta" no topo:

```jsx
"use client";

import { useEffect, useState } from "react";

import Topo from "@/components/Topo";
import { garantirIdentidade, sair, vincular } from "@/lib/enviar.mjs";
import { infoDoAparelho } from "@/lib/registro.mjs";
import { erroDeLogin, normalizarUsuario } from "@/lib/sincronizar.mjs";

const tamanho = (bytes) => bytes == null ? "indisponível" : `${(bytes / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
const data = (valor) => valor ? new Date(valor).toLocaleString("pt-BR") : "nenhuma";
const simOuNao = (valor) => valor == null ? "indisponível" : valor ? "sim" : "não";

function Conta() {
  const [conta, setConta] = useState(null);
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [repetir, setRepetir] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => setConta(garantirIdentidade()), []);

  async function criarLogin(evento) {
    evento.preventDefault();
    const invalido = erroDeLogin(normalizarUsuario(usuario), senha);
    if (invalido) return setAviso(invalido);
    if (senha !== repetir) return setAviso("As duas senhas não são iguais.");
    setOcupado(true);
    try {
      setConta(await vincular(usuario, senha));
      setSenha("");
      setRepetir("");
      setAviso("Pronto: entre com este usuário e senha em outro aparelho. A senha agora também destrava este.");
    } catch (erro) {
      setAviso(erro.message);
    } finally {
      setOcupado(false);
    }
  }

  async function sairDaqui() {
    const recusa = await sair();
    if (recusa) return setAviso(recusa);
    location.href = "/";
  }

  return (
    <div className="cartao">
      <h2 className="secao" style={{ marginTop: 0 }}>Conta</h2>
      <p>Nome: <strong>{conta?.nome || "indisponível"}</strong></p>
      <p>Usuário: <strong>{conta?.usuario || "ainda sem usuário"}</strong></p>
      <p>ID do entrevistador: <strong>{conta?.id || "indisponível"}</strong></p>
      {conta && !conta.usuario && (
        <form onSubmit={criarLogin}>
          <label className="rotulo" htmlFor="novo-usuario">Usuário</label>
          <input id="novo-usuario" type="text" value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} />
          <label className="rotulo" htmlFor="nova-senha">Senha (pelo menos 6 caracteres)</label>
          <input id="nova-senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="new-password" />
          <label className="rotulo" htmlFor="repetir-senha">Repita a senha</label>
          <input id="repetir-senha" type="password" value={repetir} onChange={(e) => setRepetir(e.target.value)} autoComplete="new-password" />
          <button type="submit" className="botao" disabled={ocupado} style={{ width: "100%", marginTop: 18 }}>
            {ocupado ? "Enviando…" : "Criar usuário e senha"}
          </button>
        </form>
      )}
      {aviso && <p className="aviso">{aviso}</p>}
      <button type="button" className="botao secundario" onClick={sairDaqui} style={{ width: "100%", marginTop: 18 }}>
        Sair deste aparelho
      </button>
    </div>
  );
}

export default function Aparelho() {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    infoDoAparelho().then(setInfo);
  }, []);

  return (
    <>
      <Topo titulo="Aparelho e versão" voltar="/" />
      <div className="folha">
        <main className="conteudo">
          <Conta />
          {!info ? <p className="discreto">Lendo informações do aparelho…</p> : (
            <>
              <div className="cartao">
                <h2 className="secao" style={{ marginTop: 0 }}>Versão e armazenamento</h2>
                <p>Versão do app: <strong>{info.versao || "dev"}</strong></p>
                <p>Versão do questionário: <strong>{info.bancoVersao}</strong></p>
                <p>Service worker ativo: <strong>{simOuNao(info.swAtivo)}</strong></p>
                <p>Armazenamento persistido: <strong>{simOuNao(info.persistido)}</strong></p>
                <p>Espaço usado: <strong>{tamanho(info.estimate.usado)}</strong></p>
                <p>Cota disponível: <strong>{tamanho(info.estimate.cota)}</strong></p>
              </div>
              <div className="cartao">
                <h2 className="secao" style={{ marginTop: 0 }}>Entrevistas e pendências</h2>
                <p>Entrevistas no aparelho: <strong>{info.entrevistas.total ?? "indisponível"}</strong></p>
                <p>Concluídas: <strong>{info.entrevistas.concluidas ?? "indisponível"}</strong></p>
                <p>Transcrições pendentes: <strong>{info.transcricoesPendentes}</strong></p>
                <p>Pedaços de gravação a recuperar: <strong>{info.pedacosPendentes ?? "indisponível"}</strong></p>
                <p>Entrevistas importadas no consolidado: <strong>{info.importadas ?? "indisponível"}</strong></p>
                <p>Última exportação: <strong>{data(info.ultimaExportacao)}</strong></p>
              </div>
              <div className="cartao">
                <h2 className="secao" style={{ marginTop: 0 }}>Navegador</h2>
                <p className="discreto">{info.userAgent || "indisponível"}</p>
              </div>
              <section>
                <h2 className="secao">Erros recentes</h2>
                {info.erros.length === 0 ? <p className="discreto">Nenhum erro registrado.</p> : (
                  <ul className="lista" style={{ marginTop: 12 }}>
                    {info.erros.map((erro, indice) => (
                      <li className="cartao" key={indice}>
                        <p className="discreto" style={{ margin: "0 0 6px" }}>{data(erro.quando)} · {erro.onde}</p>
                        <p style={{ margin: 0 }}>{erro.mensagem}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </main>
      </div>
    </>
  );
}
```

O "ID do entrevistador" saiu do cartão "Versão e armazenamento" e foi para "Conta" (o `current-state.md`
manda o coordenador pegar o ID em `/aparelho/`; continua lá).

- [ ] **Passo 5: build**

Run: `npm test` e `npm run build`
Esperado: `ℹ fail 0`; build sem erro, `out/index.html` e `out/aparelho/index.html` existem.
Confira também: `grep -n "novoSegredo\|embaralhar" components/Tranca.jsx` mostra só o import de `embaralhar`.

- [ ] **Passo 6: commit (agente pai)**

```bash
git add components/Tranca.jsx app/page.jsx app/aparelho/page.jsx app/globals.css
git commit -m "feat: Tranca entra com usuário e senha; conta antiga vincula em /aparelho/"
```

---

### Tarefa 6: painel e consolidado com o banco, e "Salvar em PDF" no painel

**Arquivos:**
- Modificar: `app/painel/page.jsx`
- Modificar: `app/consolidado/page.jsx:22-45`
- Modificar: `app/page.jsx:278-300` ("Ver consolidado" sempre visível)
- Modificar: `app/globals.css` (bloco `@media print` da linha ~675)

**Interfaces:**
- Consome: `buscarDoBanco` (Tarefa 4), `minhasEntrevistas` (Tarefa 4), `juntarEntrevistas` (`lib/exportar.mjs:149`).
- Produz, para a bateria (Tarefa 7): no painel, `section[aria-label="Meu painel"] .numeros-painel strong`
  (o primeiro é o total) e um `button` com o texto "Salvar em PDF"; na impressão, `.painel .cartao` e
  `.painel .numeros-painel` com `break-inside: avoid`.

- [ ] **Passo 1: painel (`app/painel/page.jsx`)**

Imports: troque a linha de `@/lib/enviar.mjs` por `import { buscarDoBanco, garantirIdentidade } from "@/lib/enviar.mjs";`,
a de `@/lib/painel.mjs` por `import { minhasEntrevistas, resumoDoPainel } from "@/lib/painel.mjs";` e
acrescente `import Icone from "@/components/Icone";` antes de `import Topo`.

Estado: acrescente `const [doBanco, setDoBanco] = useState([]);` e `const [hoje, setHoje] = useState("");`.

No `useEffect`, primeira linha do corpo: `setHoje(new Date().toLocaleDateString("pt-BR"));`. Troque o bloco
das linhas 105–115 (do `if (!identidade?.id ...` até o fim do `fetch(...)...catch(...)`) por:

```js
      buscarDoBanco().then((dados) => {
        if (!vivo || carga !== atual) return;
        setDoBanco(dados?.entrevistas ?? []);
        setEquipe(dados?.papel === "coordenador" ? dados : null);
      });
```

Troque `const meuResumo = useMemo(() => resumoDoPainel(banco, locais), [locais]);` por:

```js
  const meus = useMemo(() => conta ? minhasEntrevistas(conta, locais, doBanco) : [], [conta, locais, doBanco]);
  const meuResumo = useMemo(() => resumoDoPainel(banco, meus), [meus]);
```

No JSX:
- primeiro filho de `<main className="conteudo consolidado painel">`:
  `<header className="cabecalho-territorio"><p>Gerado em {hoje}</p></header>`;
- texto sem sinal: `Sem sinal: o painel mostra só este aparelho.`;
- `{locais.length ? <Resumo resumo={meuResumo} /> : <p>Nenhuma entrevista sua neste tablet ainda.</p>}` vira
  `{meus.length ? <Resumo resumo={meuResumo} /> : <p>Nenhuma entrevista sua ainda.</p>}`;
- `Enviadas ao banco: {enviados} de {locais.length}` vira `Deste aparelho, enviadas ao banco: {enviados} de {locais.length}`;
- `<div className="filtros-territorio">` vira `<div className="filtros-territorio nao-imprime">`, e o título
  `<h2 className="secao">Equipe</h2>` vira
  `<h2 className="secao">Equipe{selecionado ? ` — ${equipe.entrevistadores.find((e) => e.id === selecionado)?.nome ?? ""}` : ""}</h2>`
  (no papel o filtro some, então o título diz o recorte);
- depois de `</div>` que fecha `.folha`, antes de `</>`:

```jsx
      <div className="rodape nao-imprime">
        <button type="button" className="botao" onClick={() => window.print()}><Icone nome="imprimir" />Salvar em PDF</button>
      </div>
```

- [ ] **Passo 2: consolidado (`app/consolidado/page.jsx`)**

Acrescente `import { buscarDoBanco } from "@/lib/enviar.mjs";` (em ordem alfabética, depois de `@/lib/db.mjs`),
o estado `const [doBanco, setDoBanco] = useState([]);` e, no `useEffect`, depois do `Promise.all(...)...finally(...)`:

```js
    buscarDoBanco().then((dados) => setDoBanco(dados?.entrevistas ?? []));
```

Troque `const entrevistas = useMemo(() => juntarEntrevistas(locais, importadas), [locais, importadas]);` por:

```js
  const entrevistas = useMemo(() => juntarEntrevistas([...locais, ...doBanco], importadas), [locais, doBanco, importadas]);
```

O texto `{deFora} de outros aparelhos` continua certo: conta importadas e as do banco que não estão aqui.

- [ ] **Passo 3: "Ver consolidado" sempre visível no Início (`app/page.jsx`)**

No aparelho novo, que só tem entrevistas no banco, o link para o consolidado não aparecia. Remova o
`<Link href="/consolidado/" className="botao secundario">Ver consolidado</Link>` de dentro do bloco
`{entrevistas.length > 0 && ...}` e ponha logo antes do link do Painel:

```jsx
        <Link href="/consolidado/" className="botao secundario" style={{ marginTop: 12 }}>Ver consolidado</Link>
        <Link href="/painel/" className="botao secundario" style={{ marginTop: 12 }}>Painel</Link>
```

- [ ] **Passo 4: impressão (`app/globals.css`)**

O `.cartao` já tem `break-inside: avoid` no primeiro `@media print` (linha ~510); a linha de números do
painel não é cartão. No bloco `@media print` da linha ~675, acrescente:

```css
  .painel .cartao,
  .painel .numeros-painel {
    break-inside: avoid;
  }
```

- [ ] **Passo 5: build**

Run: `npm test` e `npm run build`
Esperado: `ℹ fail 0`; build sem erro.

- [ ] **Passo 6: commit (agente pai)**

```bash
git add app/painel/page.jsx app/consolidado/page.jsx app/page.jsx app/globals.css
git commit -m "feat: painel e consolidado somam o banco; painel salva em PDF"
```

---

### Tarefa 7: baterias — Tranca nova, `25-login` e bloqueio das APIs novas

**Arquivos:**
- Modificar: `scripts/cdp.mjs` (`passarPelaTranca`, novos `semearConta` e `acessarPelaTela`)
- Modificar: `scripts/validar.mjs`
- Modificar: `scripts/usabilidade.mjs`
- Modificar: `scripts/capturar-telas.mjs:39`

**Interfaces:**
- Consome: ids e textos da Tarefa 5; seletores da Tarefa 6; `CHAVE = "acesso-formula-impacto"` e o formato
  da conta local `{ nome, usuario, sal, resumo: sha256("${sal}:${senha}"), id, segredo, registrada }`.
- Produz, em `comandos(js)` de `scripts/cdp.mjs`:
  - `semearConta({ nome?, usuario?, senha? })` — grava a conta direto no `localStorage`; `usuario: null` cria conta antiga (código);
  - `passarPelaTranca(senha = "senha-teste")` — no 1º acesso semeia a conta e recarrega; depois digita em `#senha` ou `#pin` e clica "Entrar";
  - `acessarPelaTela({ nome?, usuario, senha })` — com `nome` cria a conta pela tela (vai ao servidor); sem `nome`, entra.

Ninguém roda o navegador nesta tarefa: o pai roda a bateria. Aqui vale `node --check` e leitura atenta.
Atenção: em `validar.mjs`, `rede(true)` **desliga** a rede e `rede(false)` liga.

- [ ] **Passo 1: `scripts/cdp.mjs`**

Troque o comentário e a função `passarPelaTranca` inteiros por:

```js
  const SENHA_TESTE = "senha-teste";

  // Sem servidor não dá para criar conta pela tela; a conta nasce direto no aparelho, no mesmo
  // formato que o `acessar` de lib/enviar.mjs grava. A tela de login é medida no 25-login.
  const semearConta = ({ nome = "Entrevistador de Teste", usuario = "teste", senha = SENHA_TESTE } = {}) =>
    js(`
      const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
      const sal = crypto.randomUUID();
      const resumo = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sal + ":" + ${JSON.stringify(senha)})));
      const conta = { nome: ${JSON.stringify(nome)}, usuario: ${JSON.stringify(usuario)}, sal, resumo, id: crypto.randomUUID(), segredo: hex(crypto.getRandomValues(new Uint8Array(32))), registrada: false };
      localStorage.setItem("acesso-formula-impacto", JSON.stringify(conta));
      return true;
    `);

  const passarPelaTranca = async (senha = SENHA_TESTE) => {
    if (await js(`return Boolean(document.querySelector("#usuario"));`)) {
      await semearConta({ senha });
      // Recarregar dentro do próprio evaluate destrói o contexto antes da resposta voltar.
      await js(`setTimeout(() => location.reload(), 0); return true;`);
      await espera(2600);
    }
    const campo = await js(`return document.querySelector("#senha") ? "#senha" : document.querySelector("#pin") ? "#pin" : "";`);
    if (!campo) return "destrancado";
    await digitarEm(campo, senha);
    await clicar("Entrar");
    await espera(1400);
    return "entrou";
  };

  const acessarPelaTela = async ({ nome, usuario, senha }) => {
    const modoCriar = await js(`return Boolean(document.querySelector("#nome"));`);
    if (Boolean(nome) !== modoCriar) {
      await clicar(nome ? "Criar conta nova" : "Já tenho conta");
      await espera(300);
    }
    if (nome) await digitarEm("#nome", nome);
    await digitarEm("#usuario", usuario);
    await digitarEm("#senha", senha);
    if (nome) await digitarEm("#confirmacao", senha);
    await clicar(nome ? "Criar conta" : "Entrar");
    await espera(3000);
  };
```

E troque o `return` final de `comandos` por:

```js
  return { clicar, digitarEm, preencher, passarPelaTranca, limparAparelho, semearConta, acessarPelaTela };
```

- [ ] **Passo 2: `scripts/validar.mjs` — cabeçalho e bloqueio**

Linha 19: `const { clicar, preencher, passarPelaTranca, limparAparelho, semearConta, acessarPelaTela } = comandos(js);`

Troque o bloco de bloqueio (linhas ~92–107) por:

```js
if (!SINCRONIZAR) {
  await cdp("Network.setBlockedURLs", { urls: ["*/api/sincronizar*", "*/api/painel*", "*/api/conta*", "*/api/entrar*"] });
}
await cdp("Emulation.setDeviceMetricsOverride", { width: 800, height: 1280, deviceScaleFactor: 1, mobile: true });
if (!SINCRONIZAR) {
  await irPara("/");
  const vazou = await js(`
    const vazadas = [];
    for (const rota of ["/api/painel", "/api/sincronizar", "/api/conta", "/api/conta/vincular", "/api/entrar"]) {
      try { await fetch(rota); vazadas.push(rota); } catch {}
    }
    return vazadas;
  `);
  if (vazou.length) {
    fechar();
    throw new Error(`O bloqueio das APIs não pegou (${vazou.join(", ")}); bateria abortada para proteger o banco.`);
  }
}
```

- [ ] **Passo 3: `scripts/validar.mjs` — trocar o código fixo pela senha padrão**

Rode `sed -i '' 's/passarPelaTranca("1234")/passarPelaTranca()/g' scripts/validar.mjs scripts/capturar-telas.mjs`
(macOS; no Linux, `sed -i` sem `''`). Depois `grep -n '"1234"' scripts/validar.mjs scripts/capturar-telas.mjs`
deve mostrar só as ocorrências que o Passo 4 escreve.

No `7-service-worker` (linha ~327), troque `document.querySelector("#pin")` por `document.querySelector("#senha")`.

- [ ] **Passo 4: `scripts/validar.mjs` — reescrever `1-tranca`**

Troque o cenário `1-tranca` inteiro por:

```js
await cenario("1-tranca", async () => {
  await irPara("/");
  await limparAparelho();
  await irPara("/");

  checar("1-tranca: aparelho novo pede usuário e senha", await js(`return Boolean(document.querySelector("#usuario")) && Boolean(document.querySelector("#senha"));`));
  if (!SINCRONIZAR) {
    await acessarPelaTela({ nome: "Sem Rede", usuario: "sem-rede", senha: "senha-sem-rede" });
    const aviso = await js(`return document.querySelector(".aviso")?.textContent ?? "";`);
    const semConta = await js(`return localStorage.getItem("acesso-formula-impacto") === null;`);
    checar("1-tranca: sem servidor, criar conta avisa que falta internet e não grava conta", aviso.includes("Sem internet") && semConta, aviso);
  }
  await passarPelaTranca();
  checar("1-tranca: conta no aparelho destranca", (await textoDaTela()).includes("Quem você vai entrevistar?"));

  await js(`sessionStorage.clear(); return true;`);
  await irPara("/");
  const pedeSenha = await js(`return Boolean(document.querySelector("#senha")) && !document.querySelector("#usuario");`);
  checar("1-tranca: sessão encerrada volta a pedir a senha, não o login", pedeSenha);

  await passarPelaTranca("senha-errada");
  const barrou = await js(`return Boolean(document.querySelector("#senha"));`);
  checar("1-tranca: senha errada não entra", barrou, barrou ? "" : "entrou com senha errada");

  await passarPelaTranca();
  checar("1-tranca: senha certa entra", (await textoDaTela()).includes("Quem você vai entrevistar?"));

  await irPara("/");
  checar("1-tranca: sessão aberta sobrevive ao reload", (await textoDaTela()).includes("Quem você vai entrevistar?"));

  await limparAparelho();
  await semearConta({ usuario: null, senha: "1234" });
  await irPara("/");
  checar("1-tranca: conta antiga continua pedindo o código de 4 números", await js(`return Boolean(document.querySelector("#pin"));`));
  await passarPelaTranca("1234");
  const inicio = await textoDaTela();
  checar("1-tranca: conta antiga entra com o código e vê o convite para criar usuário", inicio.includes("Quem você vai entrevistar?") && inicio.includes("Crie usuário e senha"));

  await limparAparelho();
  await semearConta();
});
```

- [ ] **Passo 5: `scripts/validar.mjs` — impressão no `22-painel`**

Dentro do `try` do `22-painel`, depois do `checar("22-painel: cabe sem rolagem horizontal em 360 px", ...)`:

```js
    checar("22-painel: tem o botão Salvar em PDF", await js(`return [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Salvar em PDF"));`));
    await cdp("Emulation.setEmulatedMedia", { media: "print" });
    const cortaveis = await js(`return [...document.querySelectorAll(".painel .cartao, .painel .numeros-painel")].filter((el) => getComputedStyle(el).breakInside !== "avoid").length;`);
    await cdp("Emulation.setEmulatedMedia", { media: "" });
    checar("22-painel: na impressão nenhum cartão do painel pode ser cortado", cortaveis === 0, `${cortaveis} cortáveis`);
```

- [ ] **Passo 6: `scripts/validar.mjs` — cenário `25-login`**

Logo depois do cenário `24-isolamento` (antes de `19-csp`):

```js
await cenario("25-login", async () => {
  if (!SINCRONIZAR) {
    console.log("pulado 25-login: use SINCRONIZAR=1 para gravar no banco");
    return;
  }
  const marca = Date.now();
  const usuario = `validacao-${marca}`;
  const senha = "senha-login-25";
  const id = `validacao-login-${marca}`;
  const entrevistado = `Login ${marca}`;
  await rede(false);
  await irPara("/");
  await limparAparelho();
  await irPara("/");
  await acessarPelaTela({ nome: "Validação Login", usuario, senha });
  checar("25-login: aparelho A cria a conta no banco", (await textoDaTela()).includes("Quem você vai entrevistar?"));
  const conta = await js(`return JSON.parse(localStorage.getItem("acesso-formula-impacto"));`);
  if (conta?.usuario !== usuario) throw new Error("a conta criada não guardou o usuário");
  const versao = new Date().toISOString();
  await guardar("entrevistas", [{
    id, entrevistadorId: conta.id, entrevistador: conta.nome,
    perfil: { categoria: "ater", genero: "feminino" }, respostas: { nome: entrevistado, comunidade: "Sítio Login" },
    iniciadaEm: versao, atualizadaEm: versao, concluidaEm: versao,
  }]);
  await js(`window.dispatchEvent(new Event("online")); return true;`);
  const subiu = await ate(() => js(`
    try {
      const conta = JSON.parse(localStorage.getItem("acesso-formula-impacto"));
      const resposta = await fetch("/api/painel", { headers: { authorization: "Bearer " + conta.id + "." + conta.segredo } });
      return resposta.ok && (await resposta.json()).entrevistas.some((e) => e.id === ${JSON.stringify(id)});
    } catch { return false; }
  `), 20);
  checar("25-login: entrevista concluída em A chega ao banco", subiu);

  // Aparelho B: o mesmo navegador com tudo apagado, como um computador que nunca abriu o app.
  await limparAparelho();
  await irPara("/");
  await acessarPelaTela({ usuario, senha: "senha-errada-25" });
  const aviso = await js(`return document.querySelector(".aviso")?.textContent ?? "";`);
  checar("25-login: senha errada não entra em B", aviso.includes("Usuário ou senha errados") && await js(`return Boolean(document.querySelector("#usuario"));`), aviso);
  await acessarPelaTela({ usuario, senha });
  checar("25-login: B entra com usuário e senha", (await textoDaTela()).includes("Quem você vai entrevistar?"));

  await irPara("/painel/");
  const noPainel = await ate(() => js(`return document.querySelector('[aria-label="Meu painel"] .numeros-painel strong')?.textContent === "1";`), 10);
  checar("25-login: painel de B mostra a entrevista feita em A", noPainel);
  await irPara("/consolidado/");
  const noConsolidado = await ate(async () => (await textoDaTela()).includes(entrevistado), 10);
  checar("25-login: consolidado de B mostra a entrevista feita em A", noConsolidado);

  await js(`sessionStorage.clear(); return true;`);
  await irPara("/");
  await passarPelaTranca("senha-errada-25");
  checar("25-login: senha errada não destrava B depois do login", await js(`return Boolean(document.querySelector("#senha"));`));
  await passarPelaTranca(senha);
  checar("25-login: a senha da conta destrava B", (await textoDaTela()).includes("Quem você vai entrevistar?"));
});
```

`guardar` e `ate` já existem no arquivo (o `guardar` é declarado antes do `18-consolidado`).

- [ ] **Passo 7: `scripts/usabilidade.mjs`**

- Linha 153: `const { clicar, preencher, passarPelaTranca, limparAparelho, semearConta } = comandos(js);`
- `Network.setBlockedURLs`: `{ urls: ["*/api/sincronizar*", "*/api/painel*", "*/api/conta*", "*/api/entrar*"] }`
- Troque as três linhas `registrar(device, "tranca", ...)`, `await foto(\`${device.nome}-0-tranca\`)` e
  `await passarPelaTranca();` por:

```js
  registrar(device, "tranca-entrar", await js(AUDITORIA));
  await foto(`${device.nome}-0-tranca-entrar`);
  await clicar("Criar conta nova");
  await espera(300);
  registrar(device, "tranca-criar", await js(AUDITORIA));
  await foto(`${device.nome}-0-tranca-criar`);
  await semearConta();
  await cdp("Page.reload");
  await espera(2200);
  registrar(device, "tranca-senha", await js(AUDITORIA));
  await foto(`${device.nome}-0-tranca-senha`);
  await passarPelaTranca();
```

- Na linha do resumo final, `7 telas cada` vira `9 telas cada`.

- [ ] **Passo 8: conferir sintaxe e o que sobrou**

Run:
```bash
node --check scripts/cdp.mjs && node --check scripts/validar.mjs && node --check scripts/usabilidade.mjs && node --check scripts/capturar-telas.mjs
grep -n '#pin\|"1234"\|Criar acesso' scripts/*.mjs
npm test
```
Esperado: `node --check` sem saída; o `grep` só acha `#pin` em `cdp.mjs` (passarPelaTranca) e em `1-tranca`,
e `"1234"` só no trecho da conta antiga do `1-tranca`; `npm test` dá `ℹ fail 0`.

- [ ] **Passo 9: commit (agente pai)**

```bash
git add scripts/cdp.mjs scripts/validar.mjs scripts/usabilidade.mjs scripts/capturar-telas.mjs
git commit -m "test: bateria cobre login, conta antiga, 25-login e impressão do painel"
```

---

### Tarefa 8: verificação final (agente pai)

Não é tarefa do executor. O pai roda, cola a saída e só então fecha:

```bash
cd repo && npm test                                         # ℹ fail 0
npm run build                                               # out/index.html
npx wrangler d1 migrations apply formula-de-impacto --local
npx wrangler pages dev out --port 8788                      # em outro terminal
SINCRONIZAR=1 BASE_URL=http://localhost:8788 CDP_PORT=9223 npm run validar   # só 13-limite falha; 25-login passa
BASE_URL=http://localhost:8788 CDP_PORT=9223 npm run validar                 # sem SINCRONIZAR: bloqueio pega, só 13-limite falha
node scripts/servir.mjs 3417 & BASE_URL=http://localhost:3417 CDP_PORT=9223 npm run test:ui   # nenhum problema
```

À mão no navegador: "Salvar em PDF" do painel abre a impressão e a pré-visualização não corta cartão.
Depois, prévia: `npx wrangler d1 migrations apply formula-de-impacto-previa --remote --env preview` antes da
bateria contra a prévia. Produção só com pedido do usuário (o `npm run deploy` já aplica a migração).
