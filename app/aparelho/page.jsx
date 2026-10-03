"use client";

import { useEffect, useState } from "react";

import Topo from "@/components/Topo";
import { garantirIdentidade, sair, vincular } from "@/lib/enviar.mjs";
import { infoDoAparelho } from "@/lib/registro.mjs";
import { erroDeLogin, normalizarUsuario } from "@/lib/sincronizar.mjs";

const tamanho = (bytes) => bytes == null ? "indisponível" : `${(bytes / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
const data = (valor) => valor ? new Date(valor).toLocaleString("pt-BR") : "nenhuma";
const simOuNao = (valor) => valor == null ? "indisponível" : valor ? "sim" : "não";

function Conta() {
  const [conta, setConta] = useState(null);
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [repetir, setRepetir] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => setConta(garantirIdentidade()), []);

  async function criarLogin(evento) {
    evento.preventDefault();
    const invalido = erroDeLogin(normalizarUsuario(usuario), senha);
    if (invalido) return setAviso(invalido);
    if (senha !== repetir) return setAviso("As duas senhas não são iguais.");
    setOcupado(true);
    try {
      setConta(await vincular(usuario, senha));
      setSenha("");
      setRepetir("");
      setAviso("Pronto: entre com este usuário e senha em outro aparelho. A senha agora também destrava este.");
    } catch (erro) {
      setAviso(erro.message);
    } finally {
      setOcupado(false);
    }
  }

  async function sairDaqui() {
    try {
      const recusa = await sair();
      if (recusa) return setAviso(recusa);
      location.href = "/";
    } catch (erro) {
      setAviso(erro.message);
    }
  }

  return (
    <div className="cartao">
      <h2 className="secao" style={{ marginTop: 0 }}>Conta</h2>
      <p>Nome: <strong>{conta?.nome || "indisponível"}</strong></p>
      <p>Usuário: <strong>{conta?.usuario || "ainda sem usuário"}</strong></p>
      <p>ID do entrevistador: <strong>{conta?.id || "indisponível"}</strong></p>
      {conta && !conta.usuario && (
        <form onSubmit={criarLogin}>
          <label className="rotulo" htmlFor="novo-usuario">Usuário</label>
          <input id="novo-usuario" type="text" value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} />
          <label className="rotulo" htmlFor="nova-senha">Senha (pelo menos 6 caracteres)</label>
          <input id="nova-senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="new-password" />
          <label className="rotulo" htmlFor="repetir-senha">Repita a senha</label>
          <input id="repetir-senha" type="password" value={repetir} onChange={(e) => setRepetir(e.target.value)} autoComplete="new-password" />
          <button type="submit" className="botao" disabled={ocupado} style={{ width: "100%", marginTop: 18 }}>
            {ocupado ? "Enviando…" : "Criar usuário e senha"}
          </button>
        </form>
      )}
      {aviso && <p className="aviso">{aviso}</p>}
      <button type="button" className="botao secundario" onClick={sairDaqui} style={{ width: "100%", marginTop: 18 }}>
        Sair deste aparelho
      </button>
    </div>
  );
}

export default function Aparelho() {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    infoDoAparelho().then(setInfo);
  }, []);

  return (
    <>
      <Topo titulo="Aparelho e versão" voltar="/" />
      <div className="folha">
        <main className="conteudo">
          <Conta />
          {!info ? <p className="discreto">Lendo informações do aparelho…</p> : (
            <>
              <div className="cartao">
                <h2 className="secao" style={{ marginTop: 0 }}>Versão e armazenamento</h2>
                <p>Versão do app: <strong>{info.versao || "dev"}</strong></p>
                <p>Versão do questionário: <strong>{info.bancoVersao}</strong></p>
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
