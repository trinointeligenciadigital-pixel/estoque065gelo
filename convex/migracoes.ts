import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { protocoloDe } from "./lib/protocolo";

/*
  Migrações do sprint P0 (auditoria). São internalMutation — só rodam via
  `npx convex run migracoes:<nome> '{"dryRun":false}'` (CLI/dashboard), nunca
  chamáveis do cliente. Idempotentes: rodar de novo não duplica nem reprocessa
  o que já foi migrado. dryRun:true por padrão — só conta e loga o que faria.
*/

// Tarefa 3: lançamentos gravados antes do campo `autorNome` existir ficam sem
// autor nominal no Histórico. Preenche:
//   - operador: nome ATUAL do operador vinculado (operadorId já identifica com
//     certeza quem foi — não é inferência, é a mesma pessoa que o Histórico já
//     mostra hoje, computada em tempo de leitura; aqui só vira snapshot).
//   - admin: rótulo genérico fixo. clerkId tecnicamente aponta para um admin
//     específico, mas a regra deste sprint é não inferir retroativamente quem
//     foi — o rótulo "Admin (registro anterior)" é deliberado, não uma
//     limitação técnica (ver docs/02-schema-convex.md, autorNome).
export const migrarAutorLegado = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;

    const todas = await ctx.db.query("movimentacoes").collect();
    const semAutor = todas.filter((m) => m.autorNome === undefined);

    let deOperador = 0;
    let deAdmin = 0;
    for (const m of semAutor) {
      let autorNome: string;
      if (m.registradoPorTipo === "operador") {
        const operador = m.operadorId ? await ctx.db.get(m.operadorId) : null;
        autorNome = operador?.nome ?? "Admin (registro anterior)";
        deOperador++;
      } else {
        autorNome = "Admin (registro anterior)";
        deAdmin++;
      }
      if (!dryRun) {
        await ctx.db.patch(m._id, { autorNome });
      }
    }

    return {
      dryRun,
      totalSemAutor: semAutor.length,
      migradosComoOperador: deOperador,
      migradosComoAdminGenerico: deAdmin,
    };
  },
});

// Tarefa 4: ajustes gravados antes do campo `motivoCategoria` existir. Marca
// como "nao_informado" — reservado à migração, nenhum código de escrita normal
// grava esse valor (a única origem de ajuste, gerarAjustesDaContagem, sempre
// grava "contagem"). Sem chute de qual seria o motivo real.
export const migrarMotivoAjusteLegado = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;

    const ajustes = await ctx.db
      .query("movimentacoes")
      .withIndex("by_tipo", (q) => q.eq("tipo", "ajuste"))
      .collect();
    const semMotivo = ajustes.filter((m) => m.motivoCategoria === undefined);

    if (!dryRun) {
      for (const m of semMotivo) {
        await ctx.db.patch(m._id, { motivoCategoria: "nao_informado" });
      }
    }

    return { dryRun, totalSemMotivo: semMotivo.length };
  },
});

// Adendo PWA, tarefa 2: o mesmo formato aparecia com grafias diferentes em
// telas diferentes ("Pacote 5,7kg" no Admin, "Pacote 30 unid" no PWA) porque o
// texto livre de `nome` misturava peso numa tela e contagem de unidades na
// outra — CADA UM SÓ EMBUTIA UMA DAS DUAS informações. Diagnóstico (rodado
// contra o banco antes de escrever esta migração): não existem dois registros
// de formato para a mesma embalagem — é um registro só, com um `nome` que
// nunca guardou as duas informações juntas. Esta migração:
//   - reconhece "<base> <peso>kg" (ex.: "Pacote 20kg") e "<base> <n> unid"
//     (ex.: "Pacote 30 unid") no nome atual;
//   - regrava `nome` só com a base ("Pacote"), sem peso nem contagem embutidos;
//   - preenche `unidadesPorPacote` quando o nome tinha uma contagem embutida.
// O rótulo mostrado ao usuário passa a ser montado sempre em código
// (rotuloFormato, src/lib/formato.ts): "{nome} {peso} kg · {un} un" — uma
// grafia só, em painel, PWA, comprovante e histórico. Formato que não bate com
// nenhum dos dois padrões fica INALTERADO e entra no relatório como "não
// reconhecido" — não adivinha.
const PADRAO_KG = /^(.*?)\s*(\d+(?:[.,]\d+)?)\s*kg\.?$/i;
const PADRAO_UNID = /^(.*?)\s*(\d+)\s*unid\.?$/i;

