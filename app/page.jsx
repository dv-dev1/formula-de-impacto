"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import Icone from "@/components/Icone";
import Topo from "@/components/Topo";
import banco from "@/data/perguntas.json";
import { apagarEntrevista, listarEntrevistas, novoId, salvarEntrevista } from "@/lib/db.mjs";
import { anotarApagada, garantirIdentidade } from "@/lib/enviar.mjs";
import { baixar, entrevistasDesde, montarZip } from "@/lib/exportar.mjs";
import { montarFormulario, progresso } from "@/lib/montar-formulario.mjs";
import { ULTIMA_EXPORTACAO, infoDoAparelho, registrarErro } from "@/lib/registro.mjs";
import { CARGOS, CATEGORIAS, FAIXAS, GENEROS, descreverPerfil } from "@/lib/rotulos.mjs";
import { daConta } from "@/lib/sincronizar.mjs";
import { pendentes } from "@/lib/transcrever.mjs";

const lerLocal = (chave) => {
  try {
    return localStorage.getItem(chave);
  } catch {
    return null;
  }
};

function Escolha({ titulo, itens, valor, aoEscolher }) {
  return (
    <div className="cartao">
      <p className="enunciado">{titulo}</p>
      <div className="opcoes">
        {itens.map((item) => (
          <button
            key={item.valor}
            type="button"
            className="opcao"
            aria-pressed={valor === item.valor}
            onClick={() => aoEscolher(item.valor)}
          >
            <span className="marcador redondo" aria-hidden="true" />
            <span>{item.rotulo}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Inicio() {
  const router = useRouter();
  const [perfil, setPerfil] = useState({});
  const [entrevistas, setEntrevistas] = useState([]);
  const [exportando, setExportando] = useState(false);
  const [arquivoZip, setArquivoZip] = useState(null);
  const [paraApagar, setParaApagar] = useState(null);
  const [falha, setFalha] = useState("");
  const [ultimaExportacao, setUltimaExportacao] = useState(null);
  const [contaAntiga, setContaAntiga] = useState(false);
  const [fila, setFila] = useState([]);
  const [persistido, setPersistido] = useState(true);

  useEffect(() => {
    const atualizar = () => {
      listarEntrevistas().then((lista) => {
        const conta = garantirIdentidade();
        setEntrevistas(lista.filter((e) => conta && daConta(e, conta)));
      });
      setFila(pendentes());
    };
    atualizar();
    window.addEventListener("transcrito", atualizar);
    window.addEventListener("recuperado", atualizar);
    window.addEventListener("sincronizado", atualizar);
    setUltimaExportacao(lerLocal(ULTIMA_EXPORTACAO));
    const conta = garantirIdentidade();
    setContaAntiga(Boolean(conta && !conta.usuario));
    // ponytail: persisted() no Safari iOS a confirmar; o aviso some se ele sempre disser false sem PWA.
    navigator.storage?.persisted?.().then(setPersistido, () => {});
    for (const rota of ["/entrevista/", "/relatorio/", "/consolidado/", "/painel/", "/aparelho/"]) router.prefetch(rota);
    return () => {
      window.removeEventListener("transcrito", atualizar);
      window.removeEventListener("recuperado", atualizar);
      window.removeEventListener("sincronizado", atualizar);
    };
  }, [router]);

  const publico = perfil.categoria === "poder_publico";
  const semFaixa = CATEGORIAS.find((c) => c.valor === perfil.categoria)?.semFaixa;
  const completo = Boolean(
    perfil.categoria && perfil.genero && (publico ? perfil.cargo : semFaixa || perfil.faixa),
  );
  const naoExportadas = entrevistasDesde(entrevistas, ultimaExportacao).length;

  async function comecar() {
    // O poder público entra sempre como adulto: o banco usa a faixa para abrir o bloco de
    // juventude, e secretário não responde pergunta de permanência no campo.
    const escolhido = publico ? { ...perfil, faixa: "adulto" } : perfil;
    const conta = garantirIdentidade();
    const entrevista = {
      id: novoId(),
      perfil: escolhido,
      entrevistador: conta?.nome || "",
      entrevistadorId: conta?.id || "",
      respostas: {},
      bancoVersao: banco.versao,
      appVersao: process.env.NEXT_PUBLIC_VERSAO,
      iniciadaEm: new Date().toISOString(),
      concluidaEm: null,
    };
    try {
      await salvarEntrevista(entrevista);
    } catch {
      // Sem isto o botão simplesmente não responde e ele fica clicando na frente do
      // entrevistado, sem saber que o aparelho não conseguiu guardar nada.
      return setFalha("Não consegui guardar no aparelho. Feche e abra o app; se continuar, libere o armazenamento para este site.");
    }
    router.push(`/entrevista/?id=${entrevista.id}`);
  }

  async function apagar(id) {
    try {
      await apagarEntrevista(id);
      anotarApagada(id);
      const conta = garantirIdentidade();
      setEntrevistas((await listarEntrevistas()).filter((e) => conta && daConta(e, conta)));
    } catch {
      setFalha("Não consegui apagar agora. Tente de novo.");
    }
    setParaApagar(null);
  }

  async function exportar(desde) {
    setExportando(true);
    setArquivoZip(null);
    setFalha("");
    try {
      // Antes do ZIP: o que a fila gravar durante a montagem não está nele e tem que contar.
      const agora = new Date().toISOString();
      const conta = garantirIdentidade();
      const entrevistas = (await listarEntrevistas()).filter((e) => conta && daConta(e, conta));
      const { blob, total } = await montarZip(banco, { entrevistas, desde, aparelho: await infoDoAparelho() });
      const nome = `entrevistas-${agora.slice(0, 10)}-${total}.zip`;
      baixar(blob, nome);
      setArquivoZip(new File([blob], nome, { type: "application/zip" }));
      try {
        localStorage.setItem(ULTIMA_EXPORTACAO, agora);
      } catch {
        /* sem armazenamento o aviso só continua aparecendo */
      }
      setUltimaExportacao(agora);
    } catch (erro) {
      setFalha("Não consegui exportar as entrevistas. Tente de novo.");
      registrarErro("exportar", erro);
    } finally {
      setExportando(false);
    }
  }

  async function compartilhar() {
    try {
      await navigator.share({ files: [arquivoZip] });
    } catch (erro) {
      if (erro.name === "AbortError") return;
      setFalha("Não consegui compartilhar o ZIP. Tente de novo.");
      registrarErro("compartilhar", erro);
    }
  }

  return (
    <>
      <Topo
        titulo={
          <>
            <b>CAIXA</b> Fórmula de Impacto
          </>
        }
      />
      {entrevistas.length === 0 && !perfil.categoria && (
        <div className="marca-abertura">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="CAIXA Fórmula de Impacto" width={196} height={248} />
          <p className="promessa">Funciona sem sinal. As entrevistas ficam guardadas neste aparelho.</p>
        </div>
      )}

      <div className="folha">
        <main className="conteudo">
        {contaAntiga && (
          <div className="cartao">
            <p>Crie usuário e senha para ver suas entrevistas em outro aparelho.</p>
            <Link href="/aparelho/" className="botao secundario">Criar usuário e senha</Link>
          </div>
        )}
        <Escolha
          titulo="Quem você vai entrevistar?"
          itens={CATEGORIAS}
          valor={perfil.categoria}
          aoEscolher={(categoria) => setPerfil({ categoria })}
        />

        {publico && (
          <Escolha
            titulo="Qual pasta?"
            itens={CARGOS}
            valor={perfil.cargo}
            aoEscolher={(cargo) => setPerfil((p) => ({ ...p, cargo }))}
          />
        )}

        {perfil.categoria && !publico && !semFaixa && (
          <Escolha
            titulo="Faixa etária"
            itens={FAIXAS}
            valor={perfil.faixa}
            aoEscolher={(faixa) => setPerfil((p) => ({ ...p, faixa }))}
          />
        )}

        {perfil.categoria && (
          <Escolha
            titulo="Gênero"
            itens={GENEROS}
            valor={perfil.genero}
            aoEscolher={(genero) => setPerfil((p) => ({ ...p, genero }))}
          />
        )}

        {falha && <p className="aviso">{falha}</p>}

        {completo && (
          <p className="selo">
            {montarFormulario(banco, publico ? { ...perfil, faixa: "adulto" } : perfil).length} perguntas
            para este perfil
          </p>
        )}

        {entrevistas.length > 0 && (
          <>
            <h2 className="secao">Entrevistas no aparelho ({entrevistas.length})</h2>
            {naoExportadas > 0 && (
              <p className="aviso">
                {naoExportadas} entrevista(s) só neste aparelho desde a última exportação. Exporte o ZIP ao
                fim do dia.
              </p>
            )}
            {!persistido && (
              <p className="aviso">
                Instale o app na tela de início — o navegador pode apagar dados de site não instalado.
              </p>
            )}
            <ul className="lista">
              {entrevistas.map((entrevista) => {
                const perguntas = montarFormulario(banco, entrevista.perfil, entrevista.respostas);
                const { feitas, total } = progresso(perguntas, entrevista.respostas);
                const armado = paraApagar === entrevista.id;
                const esperando = fila.filter((i) => i.entrevistaId === entrevista.id).length;
                return (
                  <li key={entrevista.id} className="item">
                    <Link href={`/entrevista/?id=${entrevista.id}`}>
                      <span>
                        <strong>{entrevista.respostas.nome || "Sem nome"}</strong>
                        <br />
                        <span className="discreto">{descreverPerfil(entrevista.perfil)}</span>
                        <br />
                        {entrevista.concluidaEm ? (
                          <span className="selo">concluída</span>
                        ) : (
                          <span className="discreto">em andamento</span>
                        )}
                        {esperando > 0 && <span className="discreto"> · {esperando} áudio(s) esperando sinal</span>}
                      </span>
                      <span className="discreto">
                        {feitas}/{total}
                      </span>
                    </Link>
                    <div className="acoes">
                      <Link href={`/entrevista/?id=${entrevista.id}`}>Continuar</Link>
                      <Link href={`/relatorio/?id=${entrevista.id}`}>Ficha</Link>
                      <button
                        type="button"
                        className="perigo"
                        data-armado={armado}
                        onClick={() => (armado ? apagar(entrevista.id) : setParaApagar(entrevista.id))}
                        onBlur={() => armado && setParaApagar(null)}
                      >
                        <Icone nome="apagar" tamanho={19} />
                        {armado ? "Apagar mesmo?" : "Apagar"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div style={{ display: "grid", gap: 12 }}>
              <button type="button" className="botao secundario" onClick={() => exportar()} disabled={exportando}>
                <Icone nome="baixar" />
                {exportando ? "Preparando…" : "Exportar tudo (ZIP)"}
              </button>
              {naoExportadas > 0 && naoExportadas < entrevistas.length && (
                <button type="button" className="botao secundario" onClick={() => exportar(ultimaExportacao)} disabled={exportando}>
                  Exportar só as novas ({naoExportadas})
                </button>
              )}
              {arquivoZip && navigator.canShare?.({ files: [arquivoZip] }) && (
                <button type="button" className="botao secundario" onClick={compartilhar}>
                  Compartilhar ZIP (WhatsApp, e-mail…)
                </button>
              )}
            </div>
          </>
        )}
        <Link href="/consolidado/" className="botao secundario" style={{ marginTop: 12 }}>Ver consolidado</Link>
        <Link href="/painel/" className="botao secundario" style={{ marginTop: 12 }}>Painel</Link>
        <Link href="/aparelho/" className="discreto alvo-toque">Aparelho e versão</Link>
        </main>
      </div>

      <div className="rodape">
        <button type="button" className="botao" onClick={comecar} disabled={!completo}>
          Começar entrevista
        </button>
      </div>
    </>
  );
}
