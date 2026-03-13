# Crawler Vagas e Salários

Crawler para capturar a relação de vagas e salários do país, com análise dos **10 melhores caminhos de carreira** para maximizar ganhos.

## Funcionalidades

- **Salvar vagas**: Busca todos os cargos do mapa de carreiras Vagas.com.br
- **Capturar salários**: Extrai faixas salariais (alto, médio, baixo) de cada cargo
- **Conexões de carreira**: Extrai ocupações anteriores e próximas (progressão natural)
- **Top 10 caminhos**: Identifica os melhores caminhos para maximizar ganhos com base em grafos de carreira

## Instalação

```bash
npm install
npm start
```

Acesse **http://localhost:3333** para usar o frontend com acompanhamento da análise em tempo real.

## Endpoints da API

| Endpoint | Descrição |
|----------|-----------|
| `GET /` | **Frontend** — Interface com progresso em tempo real |
| `GET /saveDBVagas` | Baixa e salva todos os cargos do mapa em `vagasdb.json` |
| `POST /api/crawl/start` | Inicia análise total em background (query: `?limit=0` = todos) |
| `GET /api/crawl/progress` | Retorna o progresso atual da análise |
| `GET /takeSalaryV2` | Busca salários (versão otimizada, salva em `vagawithurl.json`) |
| `GET /crawlCareers?limit=50` | Crawl síncrono (retrocompatibilidade) |
| `GET /api/top-paths?n=10` | **Retorna os 10 melhores caminhos para maximizar ganhos** |
| `POST /api/analyze-by-keywords` | Análise por keywords do currículo (body: `{ keywords: [...] }`) |
| `GET /api/top-jobs?n=10` | Top N cargos por salário (ranking simples) |
| `GET /api` | Lista todos os cargos brutos |

## Fluxo para obter os 10 melhores caminhos

1. Acesse **http://localhost:3333**
2. Clique em **Baixar cargos do mapa** (Etapa 1)
3. Clique em **Iniciar análise total** (Etapa 2)
4. Acompanhe o progresso em tempo real na barra e nos resultados ao final

Ou via API:
1. `GET /saveDBVagas`
2. `POST /api/crawl/start` (análise em background)
3. `GET /api/crawl/progress` (polling do progresso)
4. `GET /api/top-paths?n=10`

## Exemplo de resposta `/api/top-paths`

```json
{
  "fonte": "grafo_carreira",
  "topCaminhos": [
    {
      "rank": 1,
      "salarioFinal": 25000,
      "salarioFormatado": "R$ 25.000,00",
      "passos": 4,
      "caminho": [
        { "cargo": "Programador", "salarioAlto": 4500, "salarioFormatado": "R$ 4.500,00" },
        { "cargo": "Analista de Sistemas", "salarioAlto": 7500, "salarioFormatado": "R$ 7.500,00" },
        { "cargo": "Engenheiro de Software", "salarioAlto": 12000, "salarioFormatado": "R$ 12.000,00" },
        { "cargo": "Arquiteto de Software", "salarioAlto": 25000, "salarioFormatado": "R$ 25.000,00" }
      ]
    }
  ]
}
```

## Estrutura do projeto

```
├── lib/
│   ├── salaryParser.js      # Parser de salários (R$ 8.600,00 → número)
│   ├── careerPathAnalyzer.js # Engine de análise de grafos e top paths
│   └── careerCrawler.js     # Crawler com retry, rate limiting e conexões
├── server.js
├── vagasdb.json             # Cargos do mapa (gerado por /saveDBVagas)
├── vagawithurl.json         # Cargos + salários (takeSalaryV2)
└── vagawithsalary.json      # Cargos + salários + conexões (crawlCareers)
```