export const migrarRotuloFormato = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;

    const formatos = await ctx.db.query("formatos").collect();
    const log: {
      id: string;
      nomeAntes: string;
      nomeDepois: string;
      unidadesPorPacoteDepois: number | undefined;
      reconhecido: boolean;
    }[] = [];

    for (const f of formatos) {
      // Peso variável não tem peso fixo nem unidades por pacote embutíveis —
      // o nome já É o rótulo (ex.: "Granel"); não mexe.
      if (f.pesoVariavel) continue;

      const casaUnid = f.nome.match(PADRAO_UNID);
      const casaKg = casaUnid ? null : f.nome.match(PADRAO_KG);

      let nomeDepois = f.nome;
      let unidadesPorPacoteDepois = f.unidadesPorPacote;
      let reconhecido = false;

      if (casaUnid) {
        nomeDepois = casaUnid[1].trim() || "Pacote";
        unidadesPorPacoteDepois = Number(casaUnid[2]);
        reconhecido = true;
      } else if (casaKg) {
        nomeDepois = casaKg[1].trim() || "Pacote";
        reconhecido = true;
      }

      log.push({
        id: f._id,
        nomeAntes: f.nome,
        nomeDepois,
        unidadesPorPacoteDepois,
        reconhecido,
      });

      if (!dryRun && reconhecido) {
        await ctx.db.patch(f._id, { nome: nomeDepois, unidadesPorPacote: unidadesPorPacoteDepois });
      }
    }

    return {
      dryRun,
      totalFormatos: formatos.length,
      reconhecidos: log.filter((l) => l.reconhecido).length,
      naoReconhecidos: log.filter((l) => !l.reconhecido).map((l) => ({ id: l.id, nome: l.nomeAntes })),
      log,
    };
  },
});

// Correções Painel/Transferência, Tarefa 2: dois formatos ("Água de Coco" e
// "Tadala", 5,7kg) escaparam de migrarRotuloFormato acima porque o nome
// cadastrado era "Pacote 5,7" — sem o sufixo "kg" que aquele PADRAO_KG exige
// — então rotuloFormato (src/lib/formato.ts) concatenava o peso de novo:
// "Pacote 5,7 5,7 kg". Diagnóstico: (a) nome do formato cadastrado já embutia
// o peso; não é bug de template. Esta migração é mais estrita que a anterior
// de propósito: só reconhece o número final do nome quando ele bate EXATO
// (em "." ou ",") com o pesoKg já cadastrado NESTE formato — nunca um regex
// solto por "qualquer número no fim", que arriscaria cortar um nome legítimo
// que termine em número por outro motivo.
function sufixoPesoPropriodoFormato(nome: string, pesoKg: number): string | null {
  const alvo = nome.trim();
  const variantes = [String(pesoKg), String(pesoKg).replace(".", ",")];
  for (const v of variantes) {
    const sufixo = ` ${v}`;
    if (alvo.length > sufixo.length && alvo.endsWith(sufixo)) {
      const base = alvo.slice(0, -sufixo.length).trim();
      if (base) return base;
    }
  }
  return null;
}

export const migrarNomeFormatoPesoEmbutidoSemSufixo = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;

    const formatos = await ctx.db.query("formatos").collect();
    const log: { id: string; nomeAntes: string; nomeDepois: string }[] = [];

    for (const f of formatos) {
      if (f.pesoVariavel) continue; // peso variável não tem peso fixo embutível
      const nomeDepois = sufixoPesoPropriodoFormato(f.nome, f.pesoKg);
      if (nomeDepois === null) continue;
      log.push({ id: f._id, nomeAntes: f.nome, nomeDepois });
      if (!dryRun) {
        await ctx.db.patch(f._id, { nome: nomeDepois });
      }
    }

    return { dryRun, totalFormatos: formatos.length, corrigidos: log.length, log };
  },
});

