-- Login por usuário e senha. Cada aparelho que entra ganha uma sessão; o segredo de cada
-- tablet antigo vira a primeira sessão dele, para nenhum tablet perder o acesso.
ALTER TABLE entrevistadores ADD COLUMN usuario TEXT;
ALTER TABLE entrevistadores ADD COLUMN senha_hash TEXT;
ALTER TABLE entrevistadores ADD COLUMN senha_sal TEXT;
ALTER TABLE entrevistadores ADD COLUMN falhas INTEGER NOT NULL DEFAULT 0;
ALTER TABLE entrevistadores ADD COLUMN bloqueado_ate TEXT;
CREATE UNIQUE INDEX entrevistadores_usuario ON entrevistadores (usuario);

CREATE TABLE sessoes (
  token_hash TEXT PRIMARY KEY,
  entrevistador_id TEXT NOT NULL REFERENCES entrevistadores (id),
  criada_em TEXT NOT NULL
);

INSERT INTO sessoes (token_hash, entrevistador_id, criada_em)
SELECT segredo_hash, id, criado_em FROM entrevistadores;
