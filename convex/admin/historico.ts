import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { query, type QueryCtx } from "../_generated/server";
import { exigirAdmin } from "../lib/auth";
import { rotuloPlacaOuTexto } from "../lib/placa";
import type { Doc } from "../_generated/dataModel";
import { dataEfetiva, FOLGA_RETROATIVA_MS } from "../lib/data";

/*
  Histórico de movimentações do Admin (RF61). Somente leitura — não existe nenhuma
  mutation de edição/exclusão de movimentação em lugar nenhum (RF36, RF62). O Admin
  lê tudo, de todas as câmaras (RF64). Filtros: câmara, produto, tipo, período e
  autor.

  Paginação real (auditoria de paginação): a base é sempre o índice
  by_registrado_em (mais recente primeiro), com `de`/`ate` como intervalo do
  próprio índice — não um `.collect()` de tabela inteira filtrado em memória
  como antes. Os demais filtros (câmara, produto, tipo, operador, autor,
  contagem) entram como `.filter()` do Convex sobre esse índice, antes do
  `.paginate()`. Câmara deixou de ter índice dedicado aqui de propósito: com
  uma fábrica só, poucas câmaras, o corte por data já limita o quanto o
  `.filter()` precisa varrer — e assim a ordenação por data fica sempre
  correta entre páginas, o que um índice separado por câmara não garantia.
*/

// Os mesmos filtros servem à lista paginada (listar) e à soma do recorte
// (resumo) — um só jeito de dizer "quais movimentações", para a faixa de
// totais nunca somar um conjunto diferente do que a tabela mostra.
const filtrosArgs = {
  camaraId: v.optional(v.id("camaras")),
  produtoId: v.optional(v.id("produtos")),
  // Formato (só faz sentido com produto escolhido) — com produto + câmara +
  // formato o recorte é exatamente o de saldoDoFormato (regra 6).
  formatoId: v.optional(v.id("formatos")),
  tipo: v.optional(
    v.union(
      v.literal("producao"),
      v.literal("venda"),
      v.literal("patrocinio"),
      v.literal("retornoPatrocinio"),
      v.literal("perda"),
      v.literal("ajuste"),
      v.literal("estorno"),
      v.literal("transferencia"),
    ),
  ),
  operadorId: v.optional(v.id("operadores")),
  // Filtra por um Admin específico (clerkId), não "qualquer admin" — desde a
  // tarefa 3 o filtro lista pessoas reais, não mais um balde genérico "Admin".
  autorClerkId: v.optional(v.string()),
  // Vindo de um link "ver ajustes desta contagem" (aba Histórico de Contagens,
  // tarefa 5). Quando presente, o front não colapsa por loteId — o Admin já
  // pediu para ver justamente as linhas daquela contagem.
  // Texto, não v.id: é o único filtro que só chega por link e a tela não tem
  // como conferir contra uma lista. Um link velho/cortado com um id malformado
  // derrubava a página inteira no validador; agora vira "nenhuma linha" (ver
  // idContagem abaixo) e a etiqueta do filtro deixa o Admin tirá-lo.
  contagemId: v.optional(v.string()),
  // Busca por protocolo (tarefa 4 do adendo) — qualquer lançamento (inclusive
  // ajuste e estorno) pode ser localizado por ele. É uma busca direta pelo
  // índice dedicado, sempre poucos resultados — não passa pelo paginate.
  protocolo: v.optional(v.string()),
  de: v.optional(v.number()),
  ate: v.optional(v.number()),
};

type Filtros = {
  camaraId?: Doc<"movimentacoes">["camaraId"];
  produtoId?: Doc<"movimentacoes">["produtoId"];
  formatoId?: Doc<"movimentacoes">["formatoId"];
  tipo?: Doc<"movimentacoes">["tipo"];
  operadorId?: Doc<"movimentacoes">["operadorId"];
  autorClerkId?: string;
  contagemId?: Doc<"movimentacoes">["contagemId"];
};

// contagemId do link → id de verdade. `null` = o link trouxe um id que não é
// de contagem nenhuma: o recorte é vazio, sem derrubar a consulta.
function idContagem(
  ctx: { db: { normalizeId: (t: "contagens", id: string) => Doc<"contagens">["_id"] | null } },
  contagemId: string | undefined,
): Doc<"contagens">["_id"] | undefined | null {
  return contagemId === undefined ? undefined : ctx.db.normalizeId("contagens", contagemId);
}

