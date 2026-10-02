"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import Icone from "@/components/Icone";
import Topo from "@/components/Topo";
import banco from "@/data/perguntas.json";
import { audiosDaEntrevista, obterEntrevista } from "@/lib/db.mjs";
import { agruparPorSecao, montarFormulario, progresso, respondida, respostasForaDoBanco } from "@/lib/montar-formulario.mjs";
import { audiosDaResposta, duracaoMinutos } from "@/lib/exportar.mjs";
import { descreverPerfil } from "@/lib/rotulos.mjs";

const relogio = (s = 0) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

function ValorResposta({ pergunta, valor, audios }) {
  if (!respondida(pergunta, valor)) return <em className="sem-resposta">Não respondida</em>;

  if (Array.isArray(valor)) {
    return (
      <ul style={{ margin: 0, paddingLeft: 22 }}>
        {valor.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }

  if (typeof valor === "object") {
    const audio = audios.find((a) => a.id === valor.audioId);
    return (
      <>
        {valor.audioId && (
          <p style={{ margin: "0 0 6px" }}>
            <span className="selo">áudio {relogio(valor.duracao)}</span>{" "}
            <span className="discreto">
              {pergunta.id}.{audio?.extensao ?? "ogg"}
            </span>
          </p>
        )}
        {valor.texto && <p style={{ margin: 0 }}>{valor.texto}</p>}
      </>
    );
  }

  return <strong>{valor}</strong>;
}

export default function Ficha() {
  const [id, setId] = useState(undefined);
  const [entrevista, setEntrevista] = useState(undefined);
  const [audios, setAudios] = useState([]);

  useEffect(() => {
    setId(new URLSearchParams(window.location.search).get("id"));
  }, []);

  useEffect(() => {
    if (id === undefined) return;
    if (!id) return setEntrevista(null);
    obterEntrevista(id).then((achada) => setEntrevista(achada ?? null));
    audiosDaEntrevista(id).then((lista) => setAudios(lista ?? []));
  }, [id]);

  if (entrevista === undefined) return null;

  if (!entrevista) {
    return (
      <>
        <Topo titulo="Ficha" voltar="/" />
        <div className="folha">
          <main className="conteudo">
            <p className="aviso">Entrevista não encontrada neste aparelho.</p>
          </main>
        </div>
      </>
    );
  }

  const perguntas = montarFormulario(banco, entrevista.perfil, entrevista.respostas);
  const { feitas, total } = progresso(perguntas, entrevista.respostas);
  const duracao = duracaoMinutos(entrevista);
  const anteriores = respostasForaDoBanco(banco, entrevista.respostas);
  const gravados = audiosDaResposta(entrevista, audios);

  return (
    <>
      <Topo titulo="Ficha da entrevista" voltar="/" />
      <div className="folha">
        <main className="conteudo">
        <div className="cartao">
          <h2 style={{ margin: "0 0 6px", fontSize: 24 }}>{entrevista.respostas.nome || "Sem nome"}</h2>
          <p style={{ margin: 0 }}>{descreverPerfil(entrevista.perfil)}</p>
          <p className="discreto" style={{ margin: "6px 0 0" }}>
            {entrevista.respostas.comunidade ? `${entrevista.respostas.comunidade} · ` : ""}
            {new Date(entrevista.iniciadaEm).toLocaleString("pt-BR")}
            {duracao !== null && ` · duração ${duracao} min`}
            {gravados.length > 0 && ` · ${gravados.length} áudio(s)`}
          </p>
        </div>

        {feitas < total && (
          <p className="aviso">
            {total - feitas} sem resposta · <Link href={`/entrevista/?id=${entrevista.id}`} className="alvo-toque">Completar</Link>
          </p>
        )}

        {agruparPorSecao(perguntas).map((secao) => (
          <section key={secao.nome}>
            <h2 className="secao">{secao.nome}</h2>
            <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
              {secao.perguntas.map((pergunta) => (
                <div key={pergunta.id} className="cartao">
                  <p className="discreto" style={{ margin: "0 0 6px" }}>
                    {pergunta.texto}
                  </p>
                  <ValorResposta
                    pergunta={pergunta}
                    valor={entrevista.respostas[pergunta.id]}
                    audios={audios}
                  />
                  {entrevista.respostas[`${pergunta.id}_outro`] && (
                    <p style={{ margin: "6px 0 0" }}>
                      {pergunta.outro}: {entrevista.respostas[`${pergunta.id}_outro`]}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
        {anteriores.length > 0 && (
          <section>
            <h2 className="secao">Respostas de versão anterior do questionário</h2>
            <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
              {anteriores.map(({ id, valor }) => (
                <div key={id} className="cartao">
                  <p className="discreto" style={{ margin: "0 0 6px" }}>{id}</p>
                  <strong>
                    {Array.isArray(valor) ? valor.join(", ") : valor && typeof valor === "object"
                      ? valor.texto || valor.transcrito || "áudio gravado" : String(valor ?? "")}
                  </strong>
                </div>
              ))}
            </div>
          </section>
        )}
        </main>
      </div>

      <div className="rodape nao-imprime">
        <button type="button" className="botao" onClick={() => window.print()}>
          <Icone nome="imprimir" />
          Salvar em PDF
        </button>
      </div>
    </>
  );
}
