"use client";

import { useEffect, useRef, useState } from "react";

import { novoId, obterAudio, salvarAudio } from "@/lib/db.mjs";
import { registrarErro } from "@/lib/registro.mjs";
import { FORMATOS } from "@/lib/formatos-audio.mjs";
import { desenfileirar, enfileirar, juntarTranscricao, semTranscricaoAntiga, transcrever } from "@/lib/transcrever.mjs";
import Icone from "./Icone";

const formatoSuportado = () =>
  FORMATOS.find((f) => globalThis.MediaRecorder?.isTypeSupported?.(f.mime)) ?? { mime: "", extensao: "m4a" };

const relogio = (segundos) =>
  `${String(Math.floor(segundos / 60)).padStart(2, "0")}:${String(segundos % 60).padStart(2, "0")}`;

export default function GravadorAudio({ entrevistaId, perguntaId, valor, aoGravar }) {
  const [gravando, setGravando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [erro, setErro] = useState("");
  const [url, setUrl] = useState("");
  const [estado, setEstado] = useState("");
  const gravadorRef = useRef(null);
  const inicioRef = useRef(0);
  const valorRef = useRef(valor);
  valorRef.current = valor;

  useEffect(() => {
    if (!valor?.audioId) return setUrl("");
    let vivo = true;
    let criada = "";
    obterAudio(valor.audioId).then((audio) => {
      if (!vivo || !audio) return;
      criada = URL.createObjectURL(audio.blob);
      setUrl(criada);
    });
    return () => {
      vivo = false;
      if (criada) URL.revokeObjectURL(criada);
    };
  }, [valor?.audioId]);

  useEffect(() => {
    if (!gravando) return;
    const timer = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [gravando]);

  async function transcreverAgora(audioId) {
    const audio = await obterAudio(audioId);
    if (!audio) return;

    if (!navigator.onLine) {
      enfileirar(entrevistaId, perguntaId, audioId);
      setEstado("sem sinal");
      return;
    }

    setEstado("transcrevendo");
    try {
      const texto = await transcrever(audio.blob);
      desenfileirar(audioId);
      if (valorRef.current?.audioId !== audioId) return;
      // A transcrição é rascunho e a gravação é o registro: o áudio continua salvo, e o
      // texto entra num campo que ele pode corrigir antes de fechar a entrevista.
      aoGravar(juntarTranscricao(valorRef.current, texto));
      setEstado("");
    } catch (falha) {
      if (falha.definitivo) {
        setEstado("");
        return setErro(`Não deu para passar este áudio para texto: ${falha.message}`);
      }
      enfileirar(entrevistaId, perguntaId, audioId);
      setEstado("sem sinal");
    }
  }

  // A fila roda em TarefasDeFundo e já gravou no banco; aqui só a memória da tela é
  // atualizada, senão o próximo save da página grava por cima sem o texto.
  useEffect(() => {
    if (!valor?.audioId) return;
    const aoTranscrever = ({ detail }) => {
      if (detail.audioId !== valorRef.current?.audioId) return;
      aoGravar(juntarTranscricao(valorRef.current, detail.texto));
      setEstado("");
    };
    window.addEventListener("transcrito", aoTranscrever);
    return () => window.removeEventListener("transcrito", aoTranscrever);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor?.audioId]);

  async function iniciar() {
    setErro("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const formato = formatoSuportado();
      const gravador = new MediaRecorder(stream, formato.mime ? { mimeType: formato.mime } : undefined);
      const pedacos = [];
      gravador.ondataavailable = (evento) => evento.data.size && pedacos.push(evento.data);
      gravador.onstop = async () => {
        stream.getTracks().forEach((faixa) => faixa.stop());
        const duracao = Math.round((Date.now() - inicioRef.current) / 1000);
        const id = novoId();
        try {
          await salvarAudio({
            id,
            entrevistaId,
            perguntaId,
            blob: new Blob(pedacos, { type: gravador.mimeType }),
            extensao: formato.extensao,
          });
        } catch (erro) {
          setErro("Não consegui guardar o áudio no aparelho. Anote a resposta no campo abaixo.");
          registrarErro("gravador", erro);
          setGravando(false);
          return;
        }
        aoGravar({ ...semTranscricaoAntiga(valorRef.current), audioId: id, duracao });
        setGravando(false);
        transcreverAgora(id);
      };
      gravadorRef.current = gravador;
      setSegundos(0);
      gravador.start();
      inicioRef.current = Date.now();
      setGravando(true);
    } catch {
      setErro("Não consegui acessar o microfone. Autorize o microfone para este site.");
    }
  }

  const parar = () => gravadorRef.current?.stop();

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <button
        type="button"
        className={`botao ${gravando ? "gravando" : ""}`}
        onClick={gravando ? parar : iniciar}
        disabled={estado === "transcrevendo"}
      >
        <Icone nome={gravando ? "parar" : "microfone"} />
        {gravando ? `Parar — ${relogio(segundos)}` : valor?.audioId ? "Gravar de novo" : "Gravar resposta"}
      </button>

      {estado === "transcrevendo" && (
        <div className="processando">
          <div className="trilho">
            <span style={{ width: "100%" }} />
          </div>
          <p className="discreto" style={{ margin: "8px 0 0" }}>
            Passando para texto…
          </p>
        </div>
      )}

      {estado === "sem sinal" && (
        <p className="aviso">
          Áudio guardado. Sem sinal para passar para texto agora — assim que pegar internet isso
          acontece sozinho.
        </p>
      )}

      {erro && <p className="aviso">{erro}</p>}

      {url && !gravando && <audio src={url} controls style={{ width: "100%" }} />}
    </div>
  );
}
