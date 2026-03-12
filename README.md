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

## Endpoints da API

| Endpoint | Descrição |
|----------|-----------|
| `GET /saveDBVagas` | Baixa e salva todos os cargos do mapa em `vagasdb.json` |
| `GET /takeSalaryV2` | Busca salários (versão otimizada, salva em `vagawithurl.json`) |
| `GET /crawlCareers?limit=50` | Crawl completo com conexões de carreira (salva em `vagawithsalary.json`) |
| `GET /api/top-paths?n=10` | **Retorna os 10 melhores caminhos para maximizar ganhos** |
| `GET /api/top-jobs?n=10` | Top N cargos por salário (ranking simples) |
| `GET /api` | Lista todos os cargos brutos |

## Fluxo para obter os 10 melhores caminhos

1. **Salvar vagas**: `GET /saveDBVagas`
2. **Crawlear carreiras** (com conexões): `GET /crawlCareers?limit=100`
3. **Consultar top paths**: `GET /api/top-paths?n=10`

O parâmetro `limit` em `/crawlCareers` define quantos cargos processar. Valores maiores (ex: 200) geram análises mais completas, mas demoram mais.

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
