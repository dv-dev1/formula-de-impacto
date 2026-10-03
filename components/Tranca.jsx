"use client";

import { useEffect, useState } from "react";

import { ABERTA, acessar, embaralhar } from "@/lib/enviar.mjs";
import { erroDeLogin, normalizarUsuario } from "@/lib/sincronizar.mjs";

import Icone from "./Icone";

export const CHAVE = "acesso-formula-impacto";
const TAMANHO = 4;
// Fora do https o navegador nem expõe `crypto.subtle`, e nenhuma senha funcionaria nunca.
const FORA_DO_HTTPS = "Este endereço não é seguro (precisa ser https ou localhost) e a senha não funciona nele.";

const ler = () => {
  try {
    return JSON.parse(localStorage.getItem(CHAVE) || "null");
  } catch {
    return null;
  }
};

export default function Tranca({ children }) {
  const [acesso, setAcesso] = useState(undefined);
  const [liberado, setLiberado] = useState(false);
  const [criar, setCriar] = useState(false);
  const [nome, setNome] = useState("");
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    setAcesso(ler());
    try {
      setLiberado(sessionStorage.getItem(ABERTA) === "1");
    } catch {
      setLiberado(false);
    }
  }, []);

  const abrir = () => {
    try {
      sessionStorage.setItem(ABERTA, "1");
    } catch {
      /* aba anônima: vale só enquanto a tela estiver aberta */
    }
    setLiberado(true);
    setSenha("");
    setErro("");
  };

  const digitar = (guardar) => (evento) => {
    guardar(evento.target.value);
    setErro("");
  };

  async function primeiroAcesso(evento) {
    evento.preventDefault();
    const conta = ler();
    if (conta) {
      setAcesso(conta);
      return;
    }
    if (criar && !nome.trim()) return setErro("Diga seu nome — ele vai junto de cada entrevista.");
    const invalido = erroDeLogin(normalizarUsuario(usuario), senha);
    if (invalido) return setErro(invalido);
    if (criar && senha !== confirmacao) return setErro("As duas senhas não são iguais.");
    if (!window.isSecureContext) return setErro(FORA_DO_HTTPS);
    setOcupado(true);
    try {
      const conta = await acessar(criar ? "/api/conta" : "/api/entrar", criar ? { nome: nome.trim(), usuario, senha } : { usuario, senha });
      setAcesso(conta);
      abrir();
    } catch (falha) {
      setSenha("");
      setConfirmacao("");
      setErro(falha.message);
    } finally {
      setOcupado(false);
    }
  }

  async function destravar(evento) {
    evento.preventDefault();
    try {
      if ((await embaralhar(senha, acesso.sal)) !== acesso.resumo) {
        setSenha("");
        return setErro(acesso.usuario ? "Senha errada." : "Código errado.");
      }
      abrir();
    } catch {
      setErro(window.isSecureContext ? "Não consegui conferir a senha. Feche e abra o app." : FORA_DO_HTTPS);
    }
  }

  if (acesso === undefined) return null;
  if (liberado) return children;

  const primeiro = acesso === null;
  const antiga = !primeiro && !acesso.usuario;
  const novaConta = primeiro && criar;

  return (
    <>
      <header className="topo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="marca-topo" src="/icone-192.png" alt="" width={48} height={48} />
        <h1>
          <b>CAIXA</b> Fórmula de Impacto
        </h1>
      </header>

      <div className="marca-abertura">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="CAIXA Fórmula de Impacto" width={196} height={248} />
      </div>

      <div className="folha">
        <main className="conteudo">
          <form className="cartao" onSubmit={primeiro ? primeiroAcesso : destravar}>
            <p className="enunciado">{primeiro ? (criar ? "Nova conta" : "Entre com sua conta") : `Olá, ${acesso.nome}`}</p>

            {novaConta && (
              <>
                <label className="rotulo" htmlFor="nome">Seu nome</label>
                <input id="nome" type="text" value={nome} onChange={digitar(setNome)} placeholder="Quem vai fazer as entrevistas" autoComplete="name" />
              </>
            )}

            {primeiro && (
              <>
                <label className="rotulo" htmlFor="usuario">Usuário</label>
                <input id="usuario" type="text" value={usuario} onChange={digitar(setUsuario)} autoComplete="username" autoCapitalize="none" spellCheck={false} />
              </>
            )}

            {antiga ? (
              <>
                <label className="rotulo" htmlFor="pin">Seu código</label>
                <input
                  id="pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="current-password"
                  className="pin"
                  size={TAMANHO}
                  maxLength={TAMANHO}
                  value={senha}
                  onChange={(e) => {
                    setSenha(e.target.value.replace(/\D/g, ""));
                    setErro("");
                  }}
                />
              </>
            ) : (
              <>
                <label className="rotulo" htmlFor="senha">{novaConta ? "Crie uma senha (pelo menos 6 caracteres)" : "Sua senha"}</label>
                <input id="senha" type="password" autoComplete={novaConta ? "new-password" : "current-password"} value={senha} onChange={digitar(setSenha)} />
              </>
            )}

            {novaConta && (
              <>
                <label className="rotulo" htmlFor="confirmacao">Repita a senha</label>
                <input id="confirmacao" type="password" autoComplete="new-password" value={confirmacao} onChange={digitar(setConfirmacao)} />
              </>
            )}

            {erro && <p className="aviso">{erro}</p>}

            <button type="submit" className="botao" disabled={ocupado} style={{ width: "100%", marginTop: 18 }}>
              <Icone nome="feito" />
              {ocupado ? "Conferindo…" : novaConta ? "Criar conta" : "Entrar"}
            </button>

            {primeiro && (
              <button type="button" className="botao secundario" style={{ width: "100%", marginTop: 12 }} onClick={() => { setCriar(!criar); setErro(""); }}>
                {criar ? "Já tenho conta" : "Criar conta nova"}
              </button>
            )}

            <p className="discreto" style={{ margin: "16px 0 0" }}>
              {primeiro
                ? "O primeiro acesso em cada aparelho precisa de internet. Depois, a senha destrava este aparelho mesmo sem sinal."
                : antiga
                  ? "Esqueceu o código? Ele fica neste aparelho — quem tiver acesso ao navegador consegue apagá-lo."
                  : "Esqueceu a senha? Fale com a coordenação."}
            </p>
          </form>
        </main>
      </div>
    </>
  );
}
