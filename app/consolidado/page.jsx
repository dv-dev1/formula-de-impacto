"use client";

import { useEffect, useMemo, useState } from "react";

import Icone from "@/components/Icone";
import Topo from "@/components/Topo";
import banco from "@/data/perguntas.json";
import { listarEntrevistas } from "@/lib/db.mjs";
import { consolidar, juntarEntrevistas, lerExportacao } from "@/lib/exportar.mjs";
import { CATEGORIAS, FAIXAS, GENEROS, descreverPerfil } from "@/lib/rotulos.mjs";

const EIXOS = [
  { eixo: "categoria", itens: CATEGORIAS },
  { eixo: "faixa", itens: FAIXAS },
  { eixo: "genero", itens: GENEROS },
];

export default function Consolidado() {
  const [locais, setLocais] = useState([]);
  // ponytail: importadas vivem só na memória desta tela; persistir se recarregar virar dor no workshop.
  const [importadas, setImportadas] = useState([]);
  const [filtro, setFiltro] = useState({ categoria: "", faixa: "", genero: "" });
  const [falha, setFalha] = useState("");

  useEffect(() => {
    listarEntrevistas().then(setLocais);
  }, []);

  const entrevistas = useMemo(() => juntarEntrevistas(locais, importadas), [locais, importadas]);
  const deFora = entrevistas.length - locais.length;

  const recorte = useMemo(
    () => entrevistas.filter((e) => EIXOS.every(({ eixo }) => !filtro[eixo] || e.perfil[eixo] === filtro[eixo])),
    [entrevistas, filtro],
  );

  async function importar(evento) {
    setFalha("");
    const arquivos = [...evento.target.files];
    evento.target.value = "";
    try {
      const lidas = (await Promise.all(arquivos.map(lerExportacao))).flat();
      setImportadas((atuais) => juntarEntrevistas(atuais, lidas));
    } catch (erro) {
      setFalha(`Não consegui ler o arquivo: ${erro.message}`);
    }
  }

  const linhas = useMemo(() => consolidar(banco, recorte), [recorte]);

  return (
    <>
      <Topo titulo="Consolidado" voltar="/" />
      <div className="folha">
        <main className="conteudo">
        <div className="cartao">
          <p className="enunciado" style={{ marginBottom: 12 }}>
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
          <label className="botao secundario nao-imprime" style={{ marginTop: 12 }}>
            Importar de outro aparelho
            <input type="file" accept=".zip,.json" multiple hidden onChange={importar} />
          </label>
          {falha && <p className="aviso">{falha}</p>}
        </div>

        {recorte.length === 0 && <p className="aviso">Nenhuma entrevista neste recorte ainda.</p>}

        {linhas.map(({ pergunta, alcance, contagem }) => {
          const maior = Math.max(1, ...contagem.map((c) => c.total));
          return (
            <div key={pergunta.id} className="cartao">
              <p className="enunciado" style={{ fontSize: 18, marginBottom: 4 }}>
                {pergunta.texto}
              </p>
              <p className="discreto" style={{ margin: "0 0 12px" }}>
                {pergunta.secao} · perguntada a {alcance} de {recorte.length}
              </p>
              <table className="contagem">
                <tbody>
                  {contagem.map(({ opcao, total }) => (
                    <tr key={opcao}>
                      <td style={{ width: "42%" }}>{opcao}</td>
                      <td>
                        <div className="trilho dados">
                          <span style={{ width: `${(total / maior) * 100}%` }} />
                        </div>
                      </td>
                      <td className="n">
                        {total}
                        <span className="discreto">
                          {" "}
                          ({alcance ? Math.round((total / alcance) * 100) : 0}%)
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}

        {recorte.length > 0 && (
          <div className="cartao">
            <h2 className="secao" style={{ marginTop: 0 }}>
              Entrevistados
            </h2>
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
        <button type="button" className="botao" onClick={() => window.print()}>
          <Icone nome="imprimir" />
          Salvar em PDF
        </button>
      </div>
    </>
  );
}
