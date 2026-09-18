import {
  cabecalhoEmpresaEstruturado,
  linhasContexto,
  rotuloNumeroComprovante,
  SELO_NAO_FISCAL,
  totalContagemComprovante,
  type DadosComprovante,
} from "../lib/comprovante.ts";
import { dataHoraComprovante } from "../lib/data.ts";
import { formatarContagem, formatarPeso, nomeUnidade } from "../lib/formato.ts";

/*
  Corpo visual do comprovante de saída — compartilhado entre a tela de sucesso
  do operador (SaidaFlow, arejado/toque grande) e o modal de reenvio do Admin
  (HistoricoPage, denso). Estrutura e ordem das seções são as mesmas nos dois;
  `denso` só escolhe a escala tipográfica de cada um.

  Os itens carregados ganham uma faixa de rótulo própria ("Itens carregados")
  com fundo tonal e o nome do produto em negrito — é a seção que quem recebe o
  comprovante (cliente, motorista) precisa achar primeiro, e antes ela tinha a
  mesma aparência que o cabeçalho da empresa e o bloco de contexto ao redor.
*/
export function ComprovanteCartao({ dados, denso = false }: { dados: DadosComprovante; denso?: boolean }) {
  const contexto = linhasContexto(dados);
  const contagem = totalContagemComprovante(dados);
  const empresa = dados.empresa;
  const cabecalho = cabecalhoEmpresaEstruturado(empresa);

  const pad = denso ? "px-3" : "px-4";
  const padY = denso ? "py-1.5" : "py-2.5";
  const headPadY = denso ? "py-2.5" : "py-3";
  const nome = denso ? "text-sm" : "text-base";
  const meta = denso ? "text-xs" : "text-sm";
  const qtd = denso ? "text-sm" : "text-base";
  const total = denso ? "text-xl" : "text-2xl";
  const eyebrow = denso ? "text-[10px]" : "text-[11px]";
  const selo = denso ? "text-[10.5px]" : "text-[11px]";
  const logo = denso ? "h-9 w-9" : "h-10 w-10";

  return (
    <div className={`overflow-hidden ${denso ? "rounded-lg" : "rounded-xl"} border border-borda bg-superficie`}>
      {/* De quem → pra quem → o quê (tarefa 7), em quatro blocos fixos que nunca
          truncam — o único documento que sai da empresa e chega ao cliente por
          WhatsApp não pode chegar anônimo, nem cortado no telefone. */}
      {cabecalho.nome ? (
        <div className={`flex items-start gap-2.5 border-b border-borda ${pad} ${headPadY}`}>
          {empresa?.logoUrl ? (
            <img src={empresa.logoUrl} alt="" className={`${logo} shrink-0 rounded object-contain`} />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className={`${nome} font-medium text-texto`}>{cabecalho.nome}</p>
            {cabecalho.linhaCnpj ? <p className={`mt-0.5 ${meta} text-texto-suave`}>{cabecalho.linhaCnpj}</p> : null}
            {cabecalho.endereco ? <p className={`${meta} text-texto-suave`}>{cabecalho.endereco}</p> : null}
            {cabecalho.linhaContato ? <p className={`${meta} text-texto-suave`}>{cabecalho.linhaContato}</p> : null}
          </div>
        </div>
      ) : null}

      <div className={`border-b border-borda ${pad} ${denso ? "py-2" : "py-3"}`}>
        <div className="flex items-baseline justify-between gap-3">
          <div className={`font-mono ${eyebrow} font-medium tracking-[0.1em] text-texto-fraco uppercase`}>
            Comprovante de saída
          </div>
          {/* Número sequencial (talão) — a referência que quem recebe o
              documento usa pra citar ESTE comprovante; o protocolo hex no
              rodapé continua existindo, mas é o técnico, não o humano. */}
          {dados.numeroComprovante !== null ? (
            <span className={`font-numero ${denso ? "text-sm" : "text-base"} font-semibold text-acento`}>
              {rotuloNumeroComprovante(dados.numeroComprovante)}
            </span>
          ) : null}
        </div>
        <div className={`mt-0.5 ${denso ? "text-sm" : "text-base"} font-semibold text-texto`}>
          {dados.rotulo} <span className={`font-numero ${meta} font-normal text-texto-suave`}>{dataHoraComprovante(dados.quandoMs)}</span>
        </div>
      </div>

      {/* Itens carregados — faixa de rótulo tonal separa este bloco do resto,
          e o produto (não mais o formato) é o texto mais forte da linha. */}
      <div className="border-b border-borda">
        <div className={`bg-superficie-fria ${pad} py-1 font-mono ${eyebrow} font-semibold tracking-[0.1em] text-texto-suave uppercase`}>
          Itens carregados
        </div>
        {dados.itens.map((it, i) => (
          <div key={i} className={`flex items-start justify-between gap-3 border-t border-borda/60 ${pad} ${padY} first:border-t-0`}>
            <div className="min-w-0 flex-1">
              <p className={`truncate ${nome} font-semibold text-texto`}>{it.produtoNome}</p>
              <p className={`truncate ${meta} text-texto-suave`}>{it.formatoNome}</p>
            </div>
            <div className="shrink-0 text-right whitespace-nowrap">
              {it.quantidadePacotes !== null ? (
                <>
                  <p className={`font-numero ${qtd} font-semibold text-texto`}>
                    {it.quantidadePacotes}
                    <span className={`ml-1 font-sans ${meta} font-normal text-texto-suave`}>
                      {nomeUnidade({ pesoVariavel: false, unidadeContagem: it.unidadeContagem }, it.quantidadePacotes)}
                    </span>
                  </p>
                  <p className={`font-numero ${meta} text-texto-suave`}>{formatarPeso(it.pesoKg)}</p>
                </>
              ) : (
                <p className={`font-numero ${qtd} font-semibold text-texto`}>{formatarPeso(it.pesoKg)}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className={`flex items-baseline justify-between gap-3 border-b border-borda bg-superficie-fria/40 ${pad} ${denso ? "py-2" : "py-3"}`}>
        <dt className={`${denso ? "text-sm" : "text-base"} font-medium text-texto`}>Total</dt>
        <dd className="text-right">
          {contagem !== null ? (
            <>
              <span className={`font-numero ${total} font-semibold text-texto`}>
                {formatarContagem(contagem.total, { pesoVariavel: false, unidadeContagem: contagem.modo })}
              </span>
              <span className={`ml-2 font-numero ${meta} text-texto-suave`}>{formatarPeso(dados.pesoTotalKg)}</span>
            </>
          ) : (
            <span className={`font-numero ${total} font-semibold text-texto`}>{formatarPeso(dados.pesoTotalKg)}</span>
          )}
        </dd>
      </div>

      <dl>
        {contexto.map((l, i) => (
          <div key={i} className={`flex items-baseline justify-between gap-3 border-b border-borda/60 ${pad} ${padY} last:border-0`}>
            <dt className={`min-w-0 flex-1 ${denso ? "text-sm" : "text-base"} text-texto-suave`}>{l.rotulo}</dt>
            {/* min-w-0 (sem shrink-0): cliente/veículo/motorista são texto livre,
                sem limite de caracteres — sem isto, um nome comprido estourava a
                largura do cartão em vez de quebrar linha. */}
            <dd className={`min-w-0 text-right break-words ${denso ? "text-sm" : "text-base"} text-texto ${l.mono ? "font-numero" : ""}`}>{l.valor}</dd>
          </div>
        ))}
      </dl>
      <div className={`flex items-center justify-between border-t border-borda ${pad} ${padY}`}>
        <span className={`font-mono ${eyebrow} font-medium tracking-[0.1em] text-texto-fraco uppercase`}>Protocolo</span>
        <span className={`font-mono ${denso ? "text-sm" : "text-base"} text-texto`}>{dados.protocolo}</span>
      </div>
      <p className={`border-t border-borda ${pad} ${padY} text-center ${selo} text-texto-fraco`}>{SELO_NAO_FISCAL}</p>
    </div>
  );
}
