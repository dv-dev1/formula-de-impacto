"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import Icone from "@/components/Icone";
import Resposta from "@/components/Resposta";
import Topo from "@/components/Topo";
import banco from "@/data/perguntas.json";
import { listarEntrevistas, obterEntrevista, salvarEntrevista } from "@/lib/db.mjs";
import { sincronizar } from "@/lib/enviar.mjs";
import {
  agruparPorSecao,
  idadeForaDaFaixa,
  limparOrfas,
  montarFormulario,
  progresso,
  respondida,
} from "@/lib/montar-formulario.mjs";
import { descreverPerfil } from "@/lib/rotulos.mjs";

const slug = (nome) => nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export default function Formulario() {
  const router = useRouter();
  const [id, setId] = useState(undefined);
  // `undefined` é "ainda buscando" e `null` é "não existe". Um estado só para os dois
  // deixava a tela em branco para sempre quando o id não estava no aparelho.
  const [entrevista, setEntrevista] = useState(undefined);
  const [sugestoes, setSugestoes] = useState({});
  const retomouRef = useRef(false);
  const telaRef = useRef(null);
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
    let vivo = true;
    let carga = 0;
    retomouRef.current = false;
    const carregar = async () => {
      const atual = ++carga;
      clearTimeout(timerRef.current);
      sujoRef.current = false;
      const achada = id ? await obterEntrevista(id) : null;
      if (!vivo || carga !== atual) return;
      primeiraCarga.current = true;
      ultimaRef.current = achada;
      setEntrevista(achada ?? null);
    };
    const aoRecuperar = ({ detail }) => {
      if (detail.entrevistaId !== id) return;
      setEntrevista((atual) => atual && !atual.respostas[detail.perguntaId]?.audioId ? {
        ...atual,
        respostas: {
          ...atual.respostas,
          [detail.perguntaId]: { ...atual.respostas[detail.perguntaId], audioId: detail.audioId, duracao: detail.duracao },
        },
      } : atual);
    };
    window.addEventListener("recuperado", aoRecuperar);
    carregar();
    listarEntrevistas().then((lista) => {
      if (!vivo) return;
      const valores = {};
      for (const campo of ["comunidade", "assentamento_nome"]) {
        const vistos = new Set();
        valores[campo] = [];
        for (const outra of [...lista].reverse()) {
          if (outra.id === id) continue;
          const valor = outra.respostas[campo]?.trim();
          if (!valor) continue;
          const chave = valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
          if (vistos.has(chave)) continue;
          vistos.add(chave);
          valores[campo].push(valor);
        }
      }
      setSugestoes(valores);
    });
    return () => {
      vivo = false;
      window.removeEventListener("recuperado", aoRecuperar);
    };
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

  const pendencias = useMemo(
    () => perguntas.filter((p) => !respondida(p, entrevista?.respostas[p.id])),
    [perguntas, entrevista],
  );

  useEffect(() => {
    const tela = telaRef.current;
    if (!tela) return;
    const topo = tela.querySelector(".topo");
    const indice = tela.querySelector(".indice");
    const medir = () => {
      const altura = topo.getBoundingClientRect().height;
      tela.style.setProperty("--altura-topo", `${altura}px`);
      tela.style.setProperty("--recuo-campo", `${altura + indice.getBoundingClientRect().height + 20}px`);
    };
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(topo);
    observador.observe(indice);
    return () => observador.disconnect();
  }, [entrevista?.id]);

  useEffect(() => {
    if (!entrevista || retomouRef.current) return;
    if (!feitas || !pendencias.length) {
      retomouRef.current = true;
      return;
    }
    const quadro = requestAnimationFrame(() => {
      retomouRef.current = true;
      document.getElementById(`p-${pendencias[0].id}`)?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(quadro);
  }, [entrevista, feitas, pendencias]);

  function proximaPendente() {
    const limite = document.querySelector(".indice")?.getBoundingClientRect().bottom ?? 0;
    const cartoes = pendencias.map((p) => document.getElementById(`p-${p.id}`)).filter(Boolean);
    const recuo = Number.parseFloat(getComputedStyle(cartoes[0]).scrollMarginTop);
    const proxima = cartoes.find((cartao) => cartao.getBoundingClientRect().top > Math.max(recuo, limite) + 2) ?? cartoes[0];
    proxima?.scrollIntoView({ block: "start" });
  }

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
    const concluida = { ...entrevista, concluidaEm: entrevista.concluidaEm ?? new Date().toISOString() };
    try {
      await salvarEntrevista(concluida);
    } catch {
      return setFalha("não salvou no aparelho — não feche o app");
    }
    sujoRef.current = false;
    sincronizar().catch(() => {});
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
    <div className="tela-entrevista" ref={telaRef}>
      <Topo titulo={entrevista.respostas.nome || "Nova entrevista"} voltar="/" />
      <nav className="indice" aria-label="Seções da entrevista">
        {secoes.map((secao) => {
          const { feitas, total } = progresso(secao.perguntas, entrevista.respostas);
          return (
            <a key={secao.nome} href={`#secao-${slug(secao.nome)}`} className="chip">
              {secao.nome} · {feitas === total ? "✓" : `faltam ${total - feitas}`}
            </a>
          );
        })}
      </nav>
      <div className="folha">
        <main className="conteudo">
        <p className="discreto" style={{ margin: 0 }}>
          {descreverPerfil(entrevista.perfil)}
        </p>

        {secoes.map((secao) => (
          <section key={secao.nome}>
            <h2 id={`secao-${slug(secao.nome)}`} className="secao">{secao.nome}</h2>
            <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
              {secao.perguntas.map((pergunta) => {
                numero += 1;
                const valor = entrevista.respostas[pergunta.id];
                return (
                  <div key={pergunta.id} id={`p-${pergunta.id}`} className="cartao">
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
                      sugestoes={sugestoes[pergunta.id]}
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

      <div className="rodape rodape-entrevista">
        <div style={{ flex: 1 }}>
          <div className="trilho">
            <span style={{ width: `${total ? (feitas / total) * 100 : 0}%` }} />
          </div>
          <p className="discreto" style={{ margin: "6px 0 0" }}>
            {feitas} de {total} · {falha || (salvo ? "salvo no aparelho" : "salvando…")}
          </p>
        </div>
        {pendencias.length > 0 && (
          <button type="button" className="botao secundario" onClick={proximaPendente}>
            Próxima pendente
          </button>
        )}
        <button type="button" className="botao" onClick={concluir} disabled={feitas === 0}>
          Concluir
        </button>
      </div>
    </div>
  );
}