// Predicado dos filtros que não são o intervalo de data.
function combinaFiltros(
  args: Filtros,
  m: Pick<Doc<"movimentacoes">, "camaraId" | "produtoId" | "formatoId" | "tipo" | "operadorId" | "clerkId" | "contagemId">,
): boolean {
  return (
    (!args.camaraId || m.camaraId === args.camaraId) &&
    (!args.produtoId || m.produtoId === args.produtoId) &&
    (!args.formatoId || m.formatoId === args.formatoId) &&
    (!args.tipo || m.tipo === args.tipo) &&
    (!args.operadorId || m.operadorId === args.operadorId) &&
    (!args.autorClerkId || m.clerkId === args.autorClerkId) &&
    (!args.contagemId || m.contagemId === args.contagemId)
  );
}

// Uma linha do Histórico, já com nomes e derivados — usada pela lista e pelo
// carregamento completo do comprovante.
async function linhaDoHistorico(ctx: QueryCtx, m: Doc<"movimentacoes">) {
  // "Este lançamento já foi estornado?" nunca é um campo cacheado (regra
  // arquitetural 1/2 — movimentacoes é append-only, sem patch): é sempre
  // esta leitura, pelo índice by_estorno_de — um lookup pontual por
  // linha, não mais uma varredura de todos os estornos já registrados.
  const produto = await ctx.db.get(m.produtoId);
  const formato = await ctx.db.get(m.formatoId);
  const camara = await ctx.db.get(m.camaraId);
  const operador = m.operadorId ? await ctx.db.get(m.operadorId) : null;
  // Veículo para o comprovante: próprio (placa · modelo) ou terceiro
  // (placa normalizada com máscara de exibição + modelo, marcado como
  // terceiro — tarefa 3). Registro anterior a esta correção pode ter
  // texto livre que não é placa nenhuma; rotuloPlacaOuTexto devolve
  // como veio, sem inventar uma placa que não existe.
  const estorno = await ctx.db
    .query("movimentacoes")
    .withIndex("by_estorno_de", (q) => q.eq("estornoDe", m._id))
    .first();
  const veiculoProprio = m.veiculoId ? await ctx.db.get(m.veiculoId) : null;
  const veiculo = veiculoProprio
    ? `${veiculoProprio.placa}${veiculoProprio.modelo ? ` · ${veiculoProprio.modelo}` : ""}`
    : m.veiculoTerceiro
      ? `${rotuloPlacaOuTexto(m.veiculoTerceiro)} (terceiro)${m.veiculoTerceiroModelo ? ` · ${m.veiculoTerceiroModelo}` : ""}`
      : null;
  // Se ESTA linha é um estorno, busca o protocolo do original pra
  // referenciar ("Estorno de ABCD1234") — o estorno em si não tem
  // motivoPerda/clienteNome, então o Detalhe mostra isto no lugar.
  const original = m.estornoDe ? await ctx.db.get(m.estornoDe) : null;
  return {
    _id: m._id,
    tipo: m.tipo,
    sinal: m.sinal,
    produtoNome: produto?.nome ?? "—",
    formatoNome: formato?.nome ?? "—",
    formatoPesoKg: formato?.pesoKg ?? 0,
    formatoPesoVariavel: formato?.pesoVariavel ?? false,
    formatoUnidadesPorPacote: formato?.unidadesPorPacote ?? null,
    formatoUnidadeContagem: formato?.unidadeContagem ?? "pacote",
    camaraNome: camara?.nome ?? "—",
    quantidade: m.quantidade,
    pesoKg: m.pesoKg,
    clienteNome: m.clienteNome ?? null,
    veiculo,
    motorista: m.motorista ?? null,
    motivoPerda: m.motivoPerda ?? null,
    observacao: m.observacao ?? null,
    motivoCategoria: m.motivoCategoria ?? null,
    motivoTexto: m.motivoTexto ?? null,
    // autorNome é o snapshot da tarefa 3; registros pré-migração ainda
    // sem ele caem no mesmo cálculo que o Histórico já fazia antes.
    autor:
      m.autorNome ??
      (m.registradoPorTipo === "operador" ? operador?.nome ?? "—" : "Admin (registro anterior)"),
    autorTipo: m.registradoPorTipo,
    registradoEm: m.registradoEm,
    dataMovimento: dataEfetiva(m),
    // Agrupador do carregamento (venda/patrocínio multi-produto). Linhas
    // antigas/avulsas vêm null e seguem como comprovante de 1 item.
    carregamentoId: m.carregamentoId ?? null,
    // Agrupador dos ajustes de uma mesma aprovação de contagem (tarefa 5).
    // loteInferido=true → lote reconstruído por migração, sem contagemId
    // (não linka pra contagem nenhuma — não dá pra provar o vínculo).
    loteId: m.loteId ?? null,
    loteInferido: m.loteInferido ?? false,
    contagemId: m.contagemId ?? null,
    // Estorno (tarefa 6): `estornado` é derivado (ver acima), nunca lido de
    // um campo — não existe "estornadoPor" gravado em lugar nenhum.
    estornado: estorno !== null,
    estornoDeProtocolo: original ? (original.protocolo ?? original.chaveIdempotencia.slice(0, 8).toUpperCase()) : null,
    // Protocolo (tarefa 4 do adendo): campo próprio, nunca o _id interno
    // (RNF13). Registro anterior a este campo cai no cálculo antigo (8
    // chars da chaveIdempotencia) só pra nunca ficar em branco — a
    // migração migrarProtocoloLegado preenche todo mundo de verdade.
    protocolo: m.protocolo ?? m.chaveIdempotencia.slice(0, 8).toUpperCase(),
    // Número sequencial do comprovante (só carregamento tem — ver schema.ts).
    numeroComprovante: m.numeroComprovante ?? null,
  };
}

