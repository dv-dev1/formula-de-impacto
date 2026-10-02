"use client";

import { useEffect, useMemo, useState } from "react";

import Icone from "@/components/Icone";
import Topo from "@/components/Topo";
import banco from "@/data/perguntas.json";
import { esquecerImportadas, listarEntrevistas, listarImportadas, salvarImportadas } from "@/lib/db.mjs";
import { baixar, consolidar, juntarEntrevistas, lerExportacao } from "@/lib/exportar.mjs";
import { registrarErro } from "@/lib/registro.mjs";
import { CATEGORIAS, FAIXAS, GENEROS, descreverPerfil, rotuloCategoria } from "@/lib/rotulos.mjs";
import { cobertura, csvConsolidado, filtrar, mapaDeVisao, respostasAbertas } from "@/lib/territorio.mjs";

const EIXOS = [
  { eixo: "categoria", itens: CATEGORIAS },
  { eixo: "faixa", itens: FAIXAS },
  { eixo: "genero", itens: GENEROS },
];

const mostrarMedia = (media) => media === null ? "—" : media.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export default function Consolidado() {
  const [locais, setLocais] = useState([]);
  const [importadas, setImportadas] = useState([]);
  const [filtro, setFiltro] = useState({ categoria: "", faixa: "", genero: "", comunidade: null, entrevistador: "", desde: "", ate: "" });
  const [falha, setFalha] = useState("");
  const [ocupado, setOcupado] = useState(true);
  const [hoje, setHoje] = useState("");

  useEffect(() => {
    setHoje(new Date().toLocaleDateString("pt-BR"));
    Promise.all([listarEntrevistas(), listarImportadas()])
      .then(([doAparelho, deFora]) => {
        setLocais(doAparelho);
        setImportadas(deFora);
      })
      .catch((erro) => {
        registrarErro("consolidado: carregar", erro);
        setFalha("Não consegui ler as entrevistas do aparelho. Reabra esta tela para tentar novamente.");
      })
      .finally(() => setOcupado(false));
  }, []);

  const entrevistas = useMemo(() => juntarEntrevistas(locais, importadas), [locais, importadas]);
  const comunidades = useMemo(() => cobertura(entrevistas).comunidades, [entrevistas]);
  const entrevistadores = useMemo(() => [...new Set(entrevistas.map((e) => e.entrevistador).filter(Boolean))], [entrevistas]);
  const recorte = useMemo(() => filtrar(entrevistas, filtro), [entrevistas, filtro]);
  const idsLocais = new Set(locais.map((e) => e.id));
  const deFora = recorte.filter((e) => !idsLocais.has(e.id)).length;
  const linhas = useMemo(() => consolidar(banco, recorte), [recorte]);
  const mapa = useMemo(() => mapaDeVisao(banco, recorte), [recorte]);
  const abertas = useMemo(() => respostasAbertas(banco, recorte), [recorte]);
  const matriz = useMemo(() => cobertura(recorte), [recorte]);
  const descricaoRecorte = [
    ...EIXOS.map(({ eixo, itens }) => itens.find((item) => item.valor === filtro[eixo])?.rotulo),
    filtro.comunidade !== null && `Comunidade: ${comunidades.find((c) => c.chave === filtro.comunidade)?.rotulo ?? "Sem comunidade"}`,
    filtro.entrevistador && `Entrevistador: ${filtro.entrevistador}`,
    filtro.desde && `De ${filtro.desde.split("-").reverse().join("/")}`,
    filtro.ate && `Até ${filtro.ate.split("-").reverse().join("/")}`,
  ].filter(Boolean).join(" · ") || "Todas as entrevistas";

  async function importar(evento) {
    setFalha("");
    setOcupado(true);
    const arquivos = [...evento.target.files];
    evento.target.value = "";
    try {
      const lidas = (await Promise.all(arquivos.map(lerExportacao))).flat();
      const juntas = juntarEntrevistas(await listarImportadas(), lidas);
      await salvarImportadas(juntas);
      setImportadas(juntas);
    } catch (erro) {
      registrarErro("consolidado: importar", erro);
      setFalha(`Não consegui importar e guardar o arquivo: ${erro.message}`);
    } finally {
      setOcupado(false);
    }
  }

  async function esquecer() {
    setFalha("");
    setOcupado(true);
    try {
      await esquecerImportadas();
      setImportadas([]);
      setFiltro((f) => ({ ...f, comunidade: null, entrevistador: "" }));
    } catch (erro) {
      registrarErro("consolidado: esquecer importadas", erro);
      setFalha("Não consegui esquecer as importadas. Tente novamente.");
    } finally {
      setOcupado(false);
    }
  }

  function baixarCsv() {
    baixar(new Blob([csvConsolidado(linhas)], { type: "text/csv;charset=utf-8" }), "consolidado.csv");
  }

  return (
    <>
      <Topo titulo="Consolidado" voltar="/" />
      <div className="folha">
        <main className="conteudo consolidado">
          <header className="cabecalho-territorio">
            <h1>Diagnóstico do território</h1>
            <p>{hoje} · {recorte.length} entrevista(s)</p>
            <p>Recorte: {descricaoRecorte}</p>
          </header>
          <div className="cartao">
            <p id="total-entrevistas" data-total={recorte.length} className="enunciado" style={{ marginBottom: 12 }}>
              {recorte.length} entrevista(s) neste recorte
            </p>
            {deFora > 0 && <p className="discreto">{deFora} de outros aparelhos</p>}
            {EIXOS.map(({ eixo, itens }) => (
              <div key={eixo} className="opcoes nao-imprime" style={{ marginTop: 12 }}>
                {[{ valor: "", rotulo: "Todos" }, ...itens].map((item) => (
                  <button
                    key={item.valor}
                    type="button"
                    className="opcao"
                    aria-pressed={filtro[eixo] === item.valor}
                    onClick={() => setFiltro((f) => ({ ...f, [eixo]: item.valor }))}
                  >
                    <span className="marcador redondo" aria-hidden="true" />
                    <span>{item.rotulo}</span>
                  </button>
                ))}
              </div>
            ))}
            <div className="filtros-territorio nao-imprime">
              <label>
                Comunidade
                <select value={filtro.comunidade === null ? "*" : filtro.comunidade}
                  onChange={(e) => setFiltro((f) => ({ ...f, comunidade: e.target.value === "*" ? null : e.target.value }))}>
                  <option value="*">Todas as comunidades</option>
                  {comunidades.map(({ chave, rotulo }) => <option key={chave} value={chave}>{rotulo}</option>)}
                </select>
              </label>
              <label>
                Entrevistador
                <select value={filtro.entrevistador} onChange={(e) => setFiltro((f) => ({ ...f, entrevistador: e.target.value }))}>
                  <option value="">Todos os entrevistadores</option>
                  {entrevistadores.map((nome) => <option key={nome} value={nome}>{nome}</option>)}
                </select>
              </label>
              <label>
                Período: de
                <input type="date" value={filtro.desde} onChange={(e) => setFiltro((f) => ({ ...f, desde: e.target.value }))} />
              </label>
              <label>
                Período: até
                <input type="date" value={filtro.ate} onChange={(e) => setFiltro((f) => ({ ...f, ate: e.target.value }))} />
              </label>
            </div>
            <div className="acoes-territorio nao-imprime">
              <label className="botao secundario" aria-disabled={ocupado}>
                Importar de outro aparelho
                <input type="file" accept=".zip,.json" multiple hidden disabled={ocupado} onChange={importar} />
              </label>
              {importadas.length > 0 && (
                <button type="button" className="botao secundario" disabled={ocupado} onClick={esquecer}>Esquecer importadas</button>
              )}
              <button type="button" className="botao secundario" disabled={ocupado} onClick={baixarCsv}>Baixar CSV do consolidado</button>
            </div>
            {ocupado && <p className="discreto nao-imprime" role="status">Lendo ou guardando entrevistas…</p>}
            {falha && <p className="aviso" role="alert">{falha}</p>}
          </div>

          {recorte.length === 0 && !ocupado && <p className="aviso">Nenhuma entrevista neste recorte ainda.</p>}

          <div className="cartao">
            <h2 className="secao" style={{ marginTop: 0 }}>Mapa de visão — quem vê o quê</h2>
            <p className="discreto">Médias de 1 a 5 · n = respostas válidas. Visões diferentes: distância de pelo menos 1,5 ponto entre categorias com n ≥ 2.</p>
            <div className="tabela-rolagem" tabIndex={0} role="region" aria-label="Mapa de visão">
              <table className="tabela-territorio mapa-visao" aria-label="Quem vê o quê">
                <thead>
                  <tr>
                    <th scope="col">Escala</th>
                    {mapa.categorias.map((categoria) => <th key={categoria} scope="col">{rotuloCategoria(categoria)}</th>)}
                    <th scope="col">Geral</th>
                  </tr>
                </thead>
                <tbody>
                  {mapa.linhas.map(({ pergunta, celulas, mediaGeral, n, divergente }) => (
                    <tr key={pergunta.id}>
                      <th scope="row">{pergunta.texto}{divergente && <span className="selo visoes-diferentes">visões diferentes</span>}</th>
                      {mapa.categorias.map((categoria) => {
                        const celula = celulas[categoria];
                        return (
                          <td key={categoria} className="media-visao" style={{ "--intensidade": celula.media === null ? 0 : celula.media / 5 * 0.55 }}>
                            {mostrarMedia(celula.media)} <span className="amostra">n = {celula.n}</span>
                          </td>
                        );
                      })}
                      <td className="media-visao" style={{ "--intensidade": mediaGeral === null ? 0 : mediaGeral / 5 * 0.55 }}>
                        {mostrarMedia(mediaGeral)} <span className="amostra">n = {n}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {linhas.map(({ pergunta, alcance, contagem }) => {
            const maior = Math.max(1, ...contagem.map((c) => c.total));
            return (
              <div key={pergunta.id} className="cartao">
                <p className="enunciado" style={{ fontSize: 18, marginBottom: 4 }}>{pergunta.texto}</p>
                <p className="discreto" style={{ margin: "0 0 12px" }}>{pergunta.secao} · perguntada a {alcance} de {recorte.length}</p>
                <table className="contagem">
                  <colgroup><col style={{ width: "35%" }} /><col style={{ width: "45%" }} /><col style={{ width: "20%" }} /></colgroup>
                  <tbody>
                    {contagem.map(({ opcao, total }) => (
                      <tr key={opcao}>
                        <td>{opcao}</td>
                        <td><div className="trilho dados"><span style={{ width: `${(total / maior) * 100}%` }} /></div></td>
                        <td className="n">{total}<span className="discreto"> ({alcance ? Math.round((total / alcance) * 100) : 0}%)</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}

          <section aria-labelledby="respostas-abertas">
            <h2 id="respostas-abertas" className="secao">Respostas abertas</h2>
            <div className="lista-abertas">
              {abertas.filter((l) => l.falas.length || l.semTexto).map(({ pergunta, falas, semTexto }) => (
                <div key={pergunta.id} className="cartao">
                  <h3 className="enunciado">{pergunta.texto}{pergunta.outro && " — Outro"}</h3>
                  {falas.length > 0 && (
                    <ul className="falas">
                      {falas.map(({ texto, perfil }, indice) => <li key={indice}><p>{texto}</p><span className="discreto">{perfil}</span></li>)}
                    </ul>
                  )}
                  {semTexto > 0 && <p className="discreto">{semTexto} áudios ainda sem transcrição</p>}
                </div>
              ))}
              {!abertas.some((l) => l.falas.length || l.semTexto) && <p className="discreto">Nenhuma resposta aberta neste recorte.</p>}
            </div>
          </section>

          <div className="cartao">
            <h2 className="secao" style={{ marginTop: 0 }}>Cobertura por comunidade</h2>
            <p className="discreto">O zero destaca os perfis que faltam ouvir.</p>
            <div className="tabela-rolagem" tabIndex={0} role="region" aria-label="Cobertura por comunidade">
              <table className="tabela-territorio" aria-label="Categorias por comunidade">
                <thead><tr><th scope="col">Categoria</th>{matriz.comunidades.map(({ chave, rotulo }) => <th key={chave} scope="col">{rotulo}</th>)}</tr></thead>
                <tbody>
                  {matriz.linhas.map(({ categoria, contagem }) => (
                    <tr key={categoria}>
                      <th scope="row">{rotuloCategoria(categoria)}</th>
                      {matriz.comunidades.map(({ chave }) => <td key={chave} className={contagem[chave] === 0 ? "cobertura-zero" : ""}>{contagem[chave]}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {recorte.length > 0 && (
            <div className="cartao">
              <h2 className="secao" style={{ marginTop: 0 }}>Entrevistados</h2>
              <ul style={{ margin: "12px 0 0", paddingLeft: 22 }}>
                {recorte.map((e) => (
                  <li key={e.id}>
                    {e.respostas.nome || "Sem nome"} — <span className="discreto">{descreverPerfil(e.perfil)}</span>
                    {e.entrevistador && <span className="discreto"> · por {e.entrevistador}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </main>
      </div>

      <div className="rodape nao-imprime">
        <button type="button" className="botao" onClick={() => window.print()}><Icone nome="imprimir" />Salvar em PDF</button>
      </div>
    </>
  );
}
