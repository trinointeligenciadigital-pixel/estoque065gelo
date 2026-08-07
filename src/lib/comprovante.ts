import { dataHoraComprovante } from "./data.ts";
import { formatarPacotes, formatarPeso, parPacotesPeso } from "./formato.ts";
import { mascaraCnpj, mascaraTelefone } from "./mascaras.ts";

/*
  Comprovante de saída (venda/patrocínio) — formato único usado pelo operador (na
  tela de sucesso) e pelo Admin (no histórico, para reenviar depois). É um documento
  DERIVADO de uma movimentação já registrada; nada é gravado a partir daqui.
  O "Protocolo" vem da chave de idempotência (UUID do cliente), nunca do _id (RNF13).

  Correção "pacote prevalece, quilo agrega" (tarefa 5): cada item carrega a
  quantidade em pacotes como NÚMERO (`quantidadePacotes`), não mais pré-formatada
  — quem renderiza decide o destaque (visual) ou monta a linha de texto (plano).
  `null` = formato de peso variável, que não tem "pacote".
*/
export type ItemComprovante = {
  produtoNome: string;
  formatoNome: string;
  quantidadePacotes: number | null;
  pesoKg: number;
};

// Dados da empresa emissora (tarefa 7; cabeçalho reestruturado na correção
// "quatro ajustes pontuais", tarefa 2) — só os campos que vão pro cabeçalho
// do comprovante. `null` = ainda não cadastrada; cada campo individual pode
// faltar mesmo com o registro existindo (Admin ainda não preencheu tudo) —
// nesse caso a linha correspondente simplesmente não aparece.
export type DadosEmpresaComprovante = {
  nomeFantasia: string | null;
  razaoSocial: string | null;
  cnpj: string | null;
  inscricaoEstadual: string | null;
  endereco: string | null;
  telefone: string | null;
  whatsapp: string | null;
  logoUrl: string | null;
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
  empresa: DadosEmpresaComprovante | null;
};

export const SELO_NAO_FISCAL = "Documento não fiscal · controle interno de saída";

// Total de pacotes do carregamento — soma só os itens de formato fixo (peso
// variável não tem "pacote"). 0 quando é só granel: aí não existe "0 pacotes"
// pra mostrar, só o peso total.
export function totalPacotesComprovante(d: DadosComprovante): number {
  return d.itens.reduce((acc, it) => acc + (it.quantidadePacotes ?? 0), 0);
}

// Rótulo de UM item em texto puro (sem hierarquia visual — usado no texto
// copiado e no WhatsApp): quantidade antes do peso, como em toda a correção.
function itemLabelTexto(it: ItemComprovante): string {
  const qtd = it.quantidadePacotes !== null ? `${formatarPacotes(it.quantidadePacotes)} · ` : "";
  return `${it.produtoNome} · ${it.formatoNome} — ${qtd}${formatarPeso(it.pesoKg)}`;
}

function linhaTotalTexto(d: DadosComprovante): string {
  const totalPacotes = totalPacotesComprovante(d);
  return `Total: ${totalPacotes > 0 ? parPacotesPeso(totalPacotes, d.pesoTotalKg) : formatarPeso(d.pesoTotalKg)}`;
}

// Linhas de CONTEXTO do cartão visual (rótulo/valor simples) — cliente,
// veículo, motorista, câmara, registrado por. Itens e total têm layout
// próprio (quantidade + peso lado a lado, ver ComprovanteSaida / ComprovanteModal)
// porque não cabem num par rótulo/valor.
export type LinhaComprovante = { rotulo: string; valor: string; mono?: boolean };
export function linhasContexto(d: DadosComprovante): LinhaComprovante[] {
  return [
    { rotulo: "Cliente", valor: d.cliente || "—" },
    { rotulo: "Veículo", valor: d.veiculoLabel },
    ...(d.motorista ? [{ rotulo: "Motorista", valor: d.motorista }] : []),
    { rotulo: "Câmara", valor: d.camaraNome },
    { rotulo: "Registrado por", valor: d.operadorNome },
  ];
}

