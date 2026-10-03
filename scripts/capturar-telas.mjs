// Recaptura as telas do app em alta densidade para o vídeo. A bateria de usabilidade grava
// a 1x porque mede layout; aqui o que importa é resolução, então sobe o deviceScaleFactor.
import { mkdirSync, writeFileSync } from "node:fs";

import { comandos, conectar, espera } from "./cdp.mjs";

const BASE = process.env.BASE_URL ?? "https://formula-de-impacto.pages.dev";
const SAIDA = process.env.SAIDA ?? "video/public/telas";
const DENSIDADE = Number(process.env.DENSIDADE ?? 2);

const { cdp, js, fechar } = await conectar(Number(process.env.CDP_PORT ?? 9223));
const { clicar, preencher, passarPelaTranca, limparAparelho } = comandos(js);

await cdp("Page.enable");
await cdp("Runtime.enable");
await cdp("Network.enable");
await cdp("Emulation.setDeviceMetricsOverride", {
  width: 800,
  height: 1280,
  deviceScaleFactor: DENSIDADE,
  mobile: true,
});

mkdirSync(SAIDA, { recursive: true });
const foto = async (nome) => {
  const { data } = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  writeFileSync(`${SAIDA}/${nome}.png`, Buffer.from(data, "base64"));
  console.log(`${nome}.png`);
};

const ir = async (rota) => {
  await cdp("Page.navigate", { url: `${BASE}${rota}` });
  await espera(2600);
};

await ir("/");
await limparAparelho();
await ir("/");
await passarPelaTranca();
await foto("tablet-1-inicio");

for (const rotulo of ["Agricultor(a) familiar", "Jovem (até 29 anos)", "Mulher"]) {
  await clicar(rotulo);
  await espera(320);
}
await foto("tablet-2-perfil");

await clicar("Começar entrevista");
await espera(2400);
await preencher("Nome do entrevistado", "Maria das Graças Silva");
await preencher("Comunidade", "Sítio Bom Jardim");
await preencher("Idade", "19");
await espera(700);
for (const rotulo of ["Nasci aqui", "Regular", "Água", "Estrada", "Só uma parte"]) {
  await clicar(rotulo);
  await espera(240);
}
await espera(900);
await foto("tablet-3-formulario");

await clicar("Concluir");
await espera(2600);
await foto("tablet-4-ficha");

await ir("/consolidado/");
await foto("tablet-5-consolidado");

fechar();
console.log(`\ncapturado a ${DENSIDADE}x em ${SAIDA}/`);
