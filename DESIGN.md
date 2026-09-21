---
name: Estoque 065
description: Sistema de design do PWA de controle de estoque da 065 Gelo — "O livro-razão vivo".
colors:
  fundo: "#eef3f4"
  superficie: "#ffffff"
  superficie-fria: "#e6edef"
  superficie-fria-2: "#dce6e8"
  acento: "#0e7c9c"
  acento-escuro: "#0b647f"
  texto: "#16232a"
  texto-suave: "#55666d"
  texto-fraco: "#6b757c"
  borda: "#d7e1e4"
  borda-forte: "#bfcdd1"
  gelo: "#54b7d2"
  gelo-trilho: "#cfdde0"
  entrada: "#2f7d52"
  entrada-texto: "#276b45"
  saida: "#b23a32"
  aviso: "#a9761e"
  aviso-texto: "#8a5f12"
  alerta: "#b23a32"
typography:
  display:
    fontFamily: "Poppins, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Poppins, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.05em"
  data:
    fontFamily: "Space Grotesk, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "normal"
rounded:
  sm: "4px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  full: "9999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.acento}"
    textColor: "{colors.superficie}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
    typography: "{typography.body}"
  button-primary-hover:
    backgroundColor: "{colors.acento-escuro}"
    textColor: "{colors.superficie}"
  button-neutral:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.texto}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  button-danger:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.alerta}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  button-large-operator:
    backgroundColor: "{colors.acento}"
    textColor: "{colors.superficie}"
    rounded: "{rounded.xl}"
    height: "56px"
    padding: "0 16px"
  input:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.texto}"
    rounded: "{rounded.sm}"
    padding: "6px 8px"
  card:
    backgroundColor: "{colors.superficie}"
    rounded: "{rounded.md}"
    padding: "20px"
  pill-active:
    backgroundColor: "{colors.entrada}"
    textColor: "{colors.entrada}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  kpi-tile:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.texto}"
    rounded: "{rounded.lg}"
    padding: "16px"
---

# Design System: Estoque 065

## 1. Overview

**Creative North Star: "O livro-razão vivo"**

O Estoque 065 se apresenta como um registro sempre atualizado e auditável — um livro-razão que respira. Cada número na tela é uma leitura exata, rastreável até a movimentação que a originou; a interface é a página bem editada desse livro. A confiança não vem de enfeite, vem da precisão: números em Space Grotesk com algarismos tabulares, alinhados como uma coluna contábil; superfícies claras e planas; nada compete com o dado. A paleta é derivada do **gelo — o produto — e não do interior escuro da câmara fria**: um azul-esverdeado claro de fundo, branco nas superfícies, um ciano-petróleo firme como única voz de ação.

São, na verdade, dois documentos no mesmo livro. As telas do **colaborador** são arejadas, de toque grande, para uso em pé na porta da câmara, com uma mão fria e com pressa — cada tela faz uma coisa e a faz óbvia. As telas do **Admin** são densas, de leitura rápida no desktop, com muita informação organizada por tela. A mesma linguagem serve aos dois em termos opostos: espaço para um, densidade para o outro, sem nunca trocar de identidade.

O sistema rejeita explicitamente quatro caras: o **ERP/planilha antigo** (cinza sufocante, botões minúsculos), o **SaaS genérico** (gradiente roxo, cartões idênticos em grade infinita), o **app colorido/lúdico** (cara de joguinho) e o **dashboard dark "gamer"** (preto com neon). É moderno, leve e amigável — mas sério, porque é uma ferramenta com dinheiro e operação em jogo.

**Key Characteristics:**
- O dado é o protagonista; tudo mais recua.
- Claro e plano — profundidade por tom e borda, nunca por sombra pesada.
- Uma única voz de ação (ciano-petróleo), usada com parcimônia.
- Números sempre em Space Grotesk tabular, alinhados como colunas de um razão; a Plex Mono fica com rótulos e códigos.
- Dois modos de densidade (colaborador arejado / Admin denso) numa só identidade.
- Movimento discreto e único — "o nível sobe": números contam, réguas enchem, curvas se erguem; sempre uma desaceleração suave, nunca mola nem quique.