// Tarefa 5: ajustes de contagem gravados antes do campo `loteId` existir saem
// soltos no Histórico — os 15 ajustes de uma mesma aprovação aparecem como 15
// linhas sem vínculo entre si. Agrupa por heurística: mesmo segundo + mesmo
// autor (clerkId, sempre admin — ajuste só nasce assim) + mesma câmara. NÃO
// atribui contagemId (não dá pra provar qual contagem gerou cada lote antigo);
// loteInferido:true marca esses lotes reconstruídos para o Histórico rotular
// como "Ajuste em lote (agrupamento inferido)", sem link para nenhuma contagem.
export const migrarLoteAjusteLegado = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;

    const ajustes = await ctx.db
      .query("movimentacoes")
      .withIndex("by_tipo", (q) => q.eq("tipo", "ajuste"))
      .collect();
    const semLote = ajustes.filter((m) => m.loteId === undefined);

    const grupos = new Map<string, typeof semLote>();
    for (const m of semLote) {
      const segundo = Math.floor(m.registradoEm / 1000);
      const chave = `${segundo}:${m.clerkId ?? "—"}:${m.camaraId}`;
      const grupo = grupos.get(chave) ?? [];
      grupo.push(m);
      grupos.set(chave, grupo);
    }

    if (!dryRun) {
      for (const grupo of grupos.values()) {
        const loteId = crypto.randomUUID();
        for (const m of grupo) {
          await ctx.db.patch(m._id, { loteId, loteInferido: true });
        }
      }
    }

    return { dryRun, totalSemLote: semLote.length, lotesReconstruidos: grupos.size };
  },
});

// Adendo PWA, tarefa 4: protocolo curto e legível em voz alta, agora um campo
// próprio (`movimentacoes.protocolo`) em vez de derivado na hora da leitura —
// derivar direto de chaveIdempotencia quebrava pra estorno ("estorno:<id>") e
// ajuste ("ajuste:<contagem>:<item>"), que não são UUID legível. Backfill dos
// lançamentos gravados antes deste campo existir:
//   - linha de carregamento (venda/patrocínio em lote): protocolo do GRUPO,
//     derivado do carregamentoId — todas as linhas do mesmo carregamento saem
//     com o mesmo protocolo, como um recibo só (mesma regra que os novos
//     lançamentos já seguem).
//   - ajuste com loteId: protocolo do lote, derivado do loteId — mesma lógica.
//   - estorno: chaveIdempotencia não é legível; gera um protocolo fresco,
//     próprio deste registro (não há grupo pra herdar).
//   - qualquer outro lançamento avulso: protocolo da própria chaveIdempotencia
//     (é um UUID real do cliente nesses casos — determinístico, legível).
export const migrarProtocoloLegado = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;

    const todas = await ctx.db.query("movimentacoes").collect();
    const semProtocolo = todas.filter((m) => m.protocolo === undefined);

    let deCarregamento = 0;
    let deLote = 0;
    let deEstorno = 0;
    let avulso = 0;
    for (const m of semProtocolo) {
      const protocolo =
        m.carregamentoId !== undefined
          ? (deCarregamento++, protocoloDe(m.carregamentoId))
          : m.loteId !== undefined
            ? (deLote++, protocoloDe(m.loteId))
            : m.tipo === "estorno"
              ? (deEstorno++, protocoloDe(crypto.randomUUID()))
              : (avulso++, protocoloDe(m.chaveIdempotencia));

      if (!dryRun) {
        await ctx.db.patch(m._id, { protocolo });
      }
    }

    return {
      dryRun,
      totalSemProtocolo: semProtocolo.length,
      deCarregamento,
      deLote,
      deEstorno,
      avulso,
    };
  },
});