// Cabeçalho com a identidade de quem emitiu (tarefa 7.3), em quatro blocos
// fixos (correção "quatro ajustes pontuais", tarefa 2) — nome (fantasia, ou
// razão social se o fantasia estiver vazio), CNPJ + inscrição estadual,
// endereço, telefone + WhatsApp. Mesma estrutura nas três saídas (tela, texto
// copiado, WhatsApp) — aqui é a fonte usada pelas duas versões em texto;
// `cabecalhoEmpresaEstruturado` abaixo é a mesma lógica pras versões visuais
// (HistoricoPage, SaidaFlow), pra não duas grafias diferentes do mesmo dado.
// Campo vazio nunca vira rótulo órfão: a linha inteira some.
export type CabecalhoEmpresa = {
  nome: string | null; // null = empresa não cadastrada (nem fantasia, nem razão social)
  linhaCnpj: string | null; // "CNPJ · IE", o que houver
  endereco: string | null;
  linhaContato: string | null; // "telefone · whatsapp", o que houver
};
export function cabecalhoEmpresaEstruturado(empresa: DadosEmpresaComprovante | null): CabecalhoEmpresa {
  if (!empresa) return { nome: null, linhaCnpj: null, endereco: null, linhaContato: null };
  const nome = empresa.nomeFantasia || empresa.razaoSocial || null;
  // CNPJ e telefone/WhatsApp sempre com máscara na EXIBIÇÃO, nunca dependendo
  // de como foi gravado — um registro salvo antes da máscara existir (ou nunca
  // resalvo depois) tinha só dígitos, e o comprovante saía sem pontuação
  // nenhuma. mascaraCnpj/mascaraTelefone só extraem dígitos e reformatam, então
  // aplicar de novo em cima de um valor já formatado não muda nada.
  const linhaCnpj =
    [
      empresa.cnpj ? mascaraCnpj(empresa.cnpj) : null,
      empresa.inscricaoEstadual ? `IE ${empresa.inscricaoEstadual}` : null,
    ]
      .filter(Boolean)
      .join(" · ") || null;
  const linhaContato =
    [empresa.telefone ? mascaraTelefone(empresa.telefone) : null, empresa.whatsapp ? mascaraTelefone(empresa.whatsapp) : null]
      .filter(Boolean)
      .join(" · ") || null;
  return { nome, linhaCnpj, endereco: empresa.endereco || null, linhaContato };
}

function linhasCabecalhoEmpresa(empresa: DadosEmpresaComprovante | null): string[] {
  const h = cabecalhoEmpresaEstruturado(empresa);
  if (!h.nome) return ["*Comprovante de saída*"];
  return [
    `*${h.nome}*`,
    ...(h.linhaCnpj ? [h.linhaCnpj] : []),
    ...(h.endereco ? [h.endereco] : []),
    ...(h.linhaContato ? [h.linhaContato] : []),
  ];
}

// Texto pronto para WhatsApp / copiar. Usa *negrito* no título (sintaxe do WhatsApp).
export function textoComprovante(d: DadosComprovante): string {
  return [
    ...linhasCabecalhoEmpresa(d.empresa),
    `${d.rotulo} · ${dataHoraComprovante(d.quandoMs)}`,
    "",
    `Cliente: ${d.cliente || "—"}`,
    "Itens:",
    ...d.itens.map((it) => `- ${itemLabelTexto(it)}`),
    linhaTotalTexto(d),
    `Veículo: ${d.veiculoLabel}`,
    ...(d.motorista ? [`Motorista: ${d.motorista}`] : []),
    `Câmara: ${d.camaraNome}`,
    `Registrado por: ${d.operadorNome}`,
    "",
    `Protocolo: ${d.protocolo}`,
    "",
    SELO_NAO_FISCAL,
  ].join("\n");
}

export function linkWhatsappComprovante(d: DadosComprovante): string {
  return `https://wa.me/?text=${encodeURIComponent(textoComprovante(d))}`;
}
