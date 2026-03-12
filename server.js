const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const app = express();

const axios = require('axios');
const cheerio = require('cheerio');

const { parseSalaryToNumber, formatSalary } = require('./lib/salaryParser');
const { findTopCareerPaths, findTopJobsBySalary } = require('./lib/careerPathAnalyzer');
const { crawlAllCareers, crawlLegacyFormat } = require('./lib/careerCrawler');

const CONFIG = {
  port: process.env.PORT || 3333,
  dataDir: __dirname
};

const config = { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } };

app.use(cors());
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
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

// --- CRAWL COMPLETO COM CONEXÕES (salva em vagawithsalary.json) ---
app.get('/crawlCareers', async (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  try {
    const data = await fs.promises.readFile(path.join(CONFIG.dataDir, 'vagasdb.json'), 'utf8');
    const obj = JSON.parse(data);
    const results = await crawlAllCareers(obj, {
      limit,
      onProgress: (current, total, job) => {
        console.log(`[${current}/${total}] ${job.title} - R$ ${job.salaryHigh ?? 'N/I'}`);
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
        caminho: [j.cargo]
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
        caminho: [j.cargo]
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