## 2. Colors

Paleta clara de "câmara fria vista pelo gelo": neutros levemente azulados, um único acento de ação, e cores semânticas discretas que nunca gritam.

### Primary
- **Ciano-Petróleo** (`#0e7c9c`): a única voz de ação. Botões primários, links, dado-chave, item de menu ativo, régua de saldo em foco. Usado com parcimônia — sua raridade é o que o faz significar "aja aqui". O estado pressionado/hover escurece para **Petróleo Fundo** (`#0b647f`).

### Secondary
- **Gelo** (`#54b7d2`): o azul-frost das réguas de nível de estoque (as barras de saldo por produto). É o acento "físico" do gelo, distinto do acento de ação. Seu trilho é **Trilho de Gelo** (`#cfdde0`), o sulco vazio da régua.

### Tertiary (semânticas)
- **Verde Entrada** (`#2f7d52`): produção e retorno — tudo que soma ao estoque. Discreto, nunca vibrante.
- **Vermelho Saída** (`#b23a32`): venda, patrocínio, perda, divergência e alerta de estoque abaixo do mínimo — tudo que subtrai ou exige atenção crítica.
- **Âmbar Aviso** (`#a9761e`): atenção sem urgência (perto do mínimo). Só em preenchimento e borda — como texto dá 3,96:1 no branco (reprova AA). Para **texto** âmbar use **Âmbar Aviso Texto** (`#8a5f12`, 5,6:1).

### Neutral
- **Fundo Gelo-Claro** (`#eef3f4`): fundo geral do app.
- **Superfície** (`#ffffff`): cartões, tabelas, cabeçalhos.
- **Superfície Fria** (`#e6edef`) e **Superfície Fria 2** (`#dce6e8`): painéis recuados, realce de linha no hover, item de menu ativo. É assim que se cria profundidade — por tom, não por sombra.
- **Tinta** (`#16232a`): texto principal — cinza-azulado escuro, nunca preto puro.
- **Tinta Suave** (`#55666d`): texto secundário, rótulos de campo.
- **Tinta Fraca** (`#6b757c`): legendas, rótulos de mostrador, texto de terceiro nível. Escurecida a partir do `#869399` original para garantir contraste AA (4,5:1) sobre branco.
- **Borda** (`#d7e1e4`) e **Borda Forte** (`#bfcdd1`): divisores e contornos; a borda forte marca contornos de selo/pill discretos.

### Named Rules
**A Regra da Voz Única.** O ciano-petróleo `#0e7c9c` é ação, e só. Ele nunca é decoração. Numa tela cheia, ele aparece em poucos pontos — o botão que importa, o número que importa, o caminho ativo. Se ele estiver em todo lugar, perdeu o sentido.

**A Regra do Sinal Junto da Cor.** Entrada/saída, divergência e alerta jamais dependem só de verde/vermelho/âmbar. Sempre acompanham sinal (`+` / `−`), texto ("entrada", "abaixo do mínimo") ou seta. Cor é reforço, não a única mensagem.

## 3. Typography

**Display / Títulos:** Poppins (600/700), com fallback Inter → system-ui.
**Corpo:** Inter (400/500/600/700), com fallback system-ui → Segoe UI → Roboto.
**Números (dado):** Space Grotesk (500/600/700), com fallback Inter → system-ui.
**Rótulos e códigos:** IBM Plex Mono (400/500/600), com fallback ui-monospace → Consolas.

**Character:** um quarteto de contraste, não de semelhança. Poppins (geométrica, humana) dá o tom moderno e amigável dos títulos; Inter (neutra, legível) carrega o texto sem chamar atenção; Space Grotesk dá aos números um caráter geométrico e vivo — instrumento, não terminal; IBM Plex Mono, em versaletes, vira o rótulo de mostrador e o código/protocolo que emolduram o dado, dando a cara de "livro-razão".

