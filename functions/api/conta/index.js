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
