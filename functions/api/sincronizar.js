import { entrevistaValida, hashDoSegredo, lerCredencial, versaoDe } from "../../lib/sincronizar.mjs";

const responder = (dados, status = 200) =>
  new Response(JSON.stringify(dados), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export async function onRequestPost({ request, env }) {
  // ponytail: cadastro aberto como na Tranca; o limite por requisição contém o abuso, mas não o impede.
  if (!env.DB) return responder({ erro: "Banco não está configurado." }, 503);
  const credencial = lerCredencial(request.headers.get("authorization"));
  if (!credencial) return responder({ erro: "Credencial inválida." }, 401);
  const texto = await request.text();
  if (new TextEncoder().encode(texto).byteLength > 5 * 1024 * 1024) {
    return responder({ erro: "Corpo grande demais." }, 413);
  }
  let corpo;
  try {
    corpo = JSON.parse(texto);
  } catch {
    return responder({ erro: "JSON inválido." }, 400);
  }
  if (!Array.isArray(corpo?.entrevistas) || !Array.isArray(corpo?.apagadas)) {
    return responder({ erro: "Informe as listas de entrevistas e apagadas." }, 400);
  }
  if (corpo.entrevistas.length > 100 || corpo.apagadas.length > 500) {
    return responder({ erro: "Itens demais." }, 413);
  }
  const { id, segredo } = credencial;
  const hash = await hashDoSegredo(segredo);
  const entrevistador = await env.DB.prepare("SELECT * FROM entrevistadores WHERE id = ?").bind(id).first();
  const agora = new Date().toISOString();
  if (!entrevistador) {
    const nome = typeof corpo.nome === "string" ? corpo.nome.trim() : "";
    if (!nome || nome.length > 80) return responder({ erro: "Informe um nome de até 80 caracteres." }, 400);
    await env.DB.prepare("INSERT INTO entrevistadores (id, nome, segredo_hash, criado_em) VALUES (?, ?, ?, ?)")
      .bind(id, nome, hash, agora).run();
  } else if (entrevistador.segredo_hash !== hash) {
    return responder({ erro: "Credencial inválida." }, 401);
  }
  const entrevistas = corpo.entrevistas.filter(entrevistaValida);
  const tarefas = entrevistas.map((e) => {
    const { enviadaEm, ...dados } = e;
    return env.DB.prepare(`
      INSERT INTO entrevistas (id, entrevistador_id, dados, atualizada_em, recebida_em) VALUES (?1, ?2, ?3, ?4, ?5)
      ON CONFLICT (id) DO UPDATE SET dados = excluded.dados, atualizada_em = excluded.atualizada_em, recebida_em = excluded.recebida_em
      WHERE entrevistas.entrevistador_id = excluded.entrevistador_id AND excluded.atualizada_em > entrevistas.atualizada_em
    `).bind(e.id, id, JSON.stringify({ ...dados, entrevistadorId: id }), versaoDe(e), agora);
  });
  for (const apagada of corpo.apagadas.filter((valor) => typeof valor === "string")) {
    tarefas.push(env.DB.prepare("UPDATE entrevistas SET apagada_em = ? WHERE id = ? AND entrevistador_id = ? AND apagada_em IS NULL")
      .bind(agora, apagada, id));
  }
  if (tarefas.length) await env.DB.batch(tarefas);
  return responder({ ids: entrevistas.map((e) => e.id) });
}
