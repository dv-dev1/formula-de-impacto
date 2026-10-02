-- Uma conta por tablet: o id e o segredo nascem no cadastro da Tranca, e o servidor guarda só o
-- hash do segredo. O papel muda à mão, com `wrangler d1 execute`.
CREATE TABLE entrevistadores (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  segredo_hash TEXT NOT NULL,
  papel TEXT NOT NULL DEFAULT 'entrevistador' CHECK (papel IN ('entrevistador', 'coordenador')),
  criado_em TEXT NOT NULL
);

-- A entrevista sobe inteira, como JSON: o painel conta com as mesmas funções do app.
CREATE TABLE entrevistas (
  id TEXT NOT NULL,
  entrevistador_id TEXT NOT NULL REFERENCES entrevistadores (id),
  dados TEXT NOT NULL,
  atualizada_em TEXT NOT NULL,
  recebida_em TEXT NOT NULL,
  apagada_em TEXT,
  PRIMARY KEY (entrevistador_id, id)
);
