const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const app = express();

const axios = require('axios');
const cheerio = require('cheerio');

const { parseSalaryToNumber, formatSalary } = require('./lib/salaryParser');
const { findTopCareerPaths, findTopJobsBySalary, analyzeByKeywords, findCareerPaths, suggestJobTitles } = require('./lib/careerPathAnalyzer');
const { crawlAllCareers, crawlLegacyFormat } = require('./lib/careerCrawler');

const CONFIG = {
  port: process.env.PORT || 3333,
  dataDir: __dirname
};

let crawlState = {
  status: 'idle',
  current: 0,
  total: 0,
  currentJob: null,
  lastUpdate: null,
  error: null,
  topPaths: null
};

const config = { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } };

app.use(cors());
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Credentials', true);
  next();
});

app.listen(CONFIG.port, () => {
  console.log(`Server running on port ${CONFIG.port}`);
});

function tryReadJson(file) {
  try {
    const raw = fs.readFileSync(path.join(CONFIG.dataDir, file), 'utf8');
    return JSON.parse(raw);
  } catch { return null; }
}

function fileExists(file) {
  try {
    return fs.existsSync(path.join(CONFIG.dataDir, file));
  } catch { return false; }
}

// --- STATUS DAS ETAPAS (independentes) ---
app.get('/api/status', (req, res) => {
  const vagasdb = fileExists('vagasdb.json');
  const vagawithsalary = fileExists('vagawithsalary.json');
  const vagawithurl = fileExists('vagawithurl.json');
  let cargosCount = 0;
  let salaryCount = 0;
  if (vagasdb) {
    const d = tryReadJson('vagasdb.json');
    cargosCount = Array.isArray(d) ? d.filter(r => r && r[0]).length : 0;
  }
  if (vagawithsalary) {
    const d = tryReadJson('vagawithsalary.json');
    salaryCount = Array.isArray(d) ? d.length : 0;
  } else if (vagawithurl) {
    const d = tryReadJson('vagawithurl.json');
    salaryCount = Array.isArray(d) ? d.length : 0;
  }
  res.json({
    etapa1Ok: vagasdb && cargosCount > 0,
    cargosCount,
    etapa2Ok: salaryCount > 0,
    salaryCount
  });
});

// --- DADOS BRUTOS ---
app.get('/api', (req, res) => {
  const filePath = path.join(CONFIG.dataDir, 'vagasdb.json');
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) return res.status(500).json({ status: 'falha', resultado: err.message });
    try {
      res.json(JSON.parse(data));
    } catch (e) {
      res.status(500).json({ status: 'falha', resultado: e.message });
    }
  });
});

// --- SALVAR VAGAS DO MAPA ---
app.get('/saveDBVagas', (req, res) => {
  axios.get('https://www.vagas.com.br/mapa-de-carreiras/api/mapa', config)
    .then(response => {
      const cargos = response.data?.cargos || [];
      if (cargos.length > 0) cargos.shift();
      const filePath = path.join(CONFIG.dataDir, 'vagasdb.json');
      fs.writeFileSync(filePath, JSON.stringify(cargos));
      res.json({ status: 'sucesso', resultado: `${cargos.length} cargos salvos` });
    })
    .catch(err => res.status(500).json({ status: 'falha', resultado: err.message }));
});

// --- BUSCAR SALÁRIOS (versão legada) ---
app.get('/takeSalary', async (req, res) => {
  try {
    const data = await fs.promises.readFile(path.join(CONFIG.dataDir, 'vagasdb.json'), 'utf8');
    const obj = JSON.parse(data);
    const returnObj = [];
    for (const role of obj) {
      if (!role) continue;
      try {
        const r1 = await axios.get(`https://www.vagas.com.br/mapa-de-carreiras/servico/cargos/${role[0]}`, config);
        const $1 = cheerio.load(r1.data);
        let paginationURL = '';
        $1('.mobileButton').each((_, el) => { paginationURL = $1(el).attr('href') || paginationURL; });
        const orderData = paginationURL
          ? `https://www.vagas.com.br/mapa-de-carreiras/servico/${paginationURL.replace(/^\//, '')}`
          : `https://www.vagas.com.br/mapa-de-carreiras/servico/cargos/${role[0]}/0`;
        const r2 = await axios.get(orderData, config);
        const $2 = cheerio.load(r2.data);
        let salaryHigh = 'N/I', salaryAverage = 'N/I', salaryLower = 'N/I';
        $2('.higher .money').each((_, el) => { salaryHigh = $2(el).html() || salaryHigh; });
        $2('.average .money').each((_, el) => { salaryAverage = $2(el).html() || salaryAverage; });
        $2('.lower .money').each((_, el) => { salaryLower = $2(el).html() || salaryLower; });
        role.push(salaryHigh, salaryAverage, salaryLower, orderData);
        returnObj.push(role);
        await new Promise(r => setTimeout(r, 500));
      } catch (e) {
        console.error(`Erro em ${role[0]}:`, e.message);
      }
    }
    fs.writeFileSync(path.join(CONFIG.dataDir, 'vagawithurl.json'), JSON.stringify(returnObj));
    res.json({ ok: 'ok', total: returnObj.length });
  } catch (err) {
    res.status(500).json({ nok: 'nok', erro: err.message });
  }
});

