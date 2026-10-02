# Painel do entrevistador e banco no servidor

## Intenção
Até aqui, o cadastro da Tranca e as entrevistas existem só no tablet. Com esta mudança, os dois
também vão para um banco D1 no Cloudflare, ligados ao ID de quem entrevistou. O envio acontece em
três momentos:
- ao abrir o app;
- quando a rede volta;
- ao concluir uma entrevista.

Sem sinal, o app funciona como hoje.

A tela inicial ganha o botão "Painel". Cada entrevistador vê só os próprios números:
- quantas entrevistas fez e quantas concluiu;
- o grupo que mais entrevistou;
- a divisão por gênero, faixa e comunidade;
- o ritmo por dia;
- o que a maioria respondeu;
- quem ainda falta ouvir.

O coordenador vê o mesmo painel para a equipe inteira ou para um entrevistador, lendo do banco.

A tela da Tranca, o fluxo da entrevista e as perguntas não mudam.

## Critério de aceite
- `npm test`: `ℹ fail 0`. Os testes novos são `test/painel.test.mjs`, `test/sincronizar.test.mjs`
  e `test/servidor.test.mjs`, e cada um é visto falhando antes de valer:
  - o grupo mais ouvido e o empate entre grupos;
  - a maioria só com alcance ≥ 3;
  - o ritmo por dia local e as categorias sem entrevista;
  - a pendência de envio quando `enviadaEm` é anterior a `atualizadaEm`, e a entrevista antiga sem carimbo;
  - o servidor, contra o SQL da migração rodando em `node:sqlite`:
    - o cadastro na primeira chamada;
    - segredo errado devolve 401;
    - a conta A não lê nem sobrescreve a entrevista da conta B;
    - uma versão mais velha não sobrescreve uma mais nova;
    - apagar marca `apagada_em`;
    - o coordenador lê todas.
- `SINCRONIZAR=1 BASE_URL=http://localhost:8788 CDP_PORT=9223 npm run validar`, com
  `wrangler pages dev` e D1 local: 0 falhas fora o `13-limite`. Cenários:
  - `22-painel`: o grupo mais ouvido e a maioria aparecem;
  - `23-sincronizar`: a entrevista feita sem sinal chega ao banco quando a rede volta;
  - `24-isolamento`: A não lê B, e segredo errado devolve 401.
- A mesma bateria contra a prévia grava no banco `formula-de-impacto-previa`, não no de produção.
- `npm run test:ui`: nenhum problema nos 9 aparelhos, com `/painel/` auditada.

## Fora de escopo
- Login com e-mail e senha, e aprovação de cadastro: no MVP o cadastro continua aberto, como na
  Tranca.
- Envio do áudio: sobe só o JSON, que já leva a transcrição.
- Baixar entrevistas do servidor para outro tablet. Um entrevistador, um tablet.
- Consolidado lendo do banco.
- Limite de uso da rota de transcrição.
- Tela de administração: o papel de coordenador muda com `wrangler d1 execute`.
