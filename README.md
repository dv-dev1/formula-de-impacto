# CAIXA Fórmula de Impacto

Formulário de entrevista de campo para diagnóstico territorial. O entrevistador escolhe quem está na
frente dele e o aparelho monta na hora só as perguntas daquele agente — prefeito e secretários,
agricultor, quilombola e assentado cruzados com gênero e faixa etária, ou liderança, cooperativa,
ATER e instituição financeira. Todos respondem ao mesmo bloco de visão do território.

Funciona sem sinal de celular: é onde a entrevista acontece.

```
$ npm test
# tests 53
# pass 53
# fail 0

$ npm run validar
40 verificações · 40 passaram · 0 falharam

$ npm run test:ui
9 aparelhos · 5 telas cada · telas em telas/
nenhum problema de usabilidade encontrado

$ npm run comparar
erro geral: 4.6% em 690 palavras
```

## Como funciona

| Peça | Arquivo |
|---|---|
| Banco de perguntas com tags de perfil | `data/perguntas.json` |
| Montagem do formulário a partir do perfil | `lib/montar-formulario.mjs` |
| Persistência local (IndexedDB) | `lib/db.mjs` |
| Gravação de áudio e fila de transcrição | `components/GravadorAudio.jsx`, `lib/transcrever.mjs`, `components/TarefasDeFundo.jsx` |
| Exportação em ZIP e consolidado | `lib/exportar.mjs` |
| Funcionamento offline | `public/sw.js` |

Uma pergunta pertence a um perfil por tag, não por formulário separado:

```json
{
  "id": "jovem_permanencia",
  "texto": "Depois de terminar o ensino médio, você pretende continuar morando na zona rural?",
  "quando": { "faixa": ["jovem"] }
}
```

São 22 perfis possíveis e cada um recebe de 23 a 41 perguntas — um teste prende esse intervalo.

## Transcrição

O áudio é gravado sempre e fica salvo no aparelho. A transcrição roda no servidor
(`functions/api/transcrever.js`, Workers AI com `@cf/openai/whisper-large-v3-turbo`): 2min39 de
fala saem em cerca de 15 segundos, com pontuação, nos formatos que Safari, Chrome e Firefox gravam.

Rodar Whisper dentro do navegador foi tentado e descartado: o Safari não libera
`SharedArrayBuffer` sem cabeçalhos de isolamento, então o modelo usa uma thread só, leva minutos e
esquenta o aparelho — com qualidade pior, porque só um modelo pequeno cabe.

Sem sinal a gravação fica anotada como pendente e a transcrição acontece sozinha quando a internet
volta, em qualquer tela do app. O texto entra depois do que já estava digitado, sem apagar. O ZIP exportado traz os áudios originais de qualquer forma, e o `LEIAME.txt` de dentro dele
tem o comando para refazer tudo no computador com o `vox`.

### Medir a qualidade da transcrição

`npm run comparar` gera fala em português com o Piper a partir de texto que nós escrevemos,
manda o áudio para a API e compara o que volta com esse texto. Como o texto de origem é
conhecido, o número é erro de verdade — não concordância entre duas transcrições.

```bash
npm run comparar                 # 12 falas × 3 vozes
MOSTRAR_TEXTO=1 npm run comparar # mostra o que foi escrito e o que voltou
```

As falas estão em `data/falas-de-teste.json` e usam o vocabulário que aparece no banco de
perguntas — escoar, assentamento, quilombola, Pronaf, Incra, cisterna, estiagem. É aí que a
transcrição erra, e é o erro que chega ao relatório.

A saída lista as palavras trocadas em mais de uma voz. Foi assim que apareceu o primeiro
caso: `escoar` voltando como `consome`, que significa o contrário do que a pessoa disse.

Essa medição encontrou o defeito que motivou o `initial_prompt` da função: sem contexto, o
modelo não espera ouvir os nomes próprios da política rural.

| | Sem vocabulário | Com `initial_prompt` |
|---|---|---|
| Erro geral | 7,2% | **4,6%** |
| `quilombola` | `o Amor` | correto nas 3 vozes |
| `Incra` | `em um crédito` | correto em 2 de 3 |
| `Pronaf` | `PUNAF`, `PONAF` | correto |
| `escoar` | `espor` | correto |

Voz sintética é limpa. Isso mede o caminho e o vocabulário, não vento, distância do
microfone ou sotaque — para isso não há substituto para gravar em campo.

Instalar (uma vez, ~380 MB, tudo fora do git):

```bash
python3 -m venv .piper/venv && .piper/venv/bin/pip install piper-tts
# vozes pt_BR de huggingface.co/rhasspy/piper-voices em .piper/vozes/
```

## Desenvolvimento

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # motor de montagem e exportação
npm run build        # export estático em out/
npm run servir       # serve out/ como o Cloudflare Pages serve
npm run test:ui      # usabilidade em 9 aparelhos (precisa de npm run servir e Chrome com CDP)
npm run validar      # bateria funcional contra produção (precisa de Chrome com microfone falso)
```

## Publicação

```bash
npx wrangler login
npm run deploy
```

## Licença

MIT, em `LICENSE`. O nome e a marca CAIXA não estão cobertos pela licença do código.
