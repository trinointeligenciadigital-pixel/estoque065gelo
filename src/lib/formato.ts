/*
  Formatação de números do domínio — padrão pt-BR único no app inteiro (Painel e
  PWA do colaborador). Antes desta função, "pacote" aparecia como unidade "pct"
  (lida como percentual) e o peso ora usava vírgula, ora ponto, ora número
  variável de casas decimais — inaceitável num sistema de estoque.
*/

// "1 pacote" / "1.461 pacotes" / "−3 pacotes" — sem casas decimais, separador
// de milhar pt-BR, singular só para exatamente 1 (positivo ou negativo).
export function formatarPacotes(n: number): string {
  const arredondado = Math.round(n);
  const unidade = Math.abs(arredondado) === 1 ? "pacote" : "pacotes";
  return `${arredondado.toLocaleString("pt-BR")} ${unidade}`;
}

// "37.047,0 kg" / "1.077,3 kg" / "5,7 kg" — 1 casa decimal, separador de
// milhar e decimal pt-BR. Abaixo de 1kg (migração pacote→unidade do
// saborizado: 1 unidade pesa ~0,19 kg), 1 casa decimal perderia precisão
// real (0,19 viraria "0,2 kg", um erro de ~5% já no formato mais miúdo) —
// aí mostra até 3 casas, sem zero à toa no fim (0,19 kg, não 0,190 kg).
export function formatarPeso(kg: number): string {
  const miudo = kg !== 0 && Math.abs(kg) < 1;
  const texto = kg.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: miudo ? 3 : 1,
  });
  return `${texto} kg`;
}

/*
  Rótulo canônico de um formato (adendo PWA, tarefa 2) — uma grafia só, usada em
  painel, PWA, comprovante e histórico. Antes, o mesmo formato aparecia como
  "Pacote 5,7kg" num lugar e "Pacote 30 unid" noutro: dois jeitos de escrever a
  MESMA embalagem porque cada tela lia campos diferentes. `nome` no banco agora é
  só a base ("Pacote", "Granel") — peso e unidades são sempre montados aqui.
  Peso variável não tem peso fixo pra mostrar: o nome sozinho já é o rótulo
  ("Granel").
*/
export type FormatoRotulo = {
  nome: string;
  pesoKg: number;
  pesoVariavel: boolean;
  unidadesPorPacote?: number | null;
  unidadeContagem?: "pacote" | "unidade" | null;
};
export function rotuloFormato(f: FormatoRotulo): string {
  if (f.pesoVariavel) return f.nome;
  const unidades = f.unidadesPorPacote ? ` · ${f.unidadesPorPacote} un` : "";
  return `${f.nome} ${formatarPeso(f.pesoKg)}${unidades}`;
}

// "21 pacotes · 119,7 kg" — o par padrão pacote+peso, nesta ordem, em texto
// puro (correção "pacote prevalece, quilo agrega"). Usado onde não há
// diferenciação visual de tamanho (texto copiado, WhatsApp, rótulos simples).
export function parPacotesPeso(qtdPacotes: number, pesoKg: number): string {
  return `${formatarPacotes(qtdPacotes)} · ${formatarPeso(pesoKg)}`;
}

/*
  Migração pacote→unidade (gelo saborizado): um formato de peso fixo pode
  contar em "pacotes" (padrão, embalagem com várias peças) ou em "unidade"
  (contagem direta, sem embalagem — cada peça é o item). Generaliza o padrão
  `pesoVariavel ? formatarPeso(x) : formatarPacotes(x)` que se repetia em
  cada tela, agora cobrindo os dois substantivos.
*/
export type FormatoUnidade = { pesoVariavel: boolean; unidadeContagem?: "pacote" | "unidade" | null };

// "unidade"/"unidades" ou "pacote"/"pacotes" — o substantivo certo, no
// singular/plural certo, pra este formato. Nunca chamado pra peso variável
// (que não tem substantivo de contagem, só kg).
export function nomeUnidade(f: FormatoUnidade, n: number): string {
  const singular = Math.abs(Math.round(n)) === 1;
  return (f.unidadeContagem ?? "pacote") === "unidade"
    ? singular
      ? "unidade"
      : "unidades"
    : singular
      ? "pacote"
      : "pacotes";
}

// "um"/"uma" — artigo certo pro substantivo de nomeUnidade (pacote é
// masculino, unidade é feminino), pra montar frases tipo "Aumentar um pacote".
export function artigoUnidade(f: FormatoUnidade): "um" | "uma" {
  return (f.unidadeContagem ?? "pacote") === "unidade" ? "uma" : "um";
}

// "1 unidade" / "1.461 pacotes" — mesma formatação de formatarPacotes
// (pt-BR, sem casas decimais), com o substantivo certo pro formato.
export function formatarContagem(n: number, f: FormatoUnidade): string {
  const arredondado = Math.round(n);
  return `${arredondado.toLocaleString("pt-BR")} ${nomeUnidade(f, n)}`;
}

// Substitui o padrão repetido `pesoVariavel ? formatarPeso(x) : formatarPacotes(x)`
// — agora também cobre o caso "unidade".
export function formatarQuantidade(n: number, f: FormatoUnidade): string {
  return f.pesoVariavel ? formatarPeso(n) : formatarContagem(n, f);
}
