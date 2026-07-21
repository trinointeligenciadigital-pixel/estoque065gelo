import { dataHora } from "./data.ts";

/*
  Comprovante de saída (venda/patrocínio) — formato único usado pelo operador (na
  tela de sucesso) e pelo Admin (no histórico, para reenviar depois). É um documento
  DERIVADO de uma movimentação já registrada; nada é gravado a partir daqui.
  O "Protocolo" vem da chave de idempotência (UUID do cliente), nunca do _id (RNF13).
*/
export type DadosComprovante = {
  rotulo: string; // "Venda" | "Patrocínio"
  quandoMs: number;
  cliente: string;
  produtoNome: string;
  formatoNome: string;
  quantidadeLabel: string; // vazio quando peso variável (o peso já é o total)
  pesoKg: number;
  veiculoLabel: string;
  motorista: string;
  camaraNome: string;
  operadorNome: string;
  protocolo: string;
};

function num(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

// Linhas exibidas no cartão do comprovante (mesma ordem do texto).
export function linhasComprovante(d: DadosComprovante): { rotulo: string; valor: string; mono?: boolean }[] {
  return [
    { rotulo: "Cliente", valor: d.cliente || "—" },
    { rotulo: "Produto", valor: d.produtoNome },
    { rotulo: "Formato", valor: d.formatoNome },
    ...(d.quantidadeLabel ? [{ rotulo: "Quantidade", valor: d.quantidadeLabel, mono: true }] : []),
    { rotulo: "Peso", valor: `${num(d.pesoKg)} kg`, mono: true },
    { rotulo: "Veículo", valor: d.veiculoLabel },
    ...(d.motorista ? [{ rotulo: "Motorista", valor: d.motorista }] : []),
    { rotulo: "Câmara", valor: d.camaraNome },
    { rotulo: "Registrado por", valor: d.operadorNome },
  ];
}

// Texto pronto para WhatsApp / copiar. Usa *negrito* no título (sintaxe do WhatsApp).
export function textoComprovante(d: DadosComprovante): string {
  return [
    "*Comprovante de saída — 065 Gelo*",
    `${d.rotulo} · ${dataHora(d.quandoMs)}`,
    "",
    `Cliente: ${d.cliente || "—"}`,
    `Produto: ${d.produtoNome}`,
    `Formato: ${d.formatoNome}`,
    ...(d.quantidadeLabel ? [`Quantidade: ${d.quantidadeLabel}`] : []),
    `Peso: ${num(d.pesoKg)} kg`,
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
