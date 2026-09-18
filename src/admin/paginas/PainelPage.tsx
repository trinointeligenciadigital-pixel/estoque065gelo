import { Component, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Cartao, LinhaTabela, SelecaoInline, TituloPagina } from "../../shared/ui.tsx";
import { GraficoTendencia } from "../GraficoTendencia.tsx";
import { dataHora } from "../../lib/data.ts";
import { formatarContagem, formatarPeso, formatarQuantidade, rotuloFormato } from "../../lib/formato.ts";
import { mesmoTexto, nomesHomonimos, rotuloProduto } from "../../lib/produto.ts";
import { pluralizar } from "../../lib/plural.ts";
import { rotuloPlacaOuTexto } from "../../lib/mascaras.ts";

/*
  Painel do Admin (RF57–RF60) — "painel de instrumentos de câmara fria". KPIs em
  leitura de instrumento, produção de hoje, réguas de estoque por produto (peso,
  RF57) e saídas recentes. O badge de estoque mínimo é por formato (RF59).
*/
// "AAAA-MM-DD" da data de um dia do gráfico, no fuso de Cuiabá (o `dia` é a meia-
// noite local guardada em ms UTC). Usado para abrir o Histórico já filtrado.
const CUIABA_OFFSET_MS = -4 * 60 * 60 * 1000;
function ymdCuiaba(ms: number): string {
  const d = new Date(ms + CUIABA_OFFSET_MS);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}
const rotuloCat: Record<string, string> = {
  saborizado: "Saborizado",
  cubo: "Cubo",
  escamado: "Escamado",
};

export function PainelPage() {
  return (
    <LimiteErro>
      <PainelConteudo />
    </LimiteErro>
  );
}

