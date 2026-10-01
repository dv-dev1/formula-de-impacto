export const CATEGORIAS = [
  { valor: "agricultor", rotulo: "Agricultor(a) familiar" },
  { valor: "quilombola", rotulo: "Quilombola" },
  { valor: "assentado", rotulo: "Assentado(a)" },
  { valor: "poder_publico", rotulo: "Poder público" },
  { valor: "lideranca", rotulo: "Liderança comunitária", semFaixa: true },
  { valor: "cooperativa", rotulo: "Cooperativa ou associação", semFaixa: true },
  { valor: "ater", rotulo: "Assistência técnica (ATER)", semFaixa: true },
  { valor: "instituicao_financeira", rotulo: "Instituição financeira", semFaixa: true },
  { valor: "outro_ator", rotulo: "Outro ator do território", semFaixa: true },
];

export const CARGOS = [
  { valor: "prefeito", rotulo: "Prefeito(a)" },
  { valor: "cultura", rotulo: "Secretaria de Cultura" },
  { valor: "administracao", rotulo: "Secretaria de Administração" },
  { valor: "desenvolvimento_meio_ambiente", rotulo: "Secretaria de Desenvolvimento e Meio Ambiente" },
  { valor: "financas", rotulo: "Secretaria de Finanças" },
];

export const FAIXAS = [
  { valor: "jovem", rotulo: "Jovem (até 29 anos)" },
  { valor: "adulto", rotulo: "Adulto" },
];

export const GENEROS = [
  { valor: "feminino", rotulo: "Mulher" },
  { valor: "masculino", rotulo: "Homem" },
];

const achar = (lista, valor) => lista.find((item) => item.valor === valor)?.rotulo ?? valor;

export const rotuloCategoria = (valor) => achar(CATEGORIAS, valor);
export const rotuloCargo = (valor) => achar(CARGOS, valor);
export const rotuloFaixa = (valor) => achar(FAIXAS, valor);
export const rotuloGenero = (valor) => achar(GENEROS, valor);

export function descreverPerfil(perfil) {
  const partes =
    perfil.categoria === "poder_publico"
      ? [rotuloCargo(perfil.cargo)]
      : [rotuloCategoria(perfil.categoria), rotuloGenero(perfil.genero), rotuloFaixa(perfil.faixa)];
  return partes.filter(Boolean).join(" · ");
}
