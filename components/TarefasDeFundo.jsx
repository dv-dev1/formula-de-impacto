"use client";

import { useEffect } from "react";

import { recuperarGravacoes } from "@/lib/recuperar-gravacoes.mjs";
import { registrarErro } from "@/lib/registro.mjs";
import { aoVoltarOnline, processarFila } from "@/lib/transcrever.mjs";

// Montado no layout, fora da Tranca: a fila anda em qualquer tela, inclusive antes do PIN.
export default function TarefasDeFundo() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    navigator.storage?.persist?.().catch(() => {});
    recuperarGravacoes()
      .catch((erro) => registrarErro("recuperacao", erro))
      .then(processarFila)
      .catch(() => {});
    const aoErro = (evento) => registrarErro("window", evento.error ?? evento.message);
    const aoRejeitar = (evento) => registrarErro("unhandledrejection", evento.reason);
    window.addEventListener("error", aoErro);
    window.addEventListener("unhandledrejection", aoRejeitar);
    const parar = aoVoltarOnline(() => processarFila().catch(() => {}));
    return () => {
      parar();
      window.removeEventListener("error", aoErro);
      window.removeEventListener("unhandledrejection", aoRejeitar);
    };
  }, []);
  return null;
}
