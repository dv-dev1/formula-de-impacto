"use client";

import GravadorAudio from "./GravadorAudio";

function Opcao({ rotulo, marcada, redonda, aoTocar }) {
  return (
    <button type="button" className="opcao" aria-pressed={marcada} onClick={aoTocar}>
      <span className={`marcador ${redonda ? "redondo" : ""}`} aria-hidden="true" />
      <span>{rotulo}</span>
    </button>
  );
}

function CampoOutro({ pergunta, valor, texto, aoResponder }) {
  if (!pergunta.outro || ![].concat(valor ?? []).includes(pergunta.outro)) return null;
  return (
    <input
      type="text"
      placeholder="Qual?"
      value={texto ?? ""}
      onChange={(e) => aoResponder(`${pergunta.id}_outro`, e.target.value)}
      aria-label={`${pergunta.texto}: qual?`}
    />
  );
}

export default function Resposta({ pergunta, valor, textoOutro, entrevistaId, aoResponder }) {
  const trocar = (novo) => aoResponder(pergunta.id, novo);
  const outro = <CampoOutro pergunta={pergunta} valor={valor} texto={textoOutro} aoResponder={aoResponder} />;

  if (pergunta.tipo === "texto" || pergunta.tipo === "numero") {
    return (
      <input
        type={pergunta.tipo === "numero" ? "number" : "text"}
        inputMode={pergunta.tipo === "numero" ? "numeric" : "text"}
        value={valor ?? ""}
        onChange={(e) => trocar(e.target.value)}
        aria-label={pergunta.texto}
      />
    );
  }

  if (pergunta.tipo === "escala") {
    return (
      <div className="escala" role="group" aria-label={pergunta.texto}>
        {pergunta.opcoes.map((opcao, i) => (
          <button
            key={opcao}
            type="button"
            className="opcao"
            aria-pressed={valor === opcao}
            onClick={() => trocar(valor === opcao ? undefined : opcao)}
          >
            <span className="grau">{i + 1}</span>
            <span>{opcao}</span>
          </button>
        ))}
      </div>
    );
  }

  if (pergunta.tipo === "unica") {
    return (
      <div className="opcoes" role="group" aria-label={pergunta.texto}>
        {pergunta.opcoes.map((opcao) => (
          <Opcao
            key={opcao}
            rotulo={opcao}
            redonda
            marcada={valor === opcao}
            aoTocar={() => trocar(valor === opcao ? undefined : opcao)}
          />
        ))}
        {outro}
      </div>
    );
  }

  if (pergunta.tipo === "multipla") {
    const marcadas = valor ?? [];
    const cheio = pergunta.maximo && marcadas.length >= pergunta.maximo;
    return (
      <div className="opcoes" role="group" aria-label={pergunta.texto}>
        {pergunta.opcoes.map((opcao) => {
          const marcada = marcadas.includes(opcao);
          return (
            <Opcao
              key={opcao}
              rotulo={opcao}
              marcada={marcada}
              // Com o limite atingido, marcar a próxima troca a mais antiga em vez de travar:
              // no campo o entrevistado muda de ideia e ninguém quer desmarcar antes de marcar.
              aoTocar={() =>
                trocar(
                  marcada
                    ? marcadas.filter((m) => m !== opcao)
                    : cheio
                      ? [...marcadas.slice(1), opcao]
                      : [...marcadas, opcao],
                )
              }
            />
          );
        })}
        {outro}
        {pergunta.maximo && (
          <p className="discreto">
            {marcadas.length} de {pergunta.maximo} marcadas
          </p>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <GravadorAudio
        entrevistaId={entrevistaId}
        perguntaId={pergunta.id}
        valor={valor}
        aoGravar={(novo) => trocar(novo)}
      />
      <textarea
        placeholder={valor?.audioId ? "Transcrição — corrija o que sair errado" : "Ou anote aqui, se preferir escrever"}
        value={valor?.texto ?? ""}
        onChange={(e) => trocar({ ...valor, texto: e.target.value })}
        aria-label={pergunta.texto}
      />
      {valor?.transcritoEm && (
        <p className="discreto" style={{ margin: 0 }}>
          Texto vindo do áudio. Corrija o que estiver errado — a gravação continua salva.
        </p>
      )}
    </div>
  );
}