export const listar = query({
  args: {
    ...filtrosArgs,
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await exigirAdmin(ctx);

    const buscaProtocolo = args.protocolo?.trim().toUpperCase() || undefined;

    // Os filtros que não são o intervalo de data ficam num predicado só,
    // reaproveitado tanto na busca por protocolo (em memória — poucos
    // resultados) quanto na consulta paginada (em Convex .filter()).
    const contagemId = idContagem(ctx, args.contagemId);
    if (contagemId === null) return { page: [], isDone: true, continueCursor: "" };
    const filtros = { ...args, contagemId };
    const combina = (m: Doc<"movimentacoes">) => combinaFiltros(filtros, m);

    let page: Doc<"movimentacoes">[];
    let isDone: boolean;
    let continueCursor: string;

    if (buscaProtocolo) {
      const achados = await ctx.db
        .query("movimentacoes")
        .withIndex("by_protocolo", (q) => q.eq("protocolo", buscaProtocolo))
        .collect();
      page = achados.filter(combina);
      isDone = true;
      continueCursor = "";
    } else {
      // Período = DATA DO MOVIMENTO (RF65). O índice segue sendo
      // by_registrado_em: como registradoEm fica entre dataMovimento e
      // dataMovimento + FOLGA_RETROATIVA_MS, basta alargar o teto da busca e
      // conferir a data efetiva no .filter() logo abaixo.
      const ateRegistro = args.ate !== undefined ? args.ate + FOLGA_RETROATIVA_MS : undefined;
      let consulta = ctx.db
        .query("movimentacoes")
        .withIndex("by_registrado_em", (q) => {
          if (args.de !== undefined && ateRegistro !== undefined) {
            return q.gte("registradoEm", args.de).lte("registradoEm", ateRegistro);
          }
          if (args.de !== undefined) return q.gte("registradoEm", args.de);
          if (ateRegistro !== undefined) return q.lte("registradoEm", ateRegistro);
          return q;
        })
        .order("desc");

      if (args.de !== undefined || args.ate !== undefined || args.camaraId || args.produtoId || args.formatoId || args.tipo || args.operadorId || args.autorClerkId || contagemId) {
        consulta = consulta.filter((q) =>
          q.and(
            // dataEfetiva no filtro do Convex: dataMovimento quando existe,
            // senão registradoEm (lançamento anterior ao campo).
            ...(args.de !== undefined || args.ate !== undefined
              ? [
                  q.or(
                    q.and(
                      q.neq(q.field("dataMovimento"), undefined),
                      ...(args.de !== undefined ? [q.gte(q.field("dataMovimento"), args.de)] : []),
                      ...(args.ate !== undefined ? [q.lte(q.field("dataMovimento"), args.ate)] : []),
                    ),
                    q.and(
                      q.eq(q.field("dataMovimento"), undefined),
                      ...(args.ate !== undefined ? [q.lte(q.field("registradoEm"), args.ate)] : []),
                    ),
                  ),
                ]
              : []),
            ...(args.camaraId ? [q.eq(q.field("camaraId"), args.camaraId)] : []),
            ...(args.produtoId ? [q.eq(q.field("produtoId"), args.produtoId)] : []),
            ...(args.formatoId ? [q.eq(q.field("formatoId"), args.formatoId)] : []),
            ...(args.tipo ? [q.eq(q.field("tipo"), args.tipo)] : []),
            ...(args.operadorId ? [q.eq(q.field("operadorId"), args.operadorId)] : []),
            ...(args.autorClerkId ? [q.eq(q.field("clerkId"), args.autorClerkId)] : []),
            ...(contagemId ? [q.eq(q.field("contagemId"), contagemId)] : []),
          ),
        );
      }

      const resultado = await consulta.paginate(args.paginationOpts);
      page = resultado.page;
      isDone = resultado.isDone;
      continueCursor = resultado.continueCursor;
    }

    const linhas = await Promise.all(page.map((m) => linhaDoHistorico(ctx, m)));

    return { page: linhas, isDone, continueCursor };
  },
});

