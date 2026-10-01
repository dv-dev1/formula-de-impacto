# Consolidado compara a visão de cada ator do território

## Intenção
No workshop, o consolidado mostra onde os atores do território discordam. O mapa "quem vê o quê"
cruza as 12 escalas com as categorias de entrevistado e marca as linhas em que as médias se
afastam 1,5 ponto ou mais.

Os desafios e os apoios aparecem em ranking. As respostas abertas aparecem como falas, sem o nome
de quem falou. A cobertura mostra quais perfis faltam em cada comunidade.

O recorte filtra por comunidade, entrevistador e período. As entrevistas importadas sobrevivem ao
recarregar. O consolidado sai em CSV e imprime como relatório do território.

Fluxo e perguntas não mudam.

## Critério de aceite
- `npm test`: `ℹ fail 0`, com `test/territorio.test.mjs` cobrindo:
  - média e `n` por categoria, e divergência só com `n ≥ 2`;
  - falas sem o nome do entrevistado e contagem de áudio sem texto;
  - cobertura que junta "Sítio Novo" e "sitio novo";
  - filtro por comunidade, entrevistador e período;
  - CSV do consolidado.
  - Cada um é visto falhando antes de valer.
- `BASE_URL=http://localhost:8788 CDP_PORT=9223 npm run validar`: 0 falhas fora o `13-limite` (rota de transcrição, fora desta branch), com o cenário
  `18-consolidado`:
  - o mapa aparece;
  - a barra tem mais de 200 px;
  - a importada sobrevive ao reload.
- Navegador: impressão com cabeçalho do território e sem cartão partido ao meio.

## Fora de escopo
- Síntese por IA: espera login no servidor, na Fase 4 do roteiro.
- Mapa por comunidade georreferenciada.
- Cor de bom ou ruim nas escalas: algumas são invertidas (dependência alta é ruim), então a cor
  mede só a intensidade.
