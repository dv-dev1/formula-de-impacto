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