### Hierarchy
- **Display** (Poppins 600, 1.25rem / 20px, `letter-spacing: -0.01em`): título de página no Admin. No colaborador, uma variante levemente menor (1.125rem) no cabeçalho da tela.
- **Title** (Poppins 600, 0.9375rem / 15px): cabeçalho de painel/cartão ("Produção de hoje", "Estoque por produto").
- **Body** (Inter 400, 0.875rem / 14px, `line-height: 1.5`): texto geral, células de tabela, descrições. Ênfase com peso 500/600, nunca com cor.
- **Label** (IBM Plex Mono 600, 0.75rem / 12px, `letter-spacing: 0.05em`, versalete): cabeçalho de tabela, "eyebrow" de KPI, rótulos de seção. É a assinatura tipográfica do sistema.
- **Micro-rótulo** (IBM Plex Mono 500/600, 0.625–0.6875rem / 10–11px, tracking largo, versalete): a mesma assinatura do Label, num espaço mais apertado onde 12px não cabe — crachá do operador no cabeçalho, "Passo N de M", eyebrow "Quantidade"/"Peso" do resumo de lançamento, cabeçalho de grupo de combobox. Continua Plex Mono/versalete/tracking; só o tamanho encolhe.
- **Degraus de tamanho permitidos** (em px): 10 · 11 · 12 · 13 · 14 · 15 (títulos de painel), mais o 28 do login. Nada de meio pixel (10,5 / 11,5 / 12,5 / 13,5 foram fundidos no degrau mais próximo em 2026-09). **Piso: 11px no colaborador** (celular sob sol forte, mono maiúsculo de 10px não se lê); 10px só no Admin denso e no comprovante denso.
- **Data** (Space Grotesk 600, até 1.875rem / 30px, `line-height: 1`, `font-variant-numeric: tabular-nums`): os números grandes de KPI e saldo. A unidade (kg, formatos) vem ao lado em Inter pequeno e fraco, para o número reinar sozinho.

### Named Rules
**A Regra do Número Vivo.** Todo número que é dado do negócio — peso, saldo, quantidade, PIN, hora, placa, divergência — é Space Grotesk, com `tabular-nums` pra continuar alinhando em coluna mesmo sem ser monoespaçada de verdade. Texto é Inter; número de dado é Space Grotesk. (Histórico: até 2026-09 essa regra usava IBM Plex Mono; trocado porque a mono sozinha, em todo número da tela, lia como terminal/planilha em vez de instrumento — ver "A Regra do Rótulo-Mostrador" logo abaixo pra onde a Plex Mono continua.)

**Código não é dado.** O protocolo (chave de idempotência, hex técnico) continua em IBM Plex Mono, junto com os rótulos — é carimbo de auditoria, não algo que a pessoa lê em voz alta. O número sequencial do comprovante (o "talão" que o cliente cita) é diferente: é um número de verdade que alguém vai falar/digitar, então segue a regra geral e vai em Space Grotesk.

**A Regra do Rótulo-Mostrador.** Rótulos de estrutura (cabeçalho de tabela, eyebrow de KPI, título de seção da nav) são Plex Mono em versalete com tracking. Eles emolduram o dado como o texto impresso ao redor de um mostrador — presentes, discretos, nunca protagonistas.

## 4. Elevation

O sistema é **plano por princípio**. Não há sombras decorativas — nenhuma. Profundidade e separação vêm de três recursos: **borda de 1px** (`#d7e1e4`), **camada tonal** (superfícies frias `#e6edef` / `#dce6e8` recuando do branco) e **espaçamento**. Um cartão é branco com borda fina sobre o fundo gelo-claro; um painel recuado é uma superfície fria dentro do cartão. O único "flutuante" real é o Modal, que escurece o fundo com um véu translúcido de tinta (`#16232a` a ~40%) em vez de projetar sombra.

