"use client";

import { useEffect, useMemo, useState } from "react";

import Topo from "@/components/Topo";
import banco from "@/data/perguntas.json";
import { listarEntrevistas } from "@/lib/db.mjs";
import { garantirIdentidade } from "@/lib/enviar.mjs";
import { resumoDoPainel } from "@/lib/painel.mjs";
import { registrarErro } from "@/lib/registro.mjs";
import { daConta, pendentesDeEnvio } from "@/lib/sincronizar.mjs";

function Barras({ titulo, linhas }) {
  const maior = Math.max(1, ...linhas.map((l) => l.total));
  return (
    <div className="cartao">
      <h2 className="secao" style={{ marginTop: 0 }}>{titulo}</h2>
      <table className="contagem" aria-label={titulo}>
        <colgroup><col style={{ width: "45%" }} /><col style={{ width: "30%" }} /><col style={{ width: "25%" }} /></colgroup>
        <tbody>
          {linhas.map(({ valor, rotulo, total, pct }) => (
            <tr key={valor ?? rotulo}>
              <td>{rotulo}</td>
              <td><div className="trilho dados"><span style={{ width: `${total / maior * 100}%` }} /></div></td>
              <td className="n">{total}{pct !== undefined && <span className="discreto"> ({pct}%)</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Resumo({ resumo }) {
  const numeros = [
    ["Entrevistas", resumo.total],
    ["Concluídas", resumo.concluidas],
    ["Em andamento", resumo.emAndamento],
    ["Duração média", resumo.duracaoMedia === null ? "—" : `${resumo.duracaoMedia} min`],
    ["Comunidades", resumo.comunidades],
  ];
  return (
    <>
      <div className="numeros-painel">
        {numeros.map(([rotulo, numero]) => (
          <div key={rotulo}><strong>{numero}</strong><span>{rotulo}</span></div>
        ))}
      </div>
      <div className="cartao">
        <h2 className="secao" style={{ marginTop: 0 }}>Grupo mais entrevistado</h2>
        <p>{resumo.maisOuvidos.map((c) => `${c.rotulo} — ${c.total} de ${resumo.total} (${c.pct}%)`).join("; ") || "—"}</p>
      </div>
      <Barras titulo="Por categoria" linhas={resumo.porCategoria} />
      <Barras titulo="Por gênero" linhas={resumo.porGenero} />
      <Barras titulo="Por faixa" linhas={resumo.porFaixa} />
      <Barras titulo="Por comunidade" linhas={resumo.porComunidade.slice(0, 10)} />
      <Barras titulo="Por dia" linhas={resumo.porDia.map((l) => ({ valor: l.dia, rotulo: l.dia.slice(5).split("-").reverse().join("/"), total: l.total }))} />
      <div className="cartao">
        <h2 className="secao" style={{ marginTop: 0 }}>O que a maioria respondeu</h2>
        <ul className="lista">
          {resumo.maioria.slice(0, 10).map(({ pergunta, opcao, total, alcance, pct }) => (
            <li key={pergunta.id}>
              <p className="enunciado" style={{ fontSize: 18, marginBottom: 4 }}>{pergunta.texto}</p>
              <p>{opcao} — {pct}% ({total} de {alcance})</p>
            </li>
          ))}
        </ul>
        {!resumo.maioria.length && <p className="discreto">Ainda não há respostas com alcance de pelo menos 3 entrevistas.</p>}
      </div>
      <div className="cartao">
        <h2 className="secao" style={{ marginTop: 0 }}>Grupos ainda não ouvidos</h2>
        <p>{resumo.faltamOuvir.join("; ") || "Todas as categorias já foram ouvidas."}</p>
      </div>
    </>
  );
}

export default function Painel() {
  const [conta, setConta] = useState(null);
  const [locais, setLocais] = useState([]);
  const [equipe, setEquipe] = useState(null);
  const [selecionado, setSelecionado] = useState("");
  const [ocupado, setOcupado] = useState(true);
  const [falha, setFalha] = useState("");
  const [semSinal, setSemSinal] = useState(false);

  useEffect(() => {
    let vivo = true;
    let carga = 0;
    const carregar = () => {
      const atual = ++carga;
      const identidade = garantirIdentidade();
      setConta(identidade);
      setSemSinal(navigator.onLine === false);
      listarEntrevistas().then((lista) => {
        if (!vivo || carga !== atual) return;
        setLocais(identidade ? lista.filter((e) => daConta(e, identidade)) : []);
        setFalha("");
      }).catch((erro) => {
        registrarErro("painel: carregar", erro);
        if (vivo && carga === atual) setFalha("Não consegui ler as entrevistas do aparelho. Reabra esta tela para tentar novamente.");
      }).finally(() => {
        if (vivo && carga === atual) setOcupado(false);
      });
      if (!identidade?.id || !identidade.segredo || navigator.onLine === false) {
        setEquipe(null);
        return;
      }
      fetch("/api/painel", { headers: { authorization: `Bearer ${identidade.id}.${identidade.segredo}` } })
        .then((r) => r.ok ? r.json() : null)
        .then((dados) => {
          if (vivo && carga === atual) setEquipe(dados?.papel === "coordenador" ? dados : null);
        }).catch(() => {
          if (vivo && carga === atual) setEquipe(null);
        });
    };
    const eventos = ["sincronizado", "transcrito", "recuperado", "online", "offline"];
    carregar();
    eventos.forEach((evento) => window.addEventListener(evento, carregar));
    return () => {
      vivo = false;
      eventos.forEach((evento) => window.removeEventListener(evento, carregar));
    };
  }, []);

  const meuResumo = useMemo(() => resumoDoPainel(banco, locais), [locais]);
  const recorte = useMemo(() => equipe?.entrevistas.filter((e) => !selecionado || e.entrevistadorId === selecionado) ?? [], [equipe, selecionado]);
  const resumoEquipe = useMemo(() => resumoDoPainel(banco, recorte), [recorte]);
  const enviados = locais.length - pendentesDeEnvio(locais).length;

  return (
    <>
      <Topo titulo="Painel" voltar="/" />
      <div className="folha">
        <main className="conteudo consolidado painel">
          {ocupado && <p className="discreto">Lendo entrevistas…</p>}
          {falha && <p className="aviso">{falha}</p>}
          {semSinal && <p className="discreto">Sem sinal: o painel mostra só este tablet.</p>}
          {!ocupado && !falha && (
            <section className="resumo-painel" aria-label="Meu painel">
              <h1>Painel de {conta?.nome || "entrevistador"}</h1>
              {locais.length ? <Resumo resumo={meuResumo} /> : <p>Nenhuma entrevista sua neste tablet ainda.</p>}
              <p className="discreto">Enviadas ao banco: {enviados} de {locais.length}</p>
            </section>
          )}
          {equipe && (
            <section className="resumo-painel" aria-label="Equipe">
              <h2 className="secao">Equipe</h2>
              <div className="filtros-territorio">
                <label>Entrevistador
                  <select value={selecionado} onChange={(e) => setSelecionado(e.target.value)}>
                    <option value="">Equipe inteira</option>
                    {equipe.entrevistadores.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
                  </select>
                </label>
              </div>
              <div className="cartao">
                <h2 className="secao" style={{ marginTop: 0 }}>Por entrevistador</h2>
                <table className="por-entrevistador" aria-label="Por entrevistador">
                  <thead><tr><th scope="col">Nome</th><th scope="col">Entrevistas</th><th scope="col">Concluídas</th><th scope="col">Última entrevista</th></tr></thead>
                  <tbody>
                    {equipe.entrevistadores.map((e) => {
                      const entrevistas = equipe.entrevistas.filter((item) => item.entrevistadorId === e.id);
                      const ultima = entrevistas.map((item) => item.iniciadaEm).sort().at(-1);
                      return <tr key={e.id}><td>{e.nome}</td><td>{entrevistas.length}</td><td>{entrevistas.filter((item) => item.concluidaEm).length}</td><td>{ultima ? new Date(ultima).toLocaleDateString("pt-BR") : "—"}</td></tr>;
                    })}
                  </tbody>
                </table>
              </div>
              <Resumo resumo={resumoEquipe} />
            </section>
          )}
        </main>
      </div>
    </>
  );
}
