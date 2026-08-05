import { dataHoraComprovante } from "./data.ts";
import { formatarPeso } from "./formato.ts";

/*
  Comprovante de saída (venda/patrocínio) — formato único usado pelo operador (na
  tela de sucesso) e pelo Admin (no histórico, para reenviar depois). É um documento
  DERIVADO de uma movimentação já registrada; nada é gravado a partir daqui.
  O "Protocolo" vem da chave de idempotência (UUID do cliente), nunca do _id (RNF13).
*/
// Um item do carregamento. Um comprovante tem 1+ itens; uma saída de um produto
// só é o caso itens.length === 1.
export type ItemComprovante = {
  produtoNome: string;
  formatoNome: string;
  quantidadeLabel: string; // vazio quando peso variável (o peso já é o total)
  pesoKg: number;
};

export type DadosComprovante = {
  rotulo: string; // "Venda" | "Patrocínio"
  quandoMs: number;
  cliente: string;
  itens: ItemComprovante[];
  pesoTotalKg: number;
  veiculoLabel: string;
  motorista: string;
  camaraNome: string;
  operadorNome: string;
  protocolo: string;
};

// Rótulo do item usado quando há mais de um produto no carregamento.
function itemLabel(it: ItemComprovante): string {
  const qtd = it.quantidadeLabel ? `${it.quantidadeLabel} · ` : "";
  return `${it.produtoNome} · ${it.formatoNome} — ${qtd}${formatarPeso(it.pesoKg)}`;
}

// Uma linha do cartão do comprovante. `forte` marca a linha do peso — o número
// protagonista, destacado maior/mono; `mono` alinha valores numéricos.
export type LinhaComprovante = { rotulo: string; valor: string; mono?: boolean; forte?: boolean };

// Linhas exibidas no cartão do comprovante. Cada item é uma linha com o
// nome à esquerda e o peso em mono à direita (não embrulha numa frase longa);
// o "Peso total" é a linha forte, o número que o cliente confere.
export function linhasComprovante(d: DadosComprovante): LinhaComprovante[] {
  const contexto: LinhaComprovante[] = [
    { rotulo: "Veículo", valor: d.veiculoLabel },
    ...(d.motorista ? [{ rotulo: "Motorista", valor: d.motorista }] : []),
    { rotulo: "Câmara", valor: d.camaraNome },
    { rotulo: "Registrado por", valor: d.operadorNome },
  ];

  if (d.itens.length === 1) {
    const it = d.itens[0];
    return [
      { rotulo: "Cliente", valor: d.cliente || "—" },
      { rotulo: "Produto", valor: it.produtoNome },
      { rotulo: "Formato", valor: it.formatoNome },
      ...(it.quantidadeLabel ? [{ rotulo: "Quantidade", valor: it.quantidadeLabel, mono: true }] : []),
      { rotulo: "Peso", valor: formatarPeso(it.pesoKg), mono: true, forte: true },
      ...contexto,
    ];
  }

  return [
    { rotulo: "Cliente", valor: d.cliente || "—" },
    ...d.itens.map((it) => ({
      rotulo: `${it.produtoNome} · ${it.formatoNome}${it.quantidadeLabel ? ` · ${it.quantidadeLabel}` : ""}`,
      valor: formatarPeso(it.pesoKg),
      mono: true,
    })),
    { rotulo: "Peso total", valor: formatarPeso(d.pesoTotalKg), mono: true, forte: true },
    ...contexto,
  ];
}

// Texto pronto para WhatsApp / copiar. Usa *negrito* no título (sintaxe do WhatsApp).
export function textoComprovante(d: DadosComprovante): string {
  const umItem = d.itens.length === 1;
  const it0 = d.itens[0];
  const blocoItens = umItem
    ? [
        `Produto: ${it0.produtoNome}`,
        `Formato: ${it0.formatoNome}`,
        ...(it0.quantidadeLabel ? [`Quantidade: ${it0.quantidadeLabel}`] : []),
        `Peso: ${formatarPeso(it0.pesoKg)}`,
      ]
    : [
        "Itens:",
        ...d.itens.map((it) => `- ${itemLabel(it)}`),
        `Peso total: ${formatarPeso(d.pesoTotalKg)}`,
      ];

  return [
    "*Comprovante de saída — 065 Gelo*",
    `${d.rotulo} · ${dataHoraComprovante(d.quandoMs)}`,
    "",
    `Cliente: ${d.cliente || "—"}`,
    ...blocoItens,
    `Veículo: ${d.veiculoLabel}`,
    ...(d.motorista ? [`Motorista: ${d.motorista}`] : []),
    `Câmara: ${d.camaraNome}`,
    `Registrado por: ${d.operadorNome}`,
    "",
    `Protocolo: ${d.protocolo}`,
  ].join("\n");
}

export function linkWhatsappComprovante(d: DadosComprovante): string {
  return `https://wa.me/?text=${encodeURIComponent(textoComprovante(d))}`;
}
