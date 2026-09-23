"use client";

import { useEffect, useState } from "react";

import Icone from "./Icone";

const CHAVE = "acesso-formula-impacto";
const ABERTA = "acesso-liberado";
const TAMANHO = 4;

// Isto tranca a tela, não protege o dado: sem servidor, qualquer segredo vive no navegador
// e quem abrir o devtools do tablet lê as entrevistas direto do IndexedDB. Serve para o
// caso real de campo — o tablet passar de mão em mão — não contra quem quer os dados.
async function embaralhar(pin, sal) {
  const bytes = new TextEncoder().encode(`${sal}:${pin}`);
  const resumo = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(resumo)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

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
  const [nome, setNome] = useState("");
  const [pin, setPin] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState("");

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
    setPin("");
    setErro("");
  };

  // Mesmo cuidado do `comecar` em app/page.jsx: sem isto qualquer falha vira rejeição
  // silenciosa e o botão só não responde, com o entrevistado esperando. Fora do https
  // o navegador nem expõe `crypto.subtle`, e aí nenhum código vai funcionar nunca.
  const FORA_DO_HTTPS = "Este endereço não é seguro (precisa ser https ou localhost) e o código não funciona nele.";

  async function cadastrar(evento) {
    evento.preventDefault();
    if (!nome.trim()) return setErro("Diga seu nome — ele vai junto de cada entrevista.");
    if (pin.length !== TAMANHO) return setErro(`O código precisa ter ${TAMANHO} números.`);
    if (pin !== confirmacao) return setErro("Os dois códigos não são iguais.");

    try {
      const sal = crypto.randomUUID();
      const conta = { nome: nome.trim(), sal, resumo: await embaralhar(pin, sal) };
      localStorage.setItem(CHAVE, JSON.stringify(conta));
      setAcesso(conta);
      abrir();
    } catch {
      setErro(
        window.isSecureContext
          ? "Não consegui guardar o acesso no aparelho. Feche e abra o app; se continuar, libere o armazenamento para este site."
          : FORA_DO_HTTPS,
      );
    }
  }

  async function entrar(evento) {
    evento.preventDefault();
    try {
      if ((await embaralhar(pin, acesso.sal)) !== acesso.resumo) {
        setPin("");
        return setErro("Código errado.");
      }
      abrir();
    } catch {
      setErro(window.isSecureContext ? "Não consegui conferir o código. Feche e abra o app." : FORA_DO_HTTPS);
    }
  }

  if (acesso === undefined) return null;
  if (liberado) return children;

  const cadastro = acesso === null;

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
          <form className="cartao" onSubmit={cadastro ? cadastrar : entrar}>
            <p className="enunciado">{cadastro ? "Primeiro acesso" : `Olá, ${acesso.nome}`}</p>

            {cadastro && (
              <>
                <label className="rotulo" htmlFor="nome">
                  Seu nome
                </label>
                <input
                  id="nome"
                  type="text"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Quem vai fazer as entrevistas"
                  autoComplete="name"
                />
              </>
            )}

            <label className="rotulo" htmlFor="pin">
              {cadastro ? `Crie um código de ${TAMANHO} números` : "Seu código"}
            </label>
            <input
              id="pin"
              type="password"
              inputMode="numeric"
              autoComplete={cadastro ? "new-password" : "current-password"}
              className="pin"
              size={TAMANHO}
              maxLength={TAMANHO}
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, ""));
                setErro("");
              }}
            />

            {cadastro && (
              <>
                <label className="rotulo" htmlFor="confirmacao">
                  Repita o código
                </label>
                <input
                  id="confirmacao"
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  className="pin"
                  size={TAMANHO}
                  maxLength={TAMANHO}
                  value={confirmacao}
                  onChange={(e) => setConfirmacao(e.target.value.replace(/\D/g, ""))}
                />
              </>
            )}

            {erro && <p className="aviso">{erro}</p>}

            <button type="submit" className="botao" style={{ width: "100%", marginTop: 18 }}>
              <Icone nome="feito" />
              {cadastro ? "Criar acesso" : "Entrar"}
            </button>

            <p className="discreto" style={{ margin: "16px 0 0" }}>
              {cadastro
                ? "O código fica só neste aparelho e evita que outra pessoa mexa nas entrevistas. Ele não protege os dados de quem souber usar o navegador."
                : "Esqueceu o código? Ele fica neste aparelho — quem tiver acesso ao navegador consegue apagá-lo."}
            </p>
          </form>
        </main>
      </div>
    </>
  );
}
