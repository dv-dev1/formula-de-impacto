import { hashDoSegredo, lerCredencial } from "../../lib/sincronizar.mjs";

const responder = (dados, status = 200) =>
  new Response(JSON.stringify(dados), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export async function onRequestGet({ request, env }) {
  // ponytail: o coordenador recebe tudo de uma vez; paginar quando passar de alguns milhares.
  if (!env.DB) return responder({ erro: "Banco não está configurado." }, 503);
  const credencial = lerCredencial(request.headers.get("authorization"));
  if (!credencial) return responder({ erro: "Credencial inválida." }, 401);
  const entrevistador = await env.DB.prepare("SELECT * FROM entrevistadores WHERE id = ?").bind(credencial.id).first();
  if (!entrevistador || entrevistador.segredo_hash !== await hashDoSegredo(credencial.segredo)) {
    return responder({ erro: "Credencial inválida." }, 401);
  }
  const equipe = entrevistador.papel === "coordenador";
  const consulta = equipe
    ? env.DB.prepare("SELECT dados, entrevistador_id FROM entrevistas WHERE apagada_em IS NULL")
    : env.DB.prepare("SELECT dados, entrevistador_id FROM entrevistas WHERE apagada_em IS NULL AND entrevistador_id = ?").bind(credencial.id);
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