// --- BUSCAR SALÁRIOS + CONEXÕES DE CARREIRA (versão avançada) ---
app.get('/takeSalaryV2', async (req, res) => {
  try {
    const data = await fs.promises.readFile(path.join(CONFIG.dataDir, 'vagasdb.json'), 'utf8');
    const obj = JSON.parse(data);
    const limit = parseInt(req.query.limit, 10) || 0;
    const results = await crawlLegacyFormat(obj, { limit: limit || undefined });
    fs.writeFileSync(path.join(CONFIG.dataDir, 'vagawithurl.json'), JSON.stringify(results));
    res.json({ ok: 'ok', total: results.length });
  } catch (err) {
    res.status(500).json({ nok: 'nok', erro: err.message });
  }
});

// --- INICIAR ANÁLISE TOTAL (background) ---
app.post('/api/crawl/start', async (req, res) => {
  if (crawlState.status === 'running') {
    return res.json({ ok: false, mensagem: 'Análise já em andamento' });
  }
  const limit = parseInt(req.query.limit || req.body?.limit, 10) || 0;

  let total = 0;
  try {
    const data = await fs.promises.readFile(path.join(CONFIG.dataDir, 'vagasdb.json'), 'utf8');
    const obj = JSON.parse(data);
    total = limit > 0 ? obj.filter(r => r && r[0]).slice(0, limit).length : obj.filter(r => r && r[0]).length;
  } catch (e) {
    return res.status(400).json({ ok: false, mensagem: 'Execute /saveDBVagas primeiro para baixar os cargos.' });
  }

  crawlState = {
    status: 'running',
    current: 0,
    total,
    currentJob: null,
    lastUpdate: new Date().toISOString(),
    error: null,
    topPaths: null
  };

  (async () => {
    try {
      const data = await fs.promises.readFile(path.join(CONFIG.dataDir, 'vagasdb.json'), 'utf8');
      const obj = JSON.parse(data);

      const results = await crawlAllCareers(obj, {
        limit: limit || undefined,
        onProgress: (current, total, job) => {
          crawlState.current = current;
          crawlState.total = total;
          crawlState.currentJob = job ? { title: job.title, salaryHigh: job.salaryHigh } : null;
          crawlState.lastUpdate = new Date().toISOString();
          console.log(`[${current}/${total}] ${job?.title || '?'} - R$ ${job?.salaryHigh ?? 'N/I'}`);
        }
      });

      fs.writeFileSync(path.join(CONFIG.dataDir, 'vagawithsalary.json'), JSON.stringify(results, null, 2));
      const paths = findTopCareerPaths(results, 10);
      crawlState.status = 'done';
      crawlState.current = results.length;
      crawlState.currentJob = null;
      crawlState.topPaths = paths.map((p, i) => ({
        rank: i + 1,
        salarioFinal: p.finalSalary,
        salarioFormatado: formatSalary(p.finalSalary),
        passos: p.steps,
        caminho: p.path.map(n => ({ cargo: n.title, salarioAlto: n.salaryHigh }))
      }));
      crawlState.lastUpdate = new Date().toISOString();
    } catch (err) {
      crawlState.status = 'error';
      crawlState.error = err.message;
      crawlState.lastUpdate = new Date().toISOString();
      console.error('Erro no crawl:', err);
    }
  })();

  res.json({ ok: true, mensagem: 'Análise iniciada', total: crawlState.total });
});

// --- PROGRESSO DA ANÁLISE ---
app.get('/api/crawl/progress', (req, res) => {
  res.json(crawlState);
});

