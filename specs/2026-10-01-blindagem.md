# Blindagem contra perda de dado

## Intenção
O entrevistador não perde gravação nem exportação sem aviso, e o tablet funciona sem sinal mesmo
nas telas que ele ainda não abriu depois de uma atualização. Quem dá suporte enxerga, numa tela
"Aparelho", a versão do app, o espaço usado, as pendências e os erros recentes, e esses dados
vão junto no ZIP. Dois entrevistados com o mesmo nome no mesmo dia não se sobrescrevem no ZIP, e
a ficha mostra a resposta de uma pergunta que saiu do banco numa versão nova.

O consolidado volta a mostrar as barras na largura da coluna. Cada entrevista nova grava a versão
do app que a criou. O site ganha uma CSP mínima, que proíbe embutir o app em outra página, e o
Next sobe para 15.5.27.

Fluxo e perguntas não mudam.

## Critério de aceite
- `npm test`: `ℹ fail 0`, com testes novos para:
  - `pastaDa` com dois homônimos no mesmo dia;
  - `respostasForaDoBanco`;
  - integridade do banco: tipo conhecido, `outro` nas opções, `maximo` menor que as opções,
    escala de 5 graus;
  - `urlsDoExport`.
  - Cada teste novo é visto falhando antes de valer.
- `npm run build`:
  - `out/aparelho/index.html` existe;
  - `grep -c "_next/static" out/sw.js` maior que 0;
  - `grep -c '"dev"' out/sw.js` igual a 0.
- `BASE_URL=http://localhost:8788 CDP_PORT=9223 npm run validar`: 0 falhas fora o `13-limite` (rota de transcrição, fora desta branch), com os cenários novos:
  - `14-sw-precache`: `/relatorio/` e `/aparelho/` abrem offline sem terem sido visitadas;
  - `15-gravador-falha`: com a gravação do áudio sabotada, aparece o aviso e o botão volta para
    "Gravar".
- Navegador: as barras do consolidado ocupam a coluna (mais de 200 px num iPad de 820 px).

## Fora de escopo
- Mandar os erros para um servidor: o registro fica no aparelho e vai no ZIP.
- CSP com `script-src`: o export do Next usa script inline. Só entram `frame-ancestors`,
  `object-src`, `base-uri`, `form-action` e `connect-src`.
- Lixeira para entrevista apagada.
