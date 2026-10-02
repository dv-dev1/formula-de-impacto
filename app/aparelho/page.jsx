"use client";

import { useEffect, useState } from "react";

import Topo from "@/components/Topo";
import { garantirIdentidade } from "@/lib/enviar.mjs";
import { infoDoAparelho } from "@/lib/registro.mjs";

const tamanho = (bytes) => bytes == null ? "indisponível" : `${(bytes / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
const data = (valor) => valor ? new Date(valor).toLocaleString("pt-BR") : "nenhuma";
const simOuNao = (valor) => valor == null ? "indisponível" : valor ? "sim" : "não";

export default function Aparelho() {
  const [info, setInfo] = useState(null);
  const [entrevistadorId, setEntrevistadorId] = useState("");

  useEffect(() => {
    infoDoAparelho().then(setInfo);
    setEntrevistadorId(garantirIdentidade()?.id || "");
  }, []);

  return (
    <>
      <Topo titulo="Aparelho e versão" voltar="/" />
      <div className="folha">
        <main className="conteudo">
          {!info ? <p className="discreto">Lendo informações do aparelho…</p> : (
            <>
              <div className="cartao">
                <h2 className="secao" style={{ marginTop: 0 }}>Versão e armazenamento</h2>
                <p>Versão do app: <strong>{info.versao || "dev"}</strong></p>
                <p>Versão do questionário: <strong>{info.bancoVersao}</strong></p>
                <p>ID do entrevistador: <strong>{entrevistadorId || "indisponível"}</strong></p>
                <p>Service worker ativo: <strong>{simOuNao(info.swAtivo)}</strong></p>
                <p>Armazenamento persistido: <strong>{simOuNao(info.persistido)}</strong></p>
                <p>Espaço usado: <strong>{tamanho(info.estimate.usado)}</strong></p>
                <p>Cota disponível: <strong>{tamanho(info.estimate.cota)}</strong></p>
              </div>
              <div className="cartao">
                <h2 className="secao" style={{ marginTop: 0 }}>Entrevistas e pendências</h2>
                <p>Entrevistas no aparelho: <strong>{info.entrevistas.total ?? "indisponível"}</strong></p>
                <p>Concluídas: <strong>{info.entrevistas.concluidas ?? "indisponível"}</strong></p>
                <p>Transcrições pendentes: <strong>{info.transcricoesPendentes}</strong></p>
                <p>Pedaços de gravação a recuperar: <strong>{info.pedacosPendentes ?? "indisponível"}</strong></p>
                <p>Entrevistas importadas no consolidado: <strong>{info.importadas ?? "indisponível"}</strong></p>
                <p>Última exportação: <strong>{data(info.ultimaExportacao)}</strong></p>
              </div>
              <div className="cartao">
                <h2 className="secao" style={{ marginTop: 0 }}>Navegador</h2>
                <p className="discreto">{info.userAgent || "indisponível"}</p>
              </div>
              <section>
                <h2 className="secao">Erros recentes</h2>
                {info.erros.length === 0 ? <p className="discreto">Nenhum erro registrado.</p> : (
                  <ul className="lista" style={{ marginTop: 12 }}>
                    {info.erros.map((erro, indice) => (
                      <li className="cartao" key={indice}>
                        <p className="discreto" style={{ margin: "0 0 6px" }}>{data(erro.quando)} · {erro.onde}</p>
                        <p style={{ margin: 0 }}>{erro.mensagem}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </main>
      </div>
    </>
  );
}
