"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import Icone from "@/components/Icone";
import Resposta from "@/components/Resposta";
import Topo from "@/components/Topo";
import banco from "@/data/perguntas.json";
import { obterEntrevista, salvarEntrevista } from "@/lib/db.mjs";
import {
  agruparPorSecao,
  idadeForaDaFaixa,
  limparOrfas,
  montarFormulario,
  progresso,
  respondida,
} from "@/lib/montar-formulario.mjs";
import { descreverPerfil } from "@/lib/rotulos.mjs";

export default function Formulario() {
  const router = useRouter();
  const [id, setId] = useState(undefined);
  // `undefined` é "ainda buscando" e `null` é "não existe". Um estado só para os dois
  // deixava a tela em branco para sempre quando o id não estava no aparelho.
  const [entrevista, setEntrevista] = useState(undefined);
  const [salvo, setSalvo] = useState(true);
  const [falha, setFalha] = useState("");
  const primeiraCarga = useRef(true);
  const ultimaRef = useRef(null);
  const sujoRef = useRef(false);
  const timerRef = useRef(null);

  useEffect(() => {
    setId(new URLSearchParams(window.location.search).get("id"));
  }, []);

  useEffect(() => {
    if (id === undefined) return;
    if (id) obterEntrevista(id).then((achada) => setEntrevista(achada ?? null));
    else setEntrevista(null);
  }, [id]);

  function salvar(e) {
    return salvarEntrevista(e).then(
      () => {
        if (ultimaRef.current === e) sujoRef.current = false;
        setSalvo(true);
        setFalha("");
      },
      () => setFalha("não salvou no aparelho — não feche o app"),
    );
  }

  // Digitar dispara uma mudança por tecla; agrupar em 400 ms evita uma escrita por letra
  // sem arriscar o dado: qualquer pausa da mão já grava.
  useEffect(() => {
    if (!entrevista) return;
    ultimaRef.current = entrevista;
    if (primeiraCarga.current) {
      primeiraCarga.current = false;
      return;
    }
    sujoRef.current = true;
    setSalvo(false);
    timerRef.current = setTimeout(() => salvar(entrevista), 400);
    return () => clearTimeout(timerRef.current);
  }, [entrevista]);

  // Voltar ou fechar a aba dentro dos 400 ms cancelava o timer e a última resposta sumia.
  useEffect(() => {
    const salvarPendente = () => sujoRef.current && ultimaRef.current && salvar(ultimaRef.current);
    const aoOcultar = () => document.visibilityState === "hidden" && salvarPendente();
    window.addEventListener("pagehide", salvarPendente);
    document.addEventListener("visibilitychange", aoOcultar);
    return () => {
      window.removeEventListener("pagehide", salvarPendente);
      document.removeEventListener("visibilitychange", aoOcultar);
      salvarPendente();
    };
  }, []);

  const perguntas = useMemo(
    () => (entrevista ? montarFormulario(banco, entrevista.perfil, entrevista.respostas) : []),
    [entrevista],
  );
  const secoes = useMemo(() => agruparPorSecao(perguntas), [perguntas]);
  const { feitas, total } = progresso(perguntas, entrevista?.respostas ?? {});

  function responder(perguntaId, valor) {
    setEntrevista((atual) => {
      const respostas = { ...atual.respostas };
      if (valor === undefined || valor === "") delete respostas[perguntaId];
      else respostas[perguntaId] = valor;
      return { ...atual, respostas: limparOrfas(banco, atual.perfil, respostas) };
    });
  }

  async function concluir() {
    // O timer pendente gravaria por cima a versão sem concluidaEm.
    clearTimeout(timerRef.current);
    const concluida = { ...entrevista, concluidaEm: new Date().toISOString() };
    try {
      await salvarEntrevista(concluida);
    } catch {
      return setFalha("não salvou no aparelho — não feche o app");
    }
    sujoRef.current = false;
    router.push(`/relatorio/?id=${entrevista.id}`);
  }

  if (entrevista === undefined) return null;

  if (!id || entrevista === null) {
    return (
      <>
        <Topo titulo="Entrevista" voltar="/" />
        <div className="folha">
          <main className="conteudo">
            <p className="aviso">Entrevista não encontrada neste aparelho.</p>
          </main>
        </div>
      </>
    );
  }

  let numero = 0;

  return (
    <>
      <Topo titulo={entrevista.respostas.nome || "Nova entrevista"} voltar="/" />
      <div className="folha">
        <main className="conteudo">
        <p className="discreto" style={{ margin: 0 }}>
          {descreverPerfil(entrevista.perfil)}
        </p>

        {secoes.map((secao) => (
          <section key={secao.nome}>
            <h2 className="secao">{secao.nome}</h2>
            <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
              {secao.perguntas.map((pergunta) => {
                numero += 1;
                const valor = entrevista.respostas[pergunta.id];
                return (
                  <div key={pergunta.id} className="cartao">
                    <p className="enunciado">
                      <span className="numero">{numero}.</span>
                      {pergunta.texto}
                      {respondida(pergunta, valor) && (
                        <span className="selo selo-feito" style={{ marginLeft: 10, verticalAlign: "middle" }}>
                          <Icone nome="feito" tamanho={16} />
                        </span>
                      )}
                    </p>
                    <Resposta
                      pergunta={pergunta}
                      valor={valor}
                      textoOutro={entrevista.respostas[`${pergunta.id}_outro`]}
                      entrevistaId={entrevista.id}
                      aoResponder={responder}
                    />
                    {pergunta.id === "idade" && idadeForaDaFaixa(entrevista.perfil, entrevista.respostas) && (
                      <p className="aviso">
                        Idade não bate com a faixa escolhida no início. Confira com o entrevistado.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        </main>
      </div>

      <div className="rodape">
        <div style={{ flex: 1 }}>
          <div className="trilho">
            <span style={{ width: `${total ? (feitas / total) * 100 : 0}%` }} />
          </div>
          <p className="discreto" style={{ margin: "6px 0 0" }}>
            {feitas} de {total} · {falha || (salvo ? "salvo no aparelho" : "salvando…")}
          </p>
        </div>
        <button type="button" className="botao" onClick={concluir} disabled={feitas === 0}>
          Concluir
        </button>
      </div>
    </>
  );
}
