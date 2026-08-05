import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

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
