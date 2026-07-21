# Graph Report - .  (2026-07-20)

## Corpus Check
- Large corpus: 500 files · ~699,208 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 472 nodes · 789 edges · 34 communities (25 shown, 9 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 13 edges (avg confidence: 0.83)
- Token cost: 88,851 input · 0 output

## Community Hubs (Navigation)
- Paginas do Admin
- Fluxos do Operador
- Dependencias do App
- Docs e Design System
- Painel e Graficos
- Dependencias de Build
- Shells e Roteamento
- Config TS (app)
- Operadores e PIN
- Config Vite/TS (node)
- Historico e Comprovantes
- Calculo de Saldo
- Contagens (backend)
- Lancamentos e Movimentacoes
- Cadastros Auxiliares
- Testes de Integracao
- Gestao de Administradores
- Auth e Autorizacao
- Produtos (backend)
- Camaras (backend)
- Usuarios (backend)
- Personas e Densidade
- Usuarios e Trava Clerk
- Tipos de Ambiente Vite
- TSConfig Raiz
- Cron Jobs
- Manutencao de Sessoes
- Regra: Sem-Sombra
- Regra: Sinal com Cor
- Regra: Voz Unica
- Regra: Tabela do Admin

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 17 edges
2. `compilerOptions` - 15 edges
3. `mensagemErro()` - 14 edges
4. `exigirAdmin()` - 13 edges
5. `dataHora()` - 12 edges
6. `TituloPagina()` - 12 edges
7. `Botao()` - 11 edges
8. `scripts` - 10 edges
9. `Tabela()` - 10 edges
10. `LinhaTabela()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `Estoque como livro-razão de movimentações` --semantically_similar_to--> `North Star: O livro-razão vivo`  [INFERRED] [semantically similar]
  PRODUCT.md → DESIGN.md
- `Estoque como livro-razão de movimentações` --semantically_similar_to--> `Princípio: ledger append-only`  [INFERRED] [semantically similar]
  PRODUCT.md → docs/02-schema-convex.md
- `Estoque como livro-razão de movimentações` --semantically_similar_to--> `Princípio: não existe campo saldo`  [INFERRED] [semantically similar]
  PRODUCT.md → docs/02-schema-convex.md
- `Design System: Estoque 065` --conceptually_related_to--> `PRODUCT.md — Definição de Produto`  [INFERRED]
  DESIGN.md → PRODUCT.md
- `Régua de nível (componente-assinatura)` --shares_data_with--> `pesoTotalDoProduto (agregação por peso)`  [INFERRED]
  DESIGN.md → docs/02-schema-convex.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Integridade do ledger (append-only, sem saldo, somado por formato)** — docs_02_schema_convex_movimentacoes, docs_02_schema_convex_ledger_append_only, docs_02_schema_convex_sem_campo_saldo, docs_02_schema_convex_saldodoformato [EXTRACTED 0.90]
- **Fluxo de contagem física por formato com aprovação** — docs_02_schema_convex_contagens, docs_02_schema_convex_contagemitens, docs_02_schema_convex_movimentacoes, docs_03_requisitos_contagem_as_cegas [EXTRACTED 0.85]
- **Acesso do operador via QR + PIN e sessão por câmara** — docs_02_schema_convex_camaras, docs_02_schema_convex_operadores, docs_02_schema_convex_sessoesoperador, docs_02_schema_convex_gerarpinoperador [EXTRACTED 0.85]

## Communities (34 total, 9 thin omitted)

### Community 0 - "Paginas do Admin"
Cohesion: 0.08
Nodes (48): AdministradoresPage(), Pendente, CamaraQrPage(), Camara, CamarasPage(), ContagensPage(), dataHoraOuTraco(), Detalhe() (+40 more)

### Community 1 - "Fluxos do Operador"
Cohesion: 0.12
Nodes (29): data(), ContagemFlow(), ListaFormatos(), ListaProdutos(), Passo, ProducaoFlow(), Patrocinio, RetornoFlow() (+21 more)

### Community 2 - "Dependencias do App"
Cohesion: 0.06
Nodes (35): @clerk/clerk-react, convex, @fontsource/ibm-plex-mono, @fontsource/inter, @fontsource/poppins, lucide-react, dependencies, @clerk/clerk-react (+27 more)

### Community 3 - "Docs e Design System"
Cohesion: 0.09
Nodes (34): CLAUDE.md — Instruções do Projeto Estoque 065, Design System: Estoque 065, North Star: O livro-razão vivo, A Regra do Número em Mono, A Regra do Rótulo-Mostrador, Régua de nível (componente-assinatura), PRD Estoque 065 (v2.1), Nota 8.1 — Transferência de produto entre câmaras (não implementada) (+26 more)

### Community 4 - "Painel e Graficos"
Cohesion: 0.08
Nodes (15): DIA_SEMANA, diaSemana(), fmtKg(), GraficoTendencia(), PAD, PontoTendencia, rotuloDia(), fmt() (+7 more)

### Community 5 - "Dependencias de Build"
Cohesion: 0.08
Nodes (25): convex-test, @edge-runtime/vm, npm-run-all2, devDependencies, convex-test, @edge-runtime/vm, npm-run-all2, tailwindcss (+17 more)

### Community 6 - "Shells e Roteamento"
Cohesion: 0.11
Nodes (12): AdminApp(), AdminShell(), App(), root, OperadorApp(), PinScreen(), SessaoOperador(), garantirBuffer() (+4 more)

### Community 7 - "Config TS (app)"
Cohesion: 0.09
Nodes (22): DOM, DOM.Iterable, ES2022, src, compilerOptions, allowImportingTsExtensions, jsx, lib (+14 more)

### Community 8 - "Operadores e PIN"
Cohesion: 0.13
Nodes (15): atualizar, criar, gerarPinOperador, listar, modules, bytesToHex(), derivar(), gerarPin() (+7 more)

### Community 9 - "Config Vite/TS (node)"
Cohesion: 0.11
Nodes (18): ES2023, vite.config.ts, compilerOptions, allowImportingTsExtensions, lib, module, moduleDetection, moduleResolution (+10 more)

### Community 10 - "Historico e Comprovantes"
Cohesion: 0.25
Nodes (14): ComprovanteModal(), fimDoDia(), HistoricoPage(), inicioDoDia(), num(), rotuloTipo, Tipo, DadosComprovante (+6 more)

### Community 11 - "Calculo de Saldo"
Cohesion: 0.16
Nodes (10): movimentoPorPeriodo, resumo, modules, pesoTotalDoProduto(), saldoDoFormato(), gridProdutos, minhasMovimentacoes, patrociniosAbertos (+2 more)

### Community 12 - "Contagens (backend)"
Cohesion: 0.17
Nodes (13): abrir, aprovar, detalhe, fechar, itensParaContagem, pendentes, rejeitar, contagemAtivaDaCamara() (+5 more)

### Community 13 - "Lancamentos e Movimentacoes"
Cohesion: 0.17
Nodes (9): lancarProducao, lancarSaida, produtosParaLancamento, exigirCamaraDoProduto(), movimentacaoExistente(), derivarQtdPeso(), lancarProducao, lancarRetorno (+1 more)

### Community 14 - "Cadastros Auxiliares"
Cohesion: 0.14
Nodes (10): atualizar, criar, listarPorProduto, listar, opcoesFiltro, listar, atualizar, criar (+2 more)

### Community 15 - "Testes de Integracao"
Cohesion: 0.17
Nodes (5): comoAdmin(), modules, setup(), modules, modules

### Community 16 - "Gestao de Administradores"
Cohesion: 0.18
Nodes (7): convidar, ConvitePendente, definirAtivo, listar, listarPendentes, Resultado, revogarConvite

### Community 17 - "Auth e Autorizacao"
Cohesion: 0.28
Nodes (7): AcaoOperador, exigirPermissao(), exigirSessaoOperador(), SessaoOperador, abrir, estado, fechar

### Community 18 - "Produtos (backend)"
Cohesion: 0.33
Nodes (5): atualizar, categoria, criar, listar, unidadeBase

### Community 19 - "Camaras (backend)"
Cohesion: 0.50
Nodes (3): atualizar, criar, listar

### Community 21 - "Personas e Densidade"
Cohesion: 0.67
Nodes (3): Dois modos de densidade numa só identidade, Persona: Admin (escritório), Persona: Colaborador (operação)

### Community 22 - "Usuarios e Trava Clerk"
Cohesion: 0.67
Nodes (3): Mutation interna garantirUsuario, Tabela usuarios (Admin/Clerk), Trancar cadastro público no Clerk (crítico)

## Knowledge Gaps
- **180 isolated node(s):** `listar`, `definirAtivo`, `Resultado`, `convidar`, `ConvitePendente` (+175 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `exigirAdmin()` connect `Cadastros Auxiliares` to `Operadores e PIN`, `Calculo de Saldo`, `Contagens (backend)`, `Lancamentos e Movimentacoes`, `Gestao de Administradores`, `Auth e Autorizacao`, `Produtos (backend)`, `Camaras (backend)`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Why does `mensagemErro()` connect `Paginas do Admin` to `Fluxos do Operador`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Why does `dataHora()` connect `Historico e Comprovantes` to `Paginas do Admin`, `Fluxos do Operador`, `Painel e Graficos`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **What connects `listar`, `definirAtivo`, `Resultado` to the rest of the system?**
  _180 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Paginas do Admin` be split into smaller, more focused modules?**
  _Cohesion score 0.08056265984654731 - nodes in this community are weakly interconnected._
- **Should `Fluxos do Operador` be split into smaller, more focused modules?**
  _Cohesion score 0.11875843454790823 - nodes in this community are weakly interconnected._
- **Should `Dependencias do App` be split into smaller, more focused modules?**
  _Cohesion score 0.05555555555555555 - nodes in this community are weakly interconnected._