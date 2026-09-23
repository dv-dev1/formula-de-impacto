# Duas correções — 22 de setembro de 2026

Dois defeitos encontrados numa validação do app, corrigidos e testados. Um deles impedia o login.

Nenhum dos dois encosta no que você mexeu hoje: `components/Tranca.jsx` e `package.json` são os
únicos arquivos alterados.

---

## 1. A tranca travava calada quando o armazenamento falhava

**Arquivo:** `components/Tranca.jsx`

`cadastrar` e `entrar` eram `async` sem `try/catch`. As duas fazem coisas que podem falhar: gerar o
hash com `crypto.subtle`, gerar o sal com `crypto.randomUUID`, gravar no `localStorage`. Quando
qualquer uma estourava, o erro virava rejeição silenciosa — a pessoa tocava o botão e **não
acontecia nada**. Sem mensagem, sem log, app trancado.

Dois casos reais, os dois reproduzidos num Chrome de verdade:

| Cenário | Antes | Depois |
|---|---|---|
| `localStorage` estourando cota (aba anônima do Safari, dados do site bloqueados, armazenamento cheio) | nenhum aviso na tela, rejeição engolida | `"Não consegui guardar o acesso no aparelho…"` |
| App aberto por `http://` num IP da rede (ex.: `http://192.168.0.8:3111`) | nenhum aviso na tela | `"Este endereço não é seguro (precisa ser https ou localhost)…"` |

O segundo é traiçoeiro: fora de contexto seguro o navegador **não expõe** `crypto.subtle` nem
`crypto.randomUUID`. A tela de acesso monta normal e convida a digitar, mas nenhum código vai
funcionar nunca. Em produção (Cloudflare Pages, https) não acontece; acontece se alguém servir o app
num tablet pela rede local.

A correção envolve as duas funções em `try/catch` e escolhe a mensagem por `window.isSecureContext`.
É o mesmo cuidado que o `comecar()` de `app/page.jsx` já tinha para o IndexedDB — só faltava aqui.

**O que não mudou:** hash, sal, comparação e formato gravado. Quem já tem acesso criado **não
recadastra**, e o código de 4 números continua o mesmo. Confirmado numa bateria de 19 verificações
na tranca: cadastro, código certo, errado, curto, vazio, com letras, reload, sessão nova e rota
interna direta.

## 2. `npm test` rodava zero testes no Windows e saía verde

**Arquivo:** `package.json`

```
$ npm test
ℹ tests 0   ℹ pass 0   ℹ fail 0     ← exit code 0
```

O npm no Windows executa o script pelo `cmd.exe`, que não remove as aspas simples de
`node --test 'test/*.test.mjs'`. O Node recebia o caminho com as aspas dentro, não casava nada e
terminava com sucesso. Falso verde: quem rodasse `npm test` no Windows achava que tinha validado.

Trocado por aspas duplas — funciona igual nos dois shells. No Linux do CI nunca deu problema, porque
lá o shell já resolve o glob antes de o Node ver.

---

## Como conferir

```bash
npm test          # inclusive no Windows, onde antes dava 0
npm run build
```

## Achados não corrigidos

Encontrados na mesma validação, deixados de fora de propósito:

- **`app/page.jsx`** repete `"acesso-formula-impacto"` como literal em vez de importar o `CHAVE` de
  `Tranca.jsx:7`. Renomear a chave num lugar só faz o nome do entrevistador sumir das entrevistas,
  sem quebrar nada visível.
- **Não há freio de tentativas no PIN** — 12 códigos errados em 1,6 s, sem atraso nem bloqueio. Um
  PIN de 4 dígitos se esgota em minutos por script. Isso é **coerente com o que o código declara**
  (o comentário em `Tranca.jsx:10` e o texto da tela dizem que a tranca é para tablet passando de
  mão em mão, não para proteger dado). Fica registrado, não tratado como defeito.
- **Não existe caminho no app para redefinir um código esquecido.** A tela diz que "quem tiver
  acesso ao navegador consegue apagá-lo", mas na prática isso é limpar dados do site — o que leva as
  entrevistas junto.

## O que não foi rodado

`npm run validar`, `npm run comparar` e `npm run test:ui` — exigem produção, o Piper instalado e
Chrome com CDP. Nenhum foi afetado por estas duas mudanças, mas nenhum foi executado para confirmar.
