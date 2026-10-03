const objeto = (valor) => valor !== null && typeof valor === "object" && !Array.isArray(valor);

export const entrevistaValida = (e) =>
  objeto(e) && typeof e.id === "string" && e.id.length <= 100 &&
  objeto(e.perfil) && objeto(e.respostas) && typeof e.iniciadaEm === "string";

export const versaoDe = (e) => e.atualizadaEm ?? e.iniciadaEm;

export const pendentesDeEnvio = (lista) => lista.filter((e) => !e.enviadaEm || e.enviadaEm < versaoDe(e));

export const daConta = (e, conta) => e.entrevistadorId
  ? e.entrevistadorId === conta.id
  : !e.entrevistador || e.entrevistador === conta.nome;

export function lerCredencial(cabecalho) {
  if (typeof cabecalho !== "string") return null;
  const partes = /^Bearer ([A-Za-z0-9-]{1,100})\.([a-f0-9]{64})$/.exec(cabecalho);
  return partes ? { id: partes[1], segredo: partes[2] } : null;
}

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
  const hash = await hashDoSegredo(credencial.segredo);
  const sessao = await db.prepare(`
    SELECT e.* FROM sessoes s JOIN entrevistadores e ON e.id = s.entrevistador_id
    WHERE s.token_hash = ? AND s.entrevistador_id = ?
  `).bind(hash, credencial.id).first();
  if (sessao) return sessao;
  const entrevistador = await db.prepare("SELECT * FROM entrevistadores WHERE id = ? AND segredo_hash = ?")
    .bind(credencial.id, hash).first();
  if (!entrevistador) return null;
  // Tablets cadastrados pelo código antigo após a 0002 ficaram sem sessão.
  await db.prepare("INSERT OR IGNORE INTO sessoes (token_hash, entrevistador_id, criada_em) VALUES (?, ?, ?)")
    .bind(hash, entrevistador.id, new Date().toISOString()).run();
  return entrevistador;
}
