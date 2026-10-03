# Login no banco e PDF do painel

## Intenção
Hoje a conta existe só no aparelho onde foi criada: quem entrevista no celular não consegue ver
os próprios dados no computador de casa. Com esta mudança:
- o primeiro acesso de cada aparelho é por **usuário e senha**, conferidos no banco D1;
- a mesma senha destrava o aparelho depois, inclusive sem sinal;
- o painel e o consolidado juntam as entrevistas do aparelho com as que a conta já enviou ao
  banco. O coordenador vê as da equipe inteira;
- a conta antiga, só com código, continua funcionando, e o Início oferece criar usuário e senha;
- o painel ganha "Salvar em PDF".

O fluxo da entrevista e as perguntas não mudam. O computador só lê.

## Critério de aceite
- `npm test` dá `ℹ fail 0`. Cada teste novo é visto falhando antes de valer. Em
  `test/servidor.test.mjs`, contra o SQL das migrações em `node:sqlite`:
  - criar conta devolve `{id, token}`, e usuário repetido devolve 409;
  - senha errada devolve 401;
  - a 11ª tentativa depois de 10 erros devolve 429, mesmo com a senha certa;
  - o token de `/api/entrar` vale em `/api/sincronizar` e em `/api/painel`;
  - o segredo de um tablet antigo continua valendo depois da migração `0002`;
  - `/api/conta/vincular` grava usuário e senha numa conta antiga, e depois `/api/entrar` funciona.
- `SINCRONIZAR=1 BASE_URL=http://localhost:8788 CDP_PORT=9223 npm run validar`, com
  `wrangler pages dev` e D1 local: só o `13-limite` falha. O cenário novo `25-login` passa:
  - cria a conta no aparelho A e conclui uma entrevista;
  - entra no aparelho B, um perfil limpo;
  - confere que o painel e o consolidado de B mostram essa entrevista;
  - confere que a senha errada não destrava B.
- `validar` sem `SINCRONIZAR` não chama `/api/conta`, `/api/entrar`, `/api/sincronizar` nem
  `/api/painel`.
- `npm run test:ui`: nenhum problema nos 9 aparelhos, com a Tranca nova e o `/painel/`.
- No browser, o botão "Salvar em PDF" do painel abre a impressão, e nenhum cartão sai cortado
  entre duas páginas.

## Fora de escopo
- Recuperar a senha. O coordenador redefine com `wrangler d1 execute`.
- Listar sessões ou encerrar uma sessão remotamente.
- Editar no computador uma entrevista começada em outro aparelho, ou baixá-la para lá.
- Abrir o relatório individual de uma entrevista que está só no banco.
- Limite por IP (`13-limite`).
- Atualizar o ambiente de demonstração.