// --- CRAWL SÍNCRONO (retrocompatibilidade) ---
app.get('/crawlCareers', async (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  try {
    const data = await fs.promises.readFile(path.join(CONFIG.dataDir, 'vagasdb.json'), 'utf8');
    const obj = JSON.parse(data);
    const results = await crawlAllCareers(obj, {
      limit,
      onProgress: (current, total, job) => {
        console.log(`[${current}/${total}] ${job?.title || '?'} - R$ ${job?.salaryHigh ?? 'N/I'}`);
      }
    });
    fs.writeFileSync(path.join(CONFIG.dataDir, 'vagawithsalary.json'), JSON.stringify(results, null, 2));
    res.json({ ok: 'ok', total: results.length, arquivo: 'vagawithsalary.json' });
  } catch (err) {
    res.status(500).json({ nok: 'nok', erro: err.message });
  }
});

// --- TOP 10 CAMINHOS PARA MAXIMIZAR GANHOS ---
app.get('/api/top-paths', (req, res) => {
  const topN = Math.min(parseInt(req.query.n, 10) || 10, 50);
  const useSalary = req.query.source === 'salary';

  const tryRead = (file) => {
    try {
      return fs.readFileSync(path.join(CONFIG.dataDir, file), 'utf8');
    } catch { return null; }
  };

  let jobsData = null;
  let jobsWithConnections = [];

  if (useSalary) {
    const raw = tryRead('vagawithsalary.json');
    if (raw) {
      try {
        jobsWithConnections = JSON.parse(raw);
      } catch (e) { /* ignore */ }
    }
  } else {
    const raw = tryRead('vagawithsalary.json') || tryRead('vagawithurl.json');
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        jobsWithConnections = Array.isArray(parsed[0]) ? parsed.map(row => {
          const hasLegacyFormat = row.length >= 10 && (typeof row[7] === 'string' || row[7]?.includes?.('$'));
          return {
            id: row[0],
            title: row[1],
            slug: ((hasLegacyFormat ? row[10] : row[5]) || '').toString().match(/\/cargos\/([^/]+)/)?.[1] || row[0],
            salaryHigh: hasLegacyFormat ? row[7] : row[2],
            salaryAverage: hasLegacyFormat ? row[8] : row[3],
            salaryLower: hasLegacyFormat ? row[9] : row[4],
            url: hasLegacyFormat ? row[10] : row[5],
            previousOccupations: row[11] || row[6] || [],
            nextOccupations: row[12] || row[7] || []
          };
        }) : parsed;
      } catch (e) {
        jobsData = JSON.parse(raw);
      }
    }
  }

  if (jobsWithConnections.length === 0 && jobsData) {
    const topJobs = findTopJobsBySalary(jobsData, topN);
    return res.json({
      fonte: 'ranking_simples',
      mensagem: 'Execute /crawlCareers?limit=100 para obter caminhos completos de carreira.',
      topCaminhos: topJobs.map((j, i) => ({
        rank: i + 1,
        cargo: j.cargo,
        salarioAlto: j.salarioAlto,
        salarioFormatado: formatSalary(j.salarioAlto),
        passos: 1,
        caminho: [{ cargo: j.cargo, salarioAlto: j.salarioAlto }]
      }))
    });
  }

  const hasConnections = jobsWithConnections.some(j =>
    (j.previousOccupations && j.previousOccupations.length > 0) ||
    (j.nextOccupations && j.nextOccupations.length > 0)
  );

  if (!hasConnections) {
    const topJobs = findTopJobsBySalary(jobsWithConnections, topN);
    return res.json({
      fonte: 'ranking_simples',
      topCaminhos: topJobs.map((j, i) => ({
        rank: i + 1,
        cargo: j.cargo,
        salarioAlto: j.salarioAlto,
        salarioFormatado: formatSalary(j.salarioAlto),
        passos: 1,
        caminho: [{ cargo: j.cargo, salarioAlto: j.salarioAlto }]
      }))
    });
  }

  const paths = findTopCareerPaths(jobsWithConnections, topN);
  const topCaminhos = paths.map((p, i) => ({
    rank: i + 1,
    salarioFinal: p.finalSalary,
    salarioFormatado: formatSalary(p.finalSalary),
    passos: p.steps,
    caminho: p.path.map(n => ({
      cargo: n.title,
      salarioAlto: n.salaryHigh,
      salarioFormatado: formatSalary(n.salaryHigh)
    }))
  }));

  res.json({ fonte: 'grafo_carreira', topCaminhos });
});

// --- TOP N CARGOS POR SALÁRIO (simples) ---
app.get('/api/top-jobs', (req, res) => {
  const topN = Math.min(parseInt(req.query.n, 10) || 10, 100);
  const tryRead = (file) => {
    try {
      return fs.readFileSync(path.join(CONFIG.dataDir, file), 'utf8');
    } catch { return null; }
  };
  const raw = tryRead('vagawithsalary.json') || tryRead('vagawithurl.json') || tryRead('vagasdb.json');
  if (!raw) return res.status(404).json({ erro: 'Nenhum dado disponível. Execute /saveDBVagas e /crawlCareers primeiro.' });
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return res.status(500).json({ erro: 'Erro ao parsear JSON' });
  }
  const top = findTopJobsBySalary(data, topN);
  res.json({ topCargos: top });
});

