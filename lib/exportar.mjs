import JSZip from "jszip";

import { audiosDaEntrevista, listarEntrevistas } from "./db.mjs";
import { EXTENSOES } from "./formatos-audio.mjs";
import { montarFormulario } from "./montar-formulario.mjs";

const semAcento = (texto) =>
  texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

export const pastaDa = (entrevista) =>
  [entrevista.iniciadaEm.slice(0, 10), semAcento(entrevista.respostas?.nome || ""), entrevista.id.slice(0, 8)]
    .filter(Boolean)
    .join("-");

const celula = (valor) => {
  const texto = Array.isArray(valor) ? valor.join(" | ") : String(valor ?? "");
  return `"${texto.replaceAll('"', '""')}"`;
};

export const entrevistasDesde = (lista, desde) =>
  desde ? lista.filter((e) => (e.atualizadaEm ?? e.iniciadaEm) > desde) : lista;

export const duracaoMinutos = (entrevista) =>
  entrevista.concluidaEm
    ? Math.floor((new Date(entrevista.concluidaEm) - new Date(entrevista.iniciadaEm)) / 60000)
    : null;

export function montarCsv(banco, entrevistas) {
  const doBanco = banco.perguntas.flatMap((p) => (p.outro ? [p.id, `${p.id}_outro`] : [p.id]));
  // Pergunta que saiu do banco continua na planilha: sem isto o próximo export de uma
  // entrevista antiga perde a coluna calado.
  const colunas = [...new Set([...doBanco, ...entrevistas.flatMap((e) => Object.keys(e.respostas))])];
  const cabecalho = ["id", "data", "categoria", "cargo", "faixa", "genero", "entrevistador", "concluida", "duracao_min", ...colunas];
  const linhas = entrevistas.map((e) =>
    [
      e.id,
      e.iniciadaEm,
      e.perfil.categoria,
      e.perfil.cargo ?? "",
      e.perfil.faixa,
      e.perfil.genero,
      e.entrevistador ?? "",
      e.concluidaEm ? "sim" : "não",
      duracaoMinutos(e),
      ...colunas.map((id) => {
        const resposta = e.respostas[id];
        return resposta && typeof resposta === "object" && !Array.isArray(resposta)
          ? resposta.texto || (resposta.audioId ? "[áudio]" : "")
          : resposta;
      }),
    ]
      .map(celula)
      .join(","),
  );
  return [cabecalho.map(celula).join(","), ...linhas].join("\r\n");
}

export const LEIAME = `Entrevistas exportadas do formulário de campo.

entrevistas.json  todas as entrevistas, com o perfil e as respostas
entrevistas.csv   as mesmas respostas em planilha, uma linha por entrevista
audios/           um arquivo por resposta gravada, nomeado com o id da pergunta.
                  A extensão é a do aparelho: .m4a no Safari, .webm no Chrome,
                  .ogg no Firefox.

Para transcrever os áudios no PC, dentro da pasta do vox:

    for a in ${EXTENSOES.map((e) => `audios/*/*.${e}`).join(" ")}; do
      [ -e "$a" ] || continue
      ffmpeg -y -v error -i "$a" -ar 16000 -ac 1 -c:a pcm_s16le "\${a%.*}.wav"
      VOX_WHISPER_TRANSLATE=0 VOX_WHISPER_LANGUAGE=pt ./vox transcribe "\${a%.*}.wav" > "\${a%.*}.txt"
    done

O nome do arquivo é o id da pergunta, então o texto volta para a resposta certa.
`;

// Regravar deixa o áudio velho no banco, com o mesmo nome de arquivo no ZIP; sem este
// filtro a gravação descartada podia sobrescrever a que vale.
// ponytail: o áudio órfão continua ocupando o IndexedDB; apagar no regravar se o armazenamento apertar.
export function audiosDaResposta(entrevista, audios) {
  const vivos = new Set(Object.values(entrevista.respostas ?? {}).map((r) => r?.audioId).filter(Boolean));
  return audios.filter((a) => vivos.has(a.id));
}

export async function montarZip(banco, opcoes = {}) {
  const entrevistas = entrevistasDesde(await listarEntrevistas(), opcoes.desde);
  const zip = new JSZip();
  zip.file("entrevistas.json", JSON.stringify({ banco: banco.versao, entrevistas }, null, 2));
  zip.file("entrevistas.csv", "﻿" + montarCsv(banco, entrevistas));
  zip.file("LEIAME.txt", LEIAME);
  if (opcoes.aparelho) zip.file("aparelho.json", JSON.stringify(opcoes.aparelho, null, 2));

  for (const entrevista of entrevistas) {
    for (const audio of audiosDaResposta(entrevista, await audiosDaEntrevista(entrevista.id))) {
      zip.file(`audios/${pastaDa(entrevista)}/${audio.perguntaId}.${audio.extensao ?? "ogg"}`, audio.blob);
    }
  }
  return { blob: await zip.generateAsync({ type: "blob" }), total: entrevistas.length };
}

export function baixar(blob, nome) {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: nome });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function consolidar(banco, entrevistas) {
  return banco.perguntas
    .filter((p) => p.opcoes)
    .map((pergunta) => {
      const alcance = entrevistas.filter((e) =>
        montarFormulario(banco, e.perfil, e.respostas).some((p) => p.id === pergunta.id),
      );
      const contagem = pergunta.opcoes.map((opcao) => ({
        opcao,
        total: alcance.filter((e) => {
          const resposta = e.respostas[pergunta.id];
          return Array.isArray(resposta) ? resposta.includes(opcao) : resposta === opcao;
        }).length,
      }));
      return { pergunta, alcance: alcance.length, contagem };
    })
    .filter((linha) => linha.alcance > 0);
}

const objeto = (valor) => valor !== null && typeof valor === "object" && !Array.isArray(valor);

// Arquivo vindo de outro aparelho é entrada de fora: item sem a forma mínima derruba o
// consolidado inteiro, então fica de fora em vez de entrar.
export async function lerExportacao(arquivo) {
  const texto = /\.zip$/i.test(arquivo.name ?? "")
    ? await (await JSZip.loadAsync(await arquivo.arrayBuffer())).file("entrevistas.json")?.async("string")
    : await arquivo.text();
  if (!texto) throw new Error("O ZIP não tem entrevistas.json.");
  const dados = JSON.parse(texto);
  const lista = Array.isArray(dados) ? dados : dados?.entrevistas;
  if (!Array.isArray(lista)) throw new Error("Arquivo sem lista de entrevistas.");
  return lista.filter(
    (e) => objeto(e) && typeof e.id === "string" && objeto(e.perfil) && objeto(e.respostas) && typeof e.iniciadaEm === "string",
  );
}

export function juntarEntrevistas(locais, importadas) {
  const porId = new Map();
  for (const entrevista of [...locais, ...importadas]) {
    const anterior = porId.get(entrevista.id);
    if (!anterior || (entrevista.atualizadaEm ?? entrevista.iniciadaEm) > (anterior.atualizadaEm ?? anterior.iniciadaEm)) {
      porId.set(entrevista.id, entrevista);
    }
  }
  return [...porId.values()];
}