/*
  Todas as linhas de um carregamento, para o comprovante. A lista é paginada
  em 100 linhas e um carregamento pode ficar cortado entre duas páginas — o
  comprovante reenviado ao cliente não pode sair faltando produto nem com o
  peso total errado, então ele lê o carregamento inteiro pelo índice.
*/
export const carregamento = query({
  args: { carregamentoId: v.string() },
  handler: async (ctx, { carregamentoId }) => {
    await exigirAdmin(ctx);
    const movs = await ctx.db
      .query("movimentacoes")
      .withIndex("by_carregamento", (q) => q.eq("carregamentoId", carregamentoId))
      .collect();
    return Promise.all(movs.map((m) => linhaDoHistorico(ctx, m)));
  },
});

/*
  Soma do recorte filtrado (faixa "Entradas · Saídas · Líquido" do Histórico).
  Mesmos filtros e mesmo critério de período de `listar`, mas sobre o recorte
  INTEIRO — não só as páginas que o Admin já carregou. Nada é guardado: é o
  ledger somado na hora da leitura (regra 1), como todo saldo do sistema.

  Peso soma entre formatos (regra 6: agregação entre formatos é por peso).
  Quantidade só volta quando o recorte inteiro é de UM formato de peso fixo —
  nunca soma pacote de um formato com pacote/unidade de outro.

  Estorno entra pelo próprio sinal (o estorno de uma venda é uma entrada), para
  a faixa bater linha a linha com a tabela; uma venda estornada se anula no
  líquido.

  Teto de leitura: um recorte sem período (ou com um período enorme) pode
  varrer o ledger inteiro. Acima de LIMITE_RESUMO linhas lidas por consulta a
  soma para e volta `incompleto: true` — a tela avisa em vez de mostrar um
  número errado. São no máximo duas consultas (período, depois produto/câmara),
  bem abaixo do teto de leitura de uma query do Convex.
*/
const LIMITE_RESUMO = 5000;

type Soma = {
  entradasKg: number;
  saidasKg: number;
  movimentacoes: number;
  // Quantidade por formato: entrada e saída separadas, para a faixa mostrar
  // as leituras quando só sobrar um formato.
  porFormato: Map<string, { entradas: number; saidas: number }>;
};
const somaVazia = (): Soma => ({ entradasKg: 0, saidasKg: 0, movimentacoes: 0, porFormato: new Map() });
function somar(soma: Soma, m: Doc<"movimentacoes">) {
  soma.movimentacoes++;
  if (m.sinal > 0) soma.entradasKg += m.pesoKg;
  else soma.saidasKg += m.pesoKg;
  const f = soma.porFormato.get(m.formatoId) ?? { entradas: 0, saidas: 0 };
  if (m.sinal > 0) f.entradas += m.quantidade;
  else f.saidas += m.quantidade;
  soma.porFormato.set(m.formatoId, f);
}

