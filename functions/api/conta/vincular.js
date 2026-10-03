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
    const resultado = await env.DB.prepare("UPDATE entrevistadores SET usuario = ?, senha_hash = ?, senha_sal = ? WHERE id = ? AND usuario IS NULL")
      .bind(usuario, await hashDaSenha(corpo.senha, sal), sal, conta.id).run();
    if (resultado.meta.changes === 0) return responder({ erro: "Esta conta já tem usuário." }, 409);
  } catch (erro) {
    if (/UNIQUE/i.test(String(erro?.message))) return responder({ erro: "Este usuário já existe. Escolha outro." }, 409);
    throw erro;
  }
  return responder({ usuario });
}