function PainelConteudo() {
  const r = useQuery(api.admin.painel.resumo);
  const [soAbaixo, setSoAbaixo] = useState(false);
  const [dias, setDias] = useState(7);
  const mov = useQuery(api.admin.painel.movimentoPorPeriodo, { dias });
  // Destaque pacotes/kg do bloco "Estoque por produto" (correção "pacote
  // prevalece, quilo agrega") — muda qual unidade aparece grande na linha de
  // formato E a ordenação da lista. Padrão pacotes: é o que alguém separa.
  const [unidadeDestaque, setUnidadeDestaque] = useState<"pacotes" | "kg">("pacotes");
  // Filtro por câmara fria e por tipo de produto — só o bloco "Estoque por
  // produto"; os KPIs e o gráfico continuam somando a fábrica inteira, porque
  // é o número que responde "quanto tem, no total, agora".
  const [camaraFiltro, setCamaraFiltro] = useState("");
  const [categoriaFiltro, setCategoriaFiltro] = useState("");

  if (r === undefined) return <PainelSkeleton />;

  const rotuloPeriodo = dias === 1 ? "hoje" : `${dias} dias`;
  const t = mov?.totais;

  // Só produtos com nome repetido em OUTRA câmara precisam do sufixo de câmara
  // no rótulo — o resto já tem a categoria como tag ao lado (tarefa 6).
  const homonimos = nomesHomonimos(r.produtos);

  // Total de pacotes de um produto (soma só formatos de peso fixo) — usado
  // apenas para ordenar quando o destaque é "pacotes"; nunca é um número
  // mostrado, porque somar pacotes de tamanhos diferentes não tem significado.
  function totalPacotes(p: { formatos: { pesoVariavel: boolean; saldo: number }[] }): number {
    return p.formatos.reduce((acc, f) => acc + (f.pesoVariavel ? 0 : f.saldo), 0);
  }

  // Câmaras disponíveis pro filtro — direto dos produtos que já vieram no
  // resumo (evita uma query à parte só pra preencher um <select>).
  const camarasDisponiveis = [...new Map(r.produtos.map((p) => [p.camaraId, p.camaraNome])).entries()].sort(
    (a, b) => a[1].localeCompare(b[1]),
  );

  // Abaixo do mínimo primeiro — o que importa fica no topo da lista (que rola
  // por dentro quando há muitos produtos). Dentro disso, a ordem segue a
  // unidade em destaque.
  const produtos = r.produtos
    .filter((p) => (soAbaixo ? p.abaixoMinimo : true))
    .filter((p) => (camaraFiltro ? p.camaraId === camaraFiltro : true))
    .filter((p) => (categoriaFiltro ? p.categoria === categoriaFiltro : true))
    .slice()
    .sort((a, b) => {
      const abaixoDiff = Number(b.abaixoMinimo) - Number(a.abaixoMinimo);
      if (abaixoDiff !== 0) return abaixoDiff;
      return unidadeDestaque === "pacotes"
        ? totalPacotes(b) - totalPacotes(a)
        : b.pesoTotalKg - a.pesoTotalKg;
    });

  return (
    <>
      <TituloPagina
        titulo="Painel"
        subtitulo="065 Gelo · Cuiabá-MT"
        acao={
          r.qtdContagensPendentes > 0 ? (
            <Link
              to="/contagens"
              className="flex items-center gap-2.5 rounded-[10px] border border-acento bg-acento/5 px-3.5 py-2"
            >
              <span className="font-mono text-lg font-semibold text-acento">{r.qtdContagensPendentes}</span>
              <span className="text-[11.5px] leading-tight text-texto-suave">
                {r.qtdContagensPendentes === 1 ? "contagem" : "contagens"}
                <br />
                aguardando decisão
              </span>
            </Link>
          ) : undefined
        }
      />

      {/* Filtro de período — governa só os cartões de Movimento e o gráfico */}
      <div className="mb-3 flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
        <span className="text-[11.5px] text-texto-fraco">Movimento nos últimos:</span>
        <SegPeriodo dias={dias} onChange={setDias} />
      </div>

      {/* KPIs — Estado (agora) à esquerda, Movimento (período) à direita */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi rotulo="Estoque total" valor={formatarPeso(r.kpis.estoqueTotalKg)} rodape="soma por peso · agora" />
        <button
          onClick={() => r.qtdAbaixoMinimo > 0 && setSoAbaixo((v) => !v)}
          className={`flex flex-col gap-2.5 rounded-[10px] border p-4 text-left transition-colors ${
            r.qtdAbaixoMinimo > 0
              ? "border-alerta bg-alerta/5 hover:bg-alerta/10"
              : "cursor-default border-borda bg-superficie"
          }`}
        >
          <Eyebrow>Abaixo do mínimo</Eyebrow>
          <span className={`font-mono text-3xl leading-none font-semibold ${r.qtdAbaixoMinimo > 0 ? "text-alerta" : "text-texto"}`}>
            {r.qtdAbaixoMinimo}
            <span className="ml-1.5 font-sans text-xs font-medium text-texto-fraco">
              {r.qtdAbaixoMinimo === 1 ? "formato" : "formatos"}
            </span>
          </span>
          <span className={`text-[11.5px] ${r.qtdAbaixoMinimo > 0 ? "text-alerta" : "text-texto-fraco"}`}>
            {r.qtdAbaixoMinimo > 0 ? (soAbaixo ? "mostrando só estes ✓" : "ver quais →") : "tudo acima do mínimo"}
          </span>
        </button>
        <Kpi rotulo={`Produção · ${rotuloPeriodo}`} valor={t ? formatarPeso(t.producaoKg) : "—"} cor="text-entrada" rodape={t ? pluralizar(t.qtdLancamentos, "lançamento", "lançamentos") : "carregando…"} />
        <Kpi rotulo={`Saídas · ${rotuloPeriodo}`} valor={t ? formatarPeso(t.saidasKg) : "—"} rodape="venda · patrocínio · perda" />
      </div>

      {/* Por categoria (RF58) */}
      {r.porCategoria.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1.5 rounded-[10px] border border-borda bg-superficie px-4 py-3">
          <Eyebrow>Por categoria</Eyebrow>
          {r.porCategoria.map((c) => (
            <span key={c.categoria} className="text-[13px] text-texto">
              {rotuloCat[c.categoria] ?? c.categoria}{" "}
              <span className="font-mono font-semibold text-acento">
                {c.pacotes !== null
                  ? `${formatarContagem(c.pacotes, { pesoVariavel: false, unidadeContagem: c.unidadeContagem })} · ${formatarPeso(c.pesoKg)}`
                  : formatarPeso(c.pesoKg)}
              </span>
            </span>
          ))}
        </div>
      ) : null}

      {/* Tendência — Produção × Saídas por dia */}
      <Cartao className="mb-3 p-5">
        <PanelHead
          titulo="Tendência"
          extra={<span className="font-mono text-[11px] text-texto-fraco">Produção × Saídas · {rotuloPeriodo}</span>}
        />
        {mov === undefined ? (
          <div className="h-56 animate-pulse rounded-lg bg-superficie-fria motion-reduce:animate-none" />
        ) : (
          <GraficoTendencia
            serie={mov.serie}
            hrefDoDia={(dia) => `/historico?de=${ymdCuiaba(dia)}&ate=${ymdCuiaba(dia)}`}
          />
        )}
      </Cartao>

      <div className="mb-3 grid grid-cols-1 gap-3 lg:grid-cols-[1.25fr_1fr]">
        {/* Produção de hoje */}
        <Cartao className="p-5">
          <PanelHead titulo="Produção de hoje" extra={<Link to="/historico" className="text-xs font-medium text-acento">Ver histórico</Link>} />
          {r.producaoHoje.length === 0 ? (
            <Vazio>Nenhuma produção lançada hoje ainda. Aparece aqui assim que o chão de fábrica começar.</Vazio>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full min-w-[380px] text-sm">
              <thead>
                <Th cols={["Produto", "Colaborador", "Hora", "Qtd · Peso", ""]} />
              </thead>
              <tbody>
                {r.producaoHoje.map((m, i) => (
                  <LinhaTabela key={i}>
                    <td className="py-2.5 pr-3 text-texto">
                      {m.produtoNome} <span className="text-texto-fraco">· {rotuloFormato({ nome: m.formatoNome, pesoKg: m.formatoPesoKg, pesoVariavel: m.formatoPesoVariavel, unidadesPorPacote: m.formatoUnidadesPorPacote })}</span>
                    </td>
                    {/* Ênfase por peso, não por cor nova (DESIGN.md §3). */}
                    <td className="py-2.5 pr-3 font-medium text-texto">{m.autor}</td>
                    <td className="py-2.5 pr-3 font-mono text-xs text-texto-suave">{hora(m.registradoEm)}</td>
                    <td className="py-2.5 pr-3 text-right">
                      {m.formatoPesoVariavel ? (
                        <span className="font-mono text-texto">{formatarPeso(m.pesoKg)}</span>
                      ) : (
                        <div className="flex flex-col items-end leading-tight">
                          <span className="font-mono font-semibold text-texto">
                            {formatarQuantidade(m.quantidade, { pesoVariavel: false, unidadeContagem: m.formatoUnidadeContagem })}
                          </span>
                          <span className="font-mono text-[11px] text-texto-suave">{formatarPeso(m.pesoKg)}</span>
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 text-right"><Pill tom="entrada">entrada</Pill></td>
                  </LinhaTabela>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </Cartao>

        {/* Estoque por produto */}
        <Cartao className="p-5">
          {/* Filtro por câmara fria e por tipo de produto — só este bloco;
              os KPIs acima somam a fábrica inteira de propósito. */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-texto-fraco">Filtrar:</span>
            <SelecaoInline
              value={camaraFiltro}
              onChange={(e) => setCamaraFiltro(e.target.value)}
              className="!w-auto !min-w-[132px] !px-2 !py-1 !text-[11.5px]"
            >
              <option value="">Todas as câmaras</option>
              {camarasDisponiveis.map(([id, nome]) => (
                <option key={id} value={id}>{nome}</option>
              ))}
            </SelecaoInline>
            <SelecaoInline
              value={categoriaFiltro}
              onChange={(e) => setCategoriaFiltro(e.target.value)}
              className="!w-auto !min-w-[132px] !px-2 !py-1 !text-[11.5px]"
            >
              <option value="">Todos os tipos</option>
              {Object.entries(rotuloCat).map(([k, rot]) => (
                <option key={k} value={k}>{rot}</option>
              ))}
            </SelecaoInline>
            {camaraFiltro || categoriaFiltro ? (
              <button
                onClick={() => { setCamaraFiltro(""); setCategoriaFiltro(""); }}
                className="text-[11px] font-medium text-acento hover:text-acento-escuro"
              >
                Limpar
              </button>
            ) : null}
          </div>
          <PanelHead
            titulo="Estoque por produto"
            extra={
              <div className="flex items-center gap-2.5">
                <SegUnidade unidade={unidadeDestaque} onChange={setUnidadeDestaque} />
                <span className="font-mono text-[11px] text-texto-fraco">
                  {pluralizar(produtos.length, "produto", "produtos")} · ordenado por{" "}
                  {unidadeDestaque === "pacotes" ? "quantidade" : "peso"}
                </span>
              </div>
            }
          />
          {produtos.length === 0 ? (
            <Vazio>
              {camaraFiltro || categoriaFiltro
                ? "Nenhum produto para este filtro."
                : soAbaixo
                  ? "Nenhum formato abaixo do mínimo."
                  : "Nenhum produto ativo. Cadastre em Produtos."}
            </Vazio>
          ) : (
            <div className="flex max-h-[460px] flex-col gap-2.5 overflow-y-auto pr-1">
              {produtos.map((p) => (
                <div key={p._id} className={`rounded-lg p-3 ${p.abaixoMinimo ? "bg-alerta/5" : "bg-superficie-fria"}`}>
                  {(() => {
                    // Total do produto agrega formatos (tamanhos diferentes) por
                    // peso — nunca pacotes aqui quando há mais de um formato, mesma
                    // regra de "por categoria". Com um ÚNICO formato ativo (de peso
                    // fixo), não há o que agregar: o número principal acompanha a
                    // unidade escolhida no cabeçalho, como já acontece na linha do
                    // formato logo abaixo.
                    const unicoFormato = p.formatos.length === 1 && !p.formatos[0].pesoVariavel;
                    const mostrarPacotes = unicoFormato && unidadeDestaque === "pacotes";
                    const destaqueProduto = mostrarPacotes
                      ? formatarContagem(p.formatos[0].saldo, p.formatos[0])
                      : formatarPeso(p.pesoTotalKg);
                    // Tag de categoria só informa quando difere do nome do produto
                    // (ex.: "Escamado" categoria "escamado" não diz nada de novo;
                    // "Morango" categoria "saborizado" diz).
                    const tagRedundante = mesmoTexto(p.nome, p.categoria);
                    return (
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[13px] font-semibold text-texto">
                          {rotuloProduto(p.nome, p.camaraNome, homonimos.has(p.nome.trim().toLowerCase()))}
                          {tagRedundante ? null : (
                            <span className="ml-1.5 font-mono text-[10px] tracking-wide text-texto-fraco uppercase">{p.categoria}</span>
                          )}
                        </span>
                        <span className="flex items-baseline gap-1">
                          <span className="font-mono text-sm font-semibold text-texto">{destaqueProduto}</span>
                          {mostrarPacotes ? (
                            <span className="text-[10.5px] text-texto-fraco">· {formatarPeso(p.pesoTotalKg)}</span>
                          ) : null}
                        </span>
                      </div>
                    );
                  })()}
                  {p.formatos.length > 0 ? (
                    <div className="mt-2.5 flex flex-col gap-2">
                      {p.formatos.map((f) => {
                        // Destaque = a unidade escolhida no cabeçalho; peso variável
                        // não tem "pacote", então segue sempre em kg.
                        const mostrarPacotes = !f.pesoVariavel && unidadeDestaque === "pacotes";
                        const pesoSaldo = f.pesoVariavel ? f.saldo : f.saldo * f.pesoKg;
                        const destaque = mostrarPacotes ? formatarContagem(f.saldo, f) : formatarPeso(pesoSaldo);
                        const secundario = f.pesoVariavel
                          ? null
                          : mostrarPacotes
                            ? formatarPeso(pesoSaldo)
                            : formatarContagem(f.saldo, f);
                        const pesoMinimo = f.pesoVariavel ? f.estoqueMinimo : f.estoqueMinimo * f.pesoKg;
                        const minDestaque = mostrarPacotes ? formatarContagem(f.estoqueMinimo, f) : formatarPeso(pesoMinimo);
                        return (
                          <div key={f._id}>
                            <div className="flex items-baseline justify-between gap-2">
                              <span className={`text-[11px] ${f.abaixoMinimo ? "font-medium text-alerta" : "text-texto-suave"}`}>
                                {rotuloFormato(f)}
                              </span>
                              {f.estoqueMinimo > 0 ? (
                                <span className={`text-[11px] ${f.abaixoMinimo ? "text-alerta" : "text-texto-fraco"}`}>
                                  mín {minDestaque}
                                  {f.abaixoMinimo ? " ↓" : ""}
                                </span>
                              ) : (
                                <span className="text-[11px] text-texto-fraco">mín não definido</span>
                              )}
                            </div>
                            <div className="mt-0.5 flex items-baseline gap-1.5">
                              <span className={`font-mono text-sm font-semibold ${f.abaixoMinimo ? "text-alerta" : "text-texto"}`}>
                                {destaque}
                              </span>
                              {secundario ? (
                                <span className={`text-[10.5px] ${f.abaixoMinimo ? "text-alerta" : "text-texto-fraco"}`}>
                                  · {secundario}
                                </span>
                              ) : null}
                            </div>
                            {f.estoqueMinimo > 0 ? (
                              <BulletMinimo saldo={f.saldo} minimo={f.estoqueMinimo} abaixo={f.abaixoMinimo} />
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Cartao>
      </div>

      {/* Saídas recentes */}
      <Cartao className="p-5">
        <PanelHead titulo="Saídas recentes" extra={<Link to="/historico" className="text-xs font-medium text-acento">Ver expedição</Link>} />
        {r.saidasRecentes.length === 0 ? (
          <Vazio>Nenhuma saída registrada nos últimos dias.</Vazio>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <Th cols={["Cliente / motivo", "Produto", "Veículo", "Hora", "Qtd · Peso", ""]} />
            </thead>
            <tbody>
              {r.saidasRecentes.map((m, i) => (
                <LinhaTabela key={i}>
                  <td className="py-2.5 pr-3 text-texto">{m.clienteNome ?? (m.motivoPerda ? `perda: ${m.motivoPerda}` : "—")}</td>
                  <td className="py-2.5 pr-3 text-texto-suave">{m.produtoNome} <span className="text-texto-fraco">· {rotuloFormato({ nome: m.formatoNome, pesoKg: m.formatoPesoKg, pesoVariavel: m.formatoPesoVariavel, unidadesPorPacote: m.formatoUnidadesPorPacote })}</span></td>
                  <td className="py-2.5 pr-3 text-texto-suave">{veiculoRotulo(m)}</td>
                  <td className="py-2.5 pr-3 font-mono text-xs text-texto-suave">{hora(m.registradoEm)}</td>
                  <td className="py-2.5 pr-3 text-right">
                    {m.formatoPesoVariavel ? (
                      <span className="font-mono text-texto">{formatarPeso(m.pesoKg)}</span>
                    ) : (
                      <div className="flex flex-col items-end leading-tight">
                        <span className="font-mono font-semibold text-texto">
                          {formatarQuantidade(m.quantidade, { pesoVariavel: false, unidadeContagem: m.formatoUnidadeContagem })}
                        </span>
                        <span className="font-mono text-[11px] text-texto-suave">{formatarPeso(m.pesoKg)}</span>
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 text-right"><Pill tom={m.tipo === "patrocinio" ? "patroc" : m.tipo === "perda" ? "perda" : "venda"}>{rotuloTipo(m.tipo)}</Pill></td>
                </LinhaTabela>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Cartao>
    </>
  );
}

// hora curta no fuso de Cuiabá
function hora(ms: number): string {
  return dataHora(ms).split(" ")[1]?.slice(0, 5) ?? "";
}
function rotuloTipo(t: string): string {
  return t === "venda" ? "venda" : t === "patrocinio" ? "patrocínio" : "perda";
}

// Veículo próprio: placa. Terceiro: a identificação que o operador digitou,
// com o marcador "(terceiro)" — nunca o rótulo genérico "Terceiro" sozinho,
// que não dizia qual terceiro levou a carga. Terceiro escolhido sem texto
// (registro antigo ou campo deixado em branco) cai no aviso, em cor
// secundária — não é erro, é ausência de dado.
function veiculoRotulo(m: {
  veiculoPlaca: string | null;
  veiculoTerceiro: string | null;
  veiculoTerceiroModelo: string | null;
  motivoPerda: string | null;
}): ReactNode {
  if (m.veiculoPlaca) return m.veiculoPlaca;
  if (m.veiculoTerceiro) {
    const placa = rotuloPlacaOuTexto(m.veiculoTerceiro);
    return `${placa} (terceiro)${m.veiculoTerceiroModelo ? ` · ${m.veiculoTerceiroModelo}` : ""}`;
  }
  if (m.motivoPerda) return "—";
  return <span className="text-texto-fraco">Terceiro — não identificado</span>;
}

function SegPeriodo({ dias, onChange }: { dias: number; onChange: (d: number) => void }) {
  const ops = [
    { v: 1, l: "Hoje" },
    { v: 7, l: "7 dias" },
    { v: 30, l: "30 dias" },
  ];
  return (
    <div className="inline-flex rounded-lg border border-borda bg-superficie p-0.5">
      {ops.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          aria-pressed={dias === o.v}
          className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium transition outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento ${
            dias === o.v ? "bg-superficie-fria-2 text-acento" : "text-texto-suave hover:text-texto"
          }`}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

// Alternância pacotes/kg do bloco "Estoque por produto" — mesmo visual do
// SegPeriodo, versão com 2 opções.
function SegUnidade({ unidade, onChange }: { unidade: "pacotes" | "kg"; onChange: (u: "pacotes" | "kg") => void }) {
  const ops = [
    { v: "pacotes" as const, l: "Qtd." },
    { v: "kg" as const, l: "Kg" },
  ];
  return (
    <div className="inline-flex rounded-lg border border-borda bg-superficie p-0.5">
      {ops.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          aria-pressed={unidade === o.v}
          className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium transition outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento ${
            unidade === o.v ? "bg-superficie-fria-2 text-acento" : "text-texto-suave hover:text-texto"
          }`}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

// Barra de severidade "saldo vs mínimo" (RF59). O preenchimento (verde/vermelho)
// é o saldo; o traço escuro é o mínimo. Se o vermelho para antes do traço, está
// abaixo do mínimo — visível num relance. Escala própria de cada formato (as
// unidades diferem: pacotes × kg), então é comparação com o próprio limite.
function BulletMinimo({ saldo, minimo, abaixo }: { saldo: number; minimo: number; abaixo: boolean }) {
  const escala = Math.max(saldo, minimo) * 1.25 || 1;
  const wSaldo = Math.max(2, Math.min(100, (saldo / escala) * 100));
  const xMin = Math.min(100, (minimo / escala) * 100);
  return (
    <div className="relative mt-1 h-1.5 rounded-full bg-gelo-trilho">
      <div className={`h-full rounded-full ${abaixo ? "bg-alerta" : "bg-entrada"}`} style={{ width: `${wSaldo}%` }} />
      <div className="absolute -top-0.5 -bottom-0.5 w-0.5 rounded bg-texto" style={{ left: `${xMin}%` }} aria-hidden="true" />
    </div>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[10.5px] font-medium tracking-[0.11em] text-texto-fraco uppercase">{children}</span>;
}

function Kpi({ rotulo, valor, unidade, cor = "text-texto", rodape }: { rotulo: string; valor: string; unidade?: string; cor?: string; rodape: string }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-[10px] border border-borda bg-superficie p-4">
      <Eyebrow>{rotulo}</Eyebrow>
      <span className={`font-mono text-3xl leading-none font-semibold ${cor}`}>
        {valor}
        {unidade ? <span className="ml-1.5 font-sans text-xs font-medium text-texto-fraco">{unidade}</span> : null}
      </span>
      <span className="text-[11.5px] text-texto-fraco">{rodape}</span>
    </div>
  );
}

function PanelHead({ titulo, extra }: { titulo: string; extra?: ReactNode }) {
  return (
    <div className="mb-3.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
      <h2 className="font-titulo text-[15px] font-semibold tracking-[0.02em] text-texto uppercase">{titulo}</h2>
      {extra}
    </div>
  );
}

function Th({ cols }: { cols: string[] }) {
  return (
    <tr className="border-b border-borda text-left">
      {cols.map((c, i) => (
        <th key={i} className={`pb-2.5 pr-3 font-mono text-xs font-semibold tracking-[0.05em] whitespace-nowrap text-texto-suave uppercase ${i === cols.length - 2 ? "text-right" : "text-left"}`}>
          {c}
        </th>
      ))}
    </tr>
  );
}

function Pill({ children, tom }: { children: ReactNode; tom: "entrada" | "venda" | "patroc" | "perda" }) {
  const estilo = {
    entrada: "bg-entrada/10 text-entrada",
    venda: "border border-borda-forte text-texto-suave",
    patroc: "bg-acento/10 text-acento",
    perda: "bg-alerta/10 text-alerta",
  }[tom];
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${estilo}`}>{children}</span>;
}

function Vazio({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-[13px] text-texto-suave">{children}</p>;
}

// Limite de erro: se qualquer query do painel lançar (falha real, não só rede
// momentânea, que o Convex retenta sozinho), mostra um aviso com "Recarregar" no
// lugar do esqueleto eterno.
class LimiteErro extends Component<{ children: ReactNode }, { erro: boolean }> {
  state = { erro: false };
  static getDerivedStateFromError() {
    return { erro: true };
  }
  componentDidCatch(erro: unknown) {
    console.error("Painel — falha ao carregar:", erro);
  }
  render() {
    return this.state.erro ? <ErroPainel /> : this.props.children;
  }
}

function ErroPainel() {
  return (
    <>
      <TituloPagina titulo="Painel" subtitulo="065 Gelo · Cuiabá-MT" />
      <Cartao className="p-8">
        <div className="mx-auto max-w-sm text-center">
          <p className="font-titulo text-base font-semibold text-texto">Não foi possível carregar o painel</p>
          <p className="mt-1.5 text-[13px] text-texto-suave">
            Pode ser uma falha momentânea de conexão. Tente recarregar; se continuar, avise o suporte.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 inline-flex items-center justify-center rounded-lg bg-acento px-4 py-2 text-sm font-medium text-white transition outline-none hover:bg-acento-escuro focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"
          >
            Recarregar
          </button>
        </div>
      </Cartao>
    </>
  );
}

function PainelSkeleton() {
  return (
    <>
      <TituloPagina titulo="Painel" subtitulo="065 Gelo · Cuiabá-MT" />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[104px] animate-pulse rounded-[10px] border border-borda bg-superficie motion-reduce:animate-none" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.25fr_1fr]">
        <div className="h-64 animate-pulse rounded-lg border border-borda bg-superficie motion-reduce:animate-none" />
        <div className="h-64 animate-pulse rounded-lg border border-borda bg-superficie motion-reduce:animate-none" />
      </div>
    </>
  );
}