### Named Rules
**A Regra do Sem-Sombra.** Superfícies são planas em repouso e planas em foco. Se você sentir vontade de adicionar `box-shadow` para "destacar", use borda, um tom de superfície fria, ou espaço. Sombra difusa cinza é a cara de app de 2014 e está proibida aqui. O único escurecimento permitido é o véu do modal.

## 5. Components

### Buttons
- **Shape:** cantos levemente arredondados (4px, `rounded-sm`) no Admin; bem arredondados (12px, `rounded-xl`) nas telas do colaborador.
- **Primary:** fundo ciano-petróleo (`#0e7c9c`), texto branco, `padding: 6px 12px`, texto 14px peso 500. É o botão que importa na tela.
- **Hover / Focus:** escurece para petróleo fundo (`#0b647f`) / leve `brightness(0.95)`; transição de ~150ms. Desabilitado a 50% de opacidade, cursor bloqueado.
- **Neutral:** borda `#d7e1e4`, fundo branco, texto tinta; hover preenche com fundo gelo-claro. É a ação secundária ("Editar", "Cancelar", "Ver QR").
- **Danger:** contorno vermelho (`#b23a32`), texto vermelho, fundo transparente; hover com leve lavagem vermelha a 5%. Só para ações destrutivas ("Rejeitar").
- **Grande (colaborador):** altura mínima **56px**, largura total, 12px de raio, texto 16px. Variantes cheias `entrada` (verde) e `saida` (vermelho) para os fluxos. Feedback tátil no `:active` (`brightness 0.95`).

### Chips / Pills
- **Etiqueta de status:** pill totalmente arredondada (`rounded-full`), 11px semibold. "Ativo" = lavagem verde a 10% com texto verde; "inativo" = contorno de borda forte com texto fraco (sem preenchimento, mais discreto).
- **Pill de tipo (tabelas):** entrada = verde a 10%; venda = contorno neutro; patrocínio = ciano a 10%; perda = vermelho a 10%. Sempre com o rótulo textual — a cor é reforço.

### Cards / Containers
- **Corner Style:** 8px (`rounded-lg`); KPIs e caixas de destaque a 10px (`rounded-[10px]`).
- **Background:** branco (`#ffffff`) sobre fundo gelo-claro; painéis internos em superfície fria (`#e6edef`).
- **Shadow Strategy:** nenhuma. Ver Elevation — borda de 1px `#d7e1e4`.
- **Internal Padding:** 20px (`p-5`) em cartões de painel; 16px (`p-4`) em KPIs e formulários.

### Inputs / Fields
- **Style:** borda `#d7e1e4`, fundo branco, 4px de raio, `padding: 6px 8px`. Rótulo acima em Plex/Inter pequeno tinta-suave.
- **Focus:** a borda muda para ciano-petróleo (`#0e7c9c`); sem glow, sem sombra. Campos de número (CNPJ, placa, quantidades) usam Space Grotesk tabular, como todo número de dado.
- **Disabled:** fundo gelo-claro, texto suave (ex.: campo de câmara fixa no produto, que nunca se edita).

### Navigation
- **Admin (desktop, ≥1024px):** barra lateral de 224px, branca, com a marca da 065 no topo e o crédito da Trino no rodapé. Item ativo = fundo superfície-fria-2 (`#dce6e8`), texto ciano, com um losango sólido de 7px de marca; inativo = texto tinta-suave, hover preenche com superfície fria. Seções ("Cadastros") são rótulos-mostrador em Plex versalete. Recolhível pelo próprio Admin (botão no rodapé da barra) para uma régua de ícones de 72px — rótulos viram tooltip; a preferência persiste no aparelho.
- **Admin (celular/tablet, <1024px):** a barra vira uma gaveta fora da tela, aberta por um botão de menu num cabeçalho fixo no topo. Um véu translúcido de tinta (`#16232a` a ~40%, mesmo tratamento do Modal) escurece o conteúdo atrás dela — a única elevação real do sistema fora do modal. Fecha ao navegar, ao tocar fora ou em Esc.
- **Colaborador:** sem nav persistente — um cabeçalho por tela com título e botão "‹ voltar" grande; a navegação é o próprio fluxo.

