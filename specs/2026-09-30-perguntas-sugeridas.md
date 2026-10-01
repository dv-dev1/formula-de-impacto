# Perguntas sugeridas e novos atores do território

## Intenção
Todo entrevistado responde ao mesmo bloco de avaliação do território. São as perguntas sugeridas
pelo cliente: segmento produtivo, potencial, organização, compradores, agregação de valor,
articulação, governança, seis aspectos de inclusão, desafios, apoios, oportunidades e considerações.
Com isso, o consolidado compara a visão de cada perfil.

A tela inicial ganha os atores que o app não entrevistava: liderança comunitária,
cooperativa/associação, ATER, instituição financeira e outro ator. Eles entram sem faixa etária.

"Outro"/"Outra" abre um campo para escrever qual. O CSV não perde a coluna de pergunta que saiu do
banco.

## Critério de aceite
- `npm test`: esperado `# fail 0`. Precisam passar os testes novos:
  - perfil sem faixa (liderança) recebe o bloco do território e nenhum bloco de produtor ou jovem;
  - prefeito sem `gestao_articulacao`;
  - `limparOrfas` apaga `<id>_outro` quando "Outra" é desmarcada;
  - `idadeForaDaFaixa` sem faixa;
  - CSV com `agregacao_valor_outro` logo após `agregacao_valor`;
  - CSV mantém a coluna `maiores_faltas`, que saiu do banco.
- `npm run build`: esperado `out/index.html`.
- Navegador:
  - "Liderança comunitária" pula a faixa etária;
  - marcar "Outra" mostra o campo e desmarcar apaga o texto;
  - a ficha mostra o texto do "Outro".

## Fora de escopo
- Perguntas 1–3, 5, 7–8 e 15–18 do formulário sugerido, que não vieram nas imagens.
- Tipo `matriz`: a pergunta 19 vira seis escalas.
- Pergunta obrigatória que bloqueia concluir.
- Textos do "Outro" listados no consolidado.
- Graus intermediários das escalas 9, 10, 11 e 13: o original só rotula as pontas. A confirmar com
  o cliente.
