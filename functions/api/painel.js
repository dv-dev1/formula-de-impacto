import { autenticar, responder } from "../../lib/sincronizar.mjs";

export async function onRequestGet({ request, env }) {
  // ponytail: o coordenador recebe tudo de uma vez; paginar quando passar de alguns milhares.
  if (!env.DB) return responder({ erro: "Banco não está configurado." }, 503);
  const entrevistador = await autenticar(env.DB, request.headers.get("authorization"));
  if (!entrevistador) return responder({ erro: "Credencial inválida." }, 401);
  const equipe = entrevistador.papel === "coordenador";
  const consulta = equipe
    ? env.DB.prepare("SELECT dados, entrevistador_id FROM entrevistas WHERE apagada_em IS NULL")
    : env.DB.prepare("SELECT dados, entrevistador_id FROM entrevistas WHERE apagada_em IS NULL AND entrevistador_id = ?").bind(entrevistador.id);
  const { results } = await consulta.all();
  const entrevistadores = equipe
    ? (await env.DB.prepare("SELECT id, nome FROM entrevistadores ORDER BY nome").all()).results
    : [{ id: entrevistador.id, nome: entrevistador.nome }];
  return responder({
    papel: entrevistador.papel,
    entrevistadores,
    entrevistas: results.map((e) => ({ ...JSON.parse(e.dados), entrevistadorId: e.entrevistador_id })),
  });
}