// --- ANÁLISE POR KEYWORDS DO CURRÍCULO ---
const DEFAULT_KEYWORDS = [
  'Chief Technology Officer (CTO)', 'Head of IT', 'Diretor de Tecnologia', 'Gerente de TI Sênior',
  'IT Operations', 'Liderança de Equipes de TI', 'Liderança Técnica', 'Gestão de Equipes de Alta Performance',
  'Transformação Digital', 'Planejamento Estratégico de TI', 'Governança de TI', 'Gestão de Orçamento (CAPEX/OPEX)',
  'Gestão de Contratos de TI', 'Gestão de Fornecedores', 'Gestão de Stakeholders', 'Inovação Tecnológica',
  'Healthtech', 'Sistemas Hospitalares', 'Prontuário Eletrônico do Paciente (PEP)', 'Integração de Sistemas',
  'Arquitetura de Soluções', 'Arquitetura de Sistemas', 'Cloud Computing', 'AWS', 'Microsoft Azure',
  'Infraestrutura Crítica', 'Gestão de Datacenter', 'Segurança da Informação', 'Cibersegurança', 'Adequação à LGPD',
  'DevOps', 'CI/CD', 'Cultura Ágil', 'Scrum', 'Liderança Ágil', 'Engenharia de Software', 'Desenvolvimento de Sistemas',
  'Gerenciamento de Projetos de TI', 'Machine Learning', 'Inteligência Artificial', 'Banco de Dados', 'Análise de Dados',
  'Power BI', 'Python', 'Node.js', 'Resolução de Problemas Críticos', 'Alta Disponibilidade de Sistemas',
  'Melhoria Contínua', 'Comunicação Executiva', 'Gestão de Mudanças'
];

// --- SUGESTÕES DE CARGOS (autocomplete) ---
app.get('/api/jobs/suggest', (req, res) => {
  const q = (req.query.q || '').trim();
  const limit = Math.min(parseInt(req.query.limit, 10) || 15, 30);
  const tryRead = (file) => {
    try { return fs.readFileSync(path.join(CONFIG.dataDir, file), 'utf8'); } catch { return null; }
  };
  const raw = tryRead('vagawithsalary.json') || tryRead('vagawithurl.json') || tryRead('vagasdb.json');
  if (!raw) return res.json([]);
  let data;
  try { data = JSON.parse(raw); } catch (e) { return res.json([]); }
  const jobs = Array.isArray(data) ? data : [data];
  const suggestions = suggestJobTitles(jobs, q, limit);
  res.json(suggestions);
});

// --- CAMINHO(S) DE CARREIRA (from → to) - retorna 1 ou 2 paths ---
app.get('/api/career-path', (req, res) => {
  const from = (req.query.from || 'Coordenador de TI').trim();
  const to = (req.query.to || '').trim();
  if (!to) return res.status(400).json({ erro: 'Informe o parâmetro to (cargo alvo)' });
  const tryRead = (file) => {
    try { return fs.readFileSync(path.join(CONFIG.dataDir, file), 'utf8'); } catch { return null; }
  };
  const raw = tryRead('vagawithsalary.json') || tryRead('vagawithurl.json');
  if (!raw) return res.status(404).json({ erro: 'Execute a análise total primeiro.' });
  let data;
  try { data = JSON.parse(raw); } catch (e) { return res.status(500).json({ erro: 'Erro ao parsear dados' }); }
  const result = findCareerPaths(data, from, to, 4);
  res.json(result);
});

app.post('/api/analyze-by-keywords', (req, res) => {
  const tryRead = (file) => {
    try { return fs.readFileSync(path.join(CONFIG.dataDir, file), 'utf8'); } catch { return null; }
  };
  const raw = tryRead('vagawithsalary.json') || tryRead('vagawithurl.json');
  if (!raw) return res.status(404).json({ erro: 'Execute a análise total primeiro.' });
  let data;
  try { data = JSON.parse(raw); } catch (e) { return res.status(500).json({ erro: 'Erro ao parsear dados' }); }
  const keywords = req.body?.keywords ?? DEFAULT_KEYWORDS;
  const topN = Math.min(parseInt(req.body?.topN, 10) || 20, 50);
  const results = analyzeByKeywords(data, keywords, topN);
  res.json({ topCaminhos: results, totalKeywords: keywords.length });
});