export const resumo = query({
  args: filtrosArgs,
  handler: async (ctx, args) => {
    await exigirAdmin(ctx);

    const buscaProtocolo = args.protocolo?.trim().toUpperCase() || undefined;
    const contagemId = idContagem(ctx, args.contagemId);
    const filtros = { ...args, contagemId: contagemId ?? undefined };
    // Período = data do movimento (RF65), igual a `listar`.
    const noPeriodo = (m: Doc<"movimentacoes">) => {
      const d = dataEfetiva(m);
      return (args.de === undefined || d >= args.de) && (args.ate === undefined || d <= args.ate);
    };
    const produto = args.produtoId ? await ctx.db.get(args.produtoId) : null;

    // Soma uma consulta até o teto; `null` = estourou e a soma não vale.
    async function somarConsulta(consulta: AsyncIterable<Doc<"movimentacoes">>): Promise<Soma | null> {
      const soma = somaVazia();
      let lidas = 0;
      for await (const m of consulta) {
        if (++lidas > LIMITE_RESUMO) return null;
        if (noPeriodo(m) && combinaFiltros(filtros, m)) somar(soma, m);
      }
      return soma;
    }

    /*
      Extrato: produto + formato, sem nenhum filtro que corte o ledger pela
      metade (tipo, autor, contagem, protocolo). É exatamente o recorte de
      saldoDoFormato (regra 6), então dá para dizer "começou em X, terminou em
      Y" — saldo antes do período + entradas − saídas. Tudo somado na leitura,
      nada guardado (regra 1). Lê o histórico inteiro do formato, como o
      próprio saldoDoFormato já faz em toda saída lançada.
    */
    const extratoPossivel =
      produto !== null &&
      args.formatoId !== undefined &&
      !args.tipo &&
      !args.operadorId &&
      !args.autorClerkId &&
      args.contagemId === undefined &&
      !buscaProtocolo &&
      (!args.camaraId || args.camaraId === produto.camaraId);

    let soma: Soma | null = somaVazia();
    let antes: { kg: number; qtd: number } | null = null;

    if (contagemId === null) {
      // Link com uma contagem que não existe: recorte vazio, soma zero.
    } else if (extratoPossivel && produto && args.formatoId) {
      const formatoId = args.formatoId;
      antes = { kg: 0, qtd: 0 };
      const movs = ctx.db
        .query("movimentacoes")
        .withIndex("by_produto_camara_formato", (q) =>
          q.eq("produtoId", produto._id).eq("camaraId", produto.camaraId).eq("formatoId", formatoId),
        );
      for await (const m of movs) {
        const d = dataEfetiva(m);
        if (args.de !== undefined && d < args.de) {
          antes.kg += m.sinal * m.pesoKg;
          antes.qtd += m.sinal * m.quantidade;
        } else if (args.ate === undefined || d <= args.ate) {
          somar(soma, m);
        }
      }
    } else if (buscaProtocolo) {
      // Protocolo ignora o período, igual a `listar`.
      const achados = await ctx.db
        .query("movimentacoes")
        .withIndex("by_protocolo", (q) => q.eq("protocolo", buscaProtocolo))
        .collect();
      for (const m of achados) if (combinaFiltros(filtros, m)) somar(soma, m);
    } else {
      const ateRegistro = args.ate !== undefined ? args.ate + FOLGA_RETROATIVA_MS : undefined;
      // Link de uma contagem sem período: o índice da contagem já é o recorte.
      const primeira =
        contagemId && args.de === undefined && args.ate === undefined
          ? ctx.db.query("movimentacoes").withIndex("by_contagem", (q) => q.eq("contagemId", contagemId))
          : ctx.db.query("movimentacoes").withIndex("by_registrado_em", (q) => {
              if (args.de !== undefined && ateRegistro !== undefined) {
                return q.gte("registradoEm", args.de).lte("registradoEm", ateRegistro);
              }
              if (args.de !== undefined) return q.gte("registradoEm", args.de);
              if (ateRegistro !== undefined) return q.lte("registradoEm", ateRegistro);
              return q;
            });
      soma = await somarConsulta(primeira);
      // O período inteiro da fábrica estourou o teto: com produto ou câmara
      // escolhidos, tenta de novo pelo índice deles — o histórico de um
      // produto ou de uma câmara costuma caber onde a fábrica toda não cabe.
      // É isto que faz valer o conselho da tela ("escolha câmara ou produto").
      if (soma === null && produto) {
        soma = await somarConsulta(
          ctx.db
            .query("movimentacoes")
            .withIndex("by_produto_camara", (q) => q.eq("produtoId", produto._id).eq("camaraId", produto.camaraId)),
        );
      } else if (soma === null && args.camaraId) {
        const camaraId = args.camaraId;
        soma = await somarConsulta(ctx.db.query("movimentacoes").withIndex("by_camara", (q) => q.eq("camaraId", camaraId)));
      }
    }

    // Soma de ponto flutuante: arredonda ao grama para "0,1 + 0,2" não virar
    // 0,30000000000000004 kg na tela.
    const g = (kg: number) => Math.round(kg * 1000) / 1000;
    if (soma === null) {
      return {
        entradasKg: 0,
        saidasKg: 0,
        liquidoKg: 0,
        movimentacoes: 0,
        quantidade: null,
        extrato: null,
        incompleto: true,
        // Diz à tela se escolher câmara/produto ainda ajudaria.
        podeEstreitar: !produto,
      };
    }

    // Quantidade só com um formato de peso fixo no recorte inteiro (regra 6).
    // No extrato o formato é o do filtro, mesmo que o período não tenha linha.
    let unidade: "pacote" | "unidade" | null = null;
    const idFormato = extratoPossivel ? args.formatoId : soma.porFormato.size === 1 ? [...soma.porFormato.keys()][0] : undefined;
    if (idFormato) {
      const formato = await ctx.db.get(idFormato as Doc<"formatos">["_id"]);
      if (formato && !formato.pesoVariavel) unidade = formato.unidadeContagem ?? "pacote";
    }
    const q = idFormato ? (soma.porFormato.get(idFormato) ?? { entradas: 0, saidas: 0 }) : null;
    const quantidade =
      unidade && q ? { entradas: q.entradas, saidas: q.saidas, liquido: q.entradas - q.saidas, unidadeContagem: unidade } : null;

    const liquidoKg = soma.entradasKg - soma.saidasKg;
    return {
      entradasKg: g(soma.entradasKg),
      saidasKg: g(soma.saidasKg),
      liquidoKg: g(liquidoKg),
      movimentacoes: soma.movimentacoes,
      quantidade,
      // Saldo antes do período e no fim dele — só no recorte de extrato.
      extrato: antes
        ? {
            antesKg: g(antes.kg),
            depoisKg: g(antes.kg + liquidoKg),
            antesQtd: unidade ? antes.qtd : null,
            depoisQtd: unidade && quantidade ? antes.qtd + quantidade.liquido : null,
          }
        : null,
      incompleto: false,
      podeEstreitar: false,
    };
  },
});