### Régua de nível (componente-assinatura)
A barra de saldo por formato no Painel: um trilho arredondado de gelo-trilho (`#cfdde0`, 6px de altura) preenchido em verde entrada (`#2f7d52`), com um traço escuro fino marcando o estoque mínimo; o preenchimento vira vermelho (`#b23a32`) quando o formato está abaixo do mínimo. Cada formato tem escala própria (pacotes ou kg), então a comparação é sempre com o próprio limite. É a tradução mais literal do North Star — o nível do estoque lido como um mostrador. Ao aparecer, enche da esquerda (800ms); quando o saldo muda ao vivo, corre até o novo nível (500ms); a marca do mínimo entra logo depois do preenchimento.

### Tabela (componente-assinatura)
A superfície de trabalho do Admin. Cabeçalho em rótulo-mostrador (Plex versalete 12px), linhas com divisor de 1px a 60% de opacidade, realce de linha no hover (superfície fria), colunas de número alinhadas à direita, estado vazio centralizado. Um só componente compartilhado governa todas as 10 telas do Admin.

### Gráfico de tendência (componente-assinatura)
Produção × Saídas por dia, desenhado à mão em SVG (sem biblioteca). Curvas suaves que nunca ultrapassam os dados (interpolação monótona — sem "barriga" nem valor abaixo de zero). Produção é verde entrada em traço contínuo; Saídas é vermelho saída em traço **tracejado** — o traço, não só a cor, distingue as séries. Sob cada linha há um véu da mesma cor que só some de cima para baixo (18% para Produção, 7% para Saídas, para as duas áreas não virarem lama onde se cruzam); é a única exceção ao "sem gradiente" do sistema, porque não troca de matiz nem decora. Guias horizontais tracejadas em `#d7e1e4` com o eixo Y arredondado para um número redondo. Interação: passar o mouse mostra o dia com os dois pesos; clicar fixa o balão e oferece o link para o Histórico daquele dia; a legenda liga e desliga cada série.

### Seletor segmentado
Dois ou três botões de largura igual dentro de uma pílula de 8px de raio com borda de 1px; um marcador em superfície fria 2 (`#dce6e8`) desliza sob a opção ativa (300ms), cujo texto fica ciano. Usado no período do Painel (Hoje / 7 dias / 30 dias) e na unidade do estoque (Qtd. / Kg).

### Movimento (assinatura)
Uma só ideia: **o nível sobe.** O que é dado entra como um mostrador lendo um valor — números contam até o valor, réguas enchem da esquerda, as curvas do gráfico se erguem da linha de base numa onda da esquerda para a direita, e o último dia recebe um único toque (um anel que se expande e some). Nada repete em laço e nada depende de sombra ou brilho.

