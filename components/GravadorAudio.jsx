"use client";

import { useEffect, useRef, useState } from "react";

import { apagarPedacos, novoId, obterAudio, salvarAudio, salvarPedaco } from "@/lib/db.mjs";
import { registrarErro } from "@/lib/registro.mjs";
import { FORMATOS } from "@/lib/formatos-audio.mjs";
import { desenfileirar, enfileirar, juntarTranscricao, semTranscricaoAntiga, transcrever } from "@/lib/transcrever.mjs";
import Icone from "./Icone";

const formatoSuportado = () =>
  FORMATOS.find((f) => globalThis.MediaRecorder?.isTypeSupported?.(f.mime)) ?? { mime: "", extensao: "m4a" };

const relogio = (segundos) =>
  `${String(Math.floor(segundos / 60)).padStart(2, "0")}:${String(segundos % 60).padStart(2, "0")}`;

export default function GravadorAudio({ entrevistaId, perguntaId, valor, aoGravar }) {
  const [nivel, setNivel] = useState(null);
  const [silencio, setSilencio] = useState(false);
  const recursosRef = useRef(null);
  const vivoRef = useRef(true);
  const iniciandoRef = useRef(false);
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

  function liberarRecursos() {
    const recursos = recursosRef.current;
    if (!recursos) return;
    recursos.ativo = false;
    cancelAnimationFrame(recursos.quadro);
    recursos.contexto?.close().catch(() => {});
    recursos.trava?.release().catch(() => {});
    recursos.soltarLock?.();
    recursos.stream.getTracks().forEach((faixa) => faixa.stop());
    recursosRef.current = null;
  }

  useEffect(() => {
    vivoRef.current = true;
    const aoVisivel = () => {
      const recursos = recursosRef.current;
      if (document.visibilityState === "visible" && recursos?.ativo) manterTela(recursos);
    };
    document.addEventListener("visibilitychange", aoVisivel);
    return () => {
      vivoRef.current = false;
      document.removeEventListener("visibilitychange", aoVisivel);
      if (gravadorRef.current?.state === "recording") gravadorRef.current.stop();
      liberarRecursos();
    };
  }, []);

  function acompanharMicrofone(recursos) {
    const Contexto = window.AudioContext ?? window.webkitAudioContext;
    if (!Contexto) return;
    try {
      const contexto = new Contexto();
      recursos.contexto = contexto;
      const analisador = contexto.createAnalyser();
      contexto.createMediaStreamSource(recursos.stream).connect(analisador);
      const dados = new Float32Array(analisador.fftSize);
      let inicio = Date.now();
      let pico = 0;
      let conferiu = false;
      contexto.resume().catch(() => {});
      const medir = () => {
        if (!recursos.ativo) return;
        if (contexto.state !== "running") {
          inicio = Date.now();
          recursos.quadro = requestAnimationFrame(medir);
          return;
        }
        analisador.getFloatTimeDomainData(dados);
        const rms = Math.sqrt(dados.reduce((soma, valor) => soma + valor * valor, 0) / dados.length);
        if (!conferiu) {
          pico = Math.max(pico, rms);
          if (Date.now() - inicio >= 5000) {
            conferiu = true;
            setSilencio(pico < 0.01);
          }
        }
        setNivel(Math.min(100, rms * 500));
        recursos.quadro = requestAnimationFrame(medir);
      };
      medir();
    } catch {
      recursos.contexto?.close().catch(() => {});
      recursos.contexto = null;
    }
  }

  async function manterTela(recursos) {
    try {
      const trava = await navigator.wakeLock?.request("screen");
      if (!recursos.ativo) await trava?.release();
      else recursos.trava = trava;
    } catch {}
  }

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
    if (iniciandoRef.current || gravadorRef.current?.state === "recording") return;
    iniciandoRef.current = true;
    setErro("");
    setNivel(null);
    setSilencio(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!vivoRef.current) {
        stream.getTracks().forEach((faixa) => faixa.stop());
        return;
      }
      const recursos = { stream, ativo: true };
      recursosRef.current = recursos;
      const formato = formatoSuportado();
      const gravador = new MediaRecorder(stream, formato.mime ? { mimeType: formato.mime } : undefined);
      const pedacos = [];
      const gravacaoId = novoId();
      navigator.locks?.request(`gravacao-${gravacaoId}`, () => new Promise((soltar) => (recursos.soltarLock = soltar))).catch(() => {});
      const gravacoes = [];
      gravador.ondataavailable = (evento) => {
        if (!evento.data.size) return;
        const indice = pedacos.length;
        pedacos.push(evento.data);
        gravacoes.push(salvarPedaco({
          id: `${gravacaoId}-${indice}`, gravacaoId, entrevistaId, perguntaId, indice,
          blob: evento.data, mimeType: gravador.mimeType, extensao: formato.extensao,
          criadoEm: new Date().toISOString(),
        }).catch((erro) => registrarErro("gravador-pedaco", erro)));
      };
      gravador.onstop = async () => {
        liberarRecursos();
        if (!vivoRef.current) return;
        setNivel(null);
        setSilencio(false);
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
        // O último ondataavailable ainda pode estar escrevendo quando onstop chega.
        await Promise.all(gravacoes);
        if (!vivoRef.current) return;
        aoGravar({ ...semTranscricaoAntiga(valorRef.current), audioId: id, duracao });
        setGravando(false);
        transcreverAgora(id);
        try {
          await apagarPedacos(gravacaoId);
        } catch (erro) {
          registrarErro("gravador-pedaco", erro);
        }
      };
      gravadorRef.current = gravador;
      setSegundos(0);
      inicioRef.current = Date.now();
      gravador.start(10000);
      acompanharMicrofone(recursos);
      manterTela(recursos);
      setGravando(true);
    } catch {
      liberarRecursos();
      if (vivoRef.current) setErro("Não consegui acessar o microfone. Autorize o microfone para este site.");
    } finally {
      iniciandoRef.current = false;
    }
  }

  const parar = () => {
    if (gravadorRef.current?.state !== "recording") return;
    gravadorRef.current.stop();
  };

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

      {gravando && nivel !== null && (
        <div className="trilho" role="meter" aria-label="Nível do microfone" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(nivel)}>
          <span style={{ width: `${nivel}%` }} />
        </div>
      )}
      {gravando && silencio && <p className="aviso">Não estou ouvindo nada. Confira o microfone.</p>}

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

      {valor?.audioId && !gravando && <audio src={url || undefined} controls style={{ width: "100%" }} />}
    </div>
  );
}