// Listas para preencher os seletores de filtro.
export const opcoesFiltro = query({
  args: {},
  handler: async (ctx) => {
    await exigirAdmin(ctx);
    const camaras = await ctx.db.query("camaras").collect();
    const produtos = await ctx.db.query("produtos").collect();
    const operadores = await ctx.db.query("operadores").collect();
    const admins = await ctx.db.query("usuarios").collect();
    // Inclui inativos: um formato desativado ainda tem lançamentos antigos.
    const formatos = await ctx.db.query("formatos").collect();
    return {
      camaras: camaras.map((c) => ({ _id: c._id, nome: c.nome })),
      produtos: produtos.map((p) => ({ _id: p._id, nome: p.nome, camaraId: p.camaraId })),
      formatos: formatos.map((f) => ({
        _id: f._id,
        produtoId: f.produtoId,
        nome: f.nome,
        pesoKg: f.pesoKg,
        pesoVariavel: f.pesoVariavel,
        unidadesPorPacote: f.unidadesPorPacote ?? null,
        ativo: f.ativo,
      })),
      operadores: operadores.map((o) => ({ _id: o._id, nome: o.nome })),
      // Filtro "Autor" lista pessoas reais (tarefa 3) — inclui inativos porque
      // lançamentos antigos de um Admin desativado continuam no Histórico.
      admins: admins.map((a) => ({ clerkId: a.clerkId, nome: a.nome })),
    };
  },
});