- **Curva:** desaceleração forte, `cubic-bezier(0.16, 1, 0.3, 1)` em CSS; nos números e no gráfico, a mesma sensação por interpolação de quarta potência. Nunca mola, quique ou elástico.
- **Duração:** feedback de estado 100–300ms; entrada de blocos 500ms; réguas 800ms; contagem dos números 800ms (500ms quando o valor muda ao vivo); subida do gráfico 1s, com 150ms de espera. Sair é mais rápido que entrar.
- **Cascata:** os blocos do Painel entram em sequência curta (passo de 40ms, no máximo 6 passos); só as 6 primeiras linhas de tabela entram em sequência (passo de 30ms). O total nunca passa de ~750ms — o Admin volta várias vezes ao dia e não espera coreografia.
- **Só na chegada:** animação de entrada roda uma vez, na montagem — trocar filtro ou ordenar não recomeça a cascata. O gráfico recomeça a subir só quando o período muda. Entradas usam preenchimento `backwards` (nunca `both`), para não deixar contexto de empilhamento pendurado e cobrir o menu de seleção do vizinho.
- **Ao vivo:** quando um lançamento chega com o Painel aberto, os números e réguas correm do valor antigo ao novo; o gráfico reescala com transição (onde o navegador anima o caminho).
- **Mais leve, nunca zero:** sob `prefers-reduced-motion`, tudo aparece já no lugar (sem espera, sem contagem, sem subida); o estado e a informação continuam idênticos. O leitor de tela recebe só o valor final dos números.

**A Regra do Nível que Sobe.** Movimento serve para mostrar que um dado chegou ou mudou, ou para explicar uma relação (o cursor que desliza entre dias, o marcador que muda de opção). Se uma animação não faz nenhuma das duas, é decoração e não entra. Este bloco descreve o Painel do Admin; as telas do colaborador têm as próprias animações de entrada e de feedback de toque.

## 6. Do's and Don'ts

### Do:
- **Do** usar Space Grotesk em **todo** número de dado (peso, saldo, quantidade, hora, PIN, placa, divergência), com `tabular-nums`. Texto é Inter; protocolo/comprovante continuam em Plex Mono, como código.
- **Do** reservar o ciano-petróleo (`#0e7c9c`) para ação — a Regra da Voz Única. Poucos pontos por tela.
- **Do** criar profundidade com borda de 1px e superfícies frias tonais, nunca com sombra.
- **Do** acompanhar toda cor semântica (verde/vermelho/âmbar) de sinal, texto ou ícone — para daltonismo e para luz forte.
- **Do** manter 56px de alvo de toque nas telas do colaborador; arejado para uma mão fria com pressa.
- **Do** deixar o Admin denso — muita informação por tela é uma virtude ali, não um defeito.
- **Do** garantir contraste mínimo AA: texto corrido ≥ 4,5:1, números/rótulos grandes ≥ 3:1.
- **Do** animar só o que mostra chegada ou mudança de dado, com a curva de desaceleração única e sempre com um caminho para `prefers-reduced-motion`.
- **Do** distinguir séries de gráfico também pelo traço (contínuo × tracejado), nunca só pela cor.

### Don't:
- **Don't** parecer **ERP/planilha antigo**: nada de cinza sufocante, botões minúsculos ou tudo apertado. Densidade sim, aperto não.
- **Don't** parecer **SaaS genérico**: proibido gradiente (especialmente roxo), grade infinita de cartões idênticos, decoração vazia. A única exceção é o véu de área do gráfico de tendência (mesma cor, só some de cima para baixo).
- **Don't** parecer **app colorido/lúdico**: sem cores vibrantes, ícones grandes coloridos ou cara de joguinho. É ferramenta de trabalho.
- **Don't** parecer **dashboard dark "gamer"**: sem fundo preto, sem neon. O tema é claro, derivado do gelo.
- **Don't** usar `box-shadow` decorativa — a Regra do Sem-Sombra. Se parece um app de 2014, a sombra é o problema.
- **Don't** usar texto com gradiente (`background-clip: text`), borda lateral colorida > 1px como faixa, ou glassmorphism decorativo.
- **Don't** espalhar o ciano-petróleo como cor de preenchimento genérica; ele deixa de significar "aja aqui".
- **Don't** usar mola, quique, elástico nem animação em laço; nada pisca ou pulsa para chamar atenção. O movimento acontece uma vez, na chegada do dado.
- **Don't** fazer o Admin esperar: entrada de tela nunca passa de ~750ms no total, e o dado já é legível antes de a animação terminar.
- **Don't** expor `_id` interno ou jargão técnico/código de erro ao usuário final.
