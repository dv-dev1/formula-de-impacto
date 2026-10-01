const MAX_BYTES = 24 * 1024 * 1024;

const responder = (dados, status = 200) =>
  new Response(JSON.stringify(dados), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

// Base64, não array de bytes. Em fatias porque `String.fromCharCode` com o arquivo inteiro
// estoura a pilha de argumentos.
const base64 = (bytes) => {
  let bruto = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bruto += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bruto);
};

// Sem contexto o modelo nunca espera ouvir "Incra" nem "quilombola": medido, saíam como
// "em um crédito" e "o Amor". Instituição errada no relatório é a resposta dizendo outra coisa.
const VOCABULARIO =
  "Entrevista de diagnóstico territorial em comunidade rural. Incra, Pronaf, Emater, " +
  "Cadastro Ambiental Rural, DAP, agricultura familiar, assentamento, quilombola, " +
  "Fundação Palmares, escoamento da produção, atravessador, cooperativa, sindicato rural, " +
  "cisterna, estiagem, carro-pipa, roçado, gargalo, estrada vicinal, ensino médio.";

export async function onRequestPost({ request, env }) {
  if (!env.AI) return responder({ erro: "Transcrição não está configurada." }, 503);
  // ponytail: sem limite de uso (Pages recusa `ratelimits`); exigir sessão ou regra de WAF.

  const bruto = await request.arrayBuffer();
  if (!bruto.byteLength) return responder({ erro: "Nenhum áudio recebido." }, 400);
  if (bruto.byteLength > MAX_BYTES) return responder({ erro: "Áudio grande demais." }, 413);

  try {
    const saida = await env.AI.run("@cf/openai/whisper-large-v3-turbo", {
      audio: base64(new Uint8Array(bruto)),
      language: "pt",
      task: "transcribe",
      initial_prompt: VOCABULARIO,
    });
    const texto = (saida?.text ?? "").trim();
    if (!texto) return responder({ erro: "Não saiu texto do áudio." }, 422);
    return responder({ texto });
  } catch (erro) {
    return responder({ erro: String(erro?.message || erro).slice(0, 200) }, 502);
  }
}
