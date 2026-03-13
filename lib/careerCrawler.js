/**
 * Crawler avançado para Vagas.com.br - Mapa de Carreiras
 * Extrai salários E conexões de carreira (ocupações anteriores e próximas)
 * Com rate limiting, retry e controle de concorrência
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { parseSalaryToNumber } = require('./salaryParser');

const BASE_URL = 'https://www.vagas.com.br/mapa-de-carreiras';
const REQUEST_DELAY_MS = 800;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const CONCURRENT_REQUESTS = 2;

const config = {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'pt-BR,pt;q=0.9'
  }
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url) {
  let lastError;
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const res = await axios.get(url, { ...config, timeout: 15000 });
      return res.data;
    } catch (e) {
      lastError = e;
      if (i < MAX_RETRIES - 1) {
        await sleep(RETRY_DELAY_MS * (i + 1));
      }
    }
  }
  throw lastError;
}

function extractCareerLinks($, sectionKeyword) {
  const links = [];
  $('a[href*="/cargos/"]').each((_, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().trim();
    if (href && text && href.includes('/cargos/')) {
      const fullUrl = href.startsWith('http') ? href : `${BASE_URL}/servico${href.startsWith('/') ? '' : '/'}${href}`;
      links.push({ href: fullUrl, text, slug: href.match(/\/cargos\/([^/]+)(?:\/|$)/)?.[1] });
    }
  });
  return links;
}

/**
 * Extrai palavras-chave da página do cargo (seção Palavras-Chave)
 */
function extractKeywords($) {
  const keywords = [];
  const html = $.html().toLowerCase();
  const idx = html.indexOf('palavras-chave');
  if (idx < 0) return keywords;
  const after = html.slice(idx, idx + 3000);
  $('li, .keyword, [class*="keyword"]').each((_, el) => {
    const text = $(el).text().trim();
    if (text && text.length > 1 && text.length < 80 && !/^\d+$/.test(text)) {
      const normalized = text.replace(/\s+/g, ' ').trim();
      if (normalized && !keywords.includes(normalized)) keywords.push(normalized);
    }
  });
  if (keywords.length === 0) {
    const matches = after.match(/[-–]\s*([a-zA-Záàâãéèêíïóôõöúçñ\s]+?)(?=\s*[-–]|<|$)/g);
    if (matches) {
      matches.slice(0, 20).forEach(m => {
        const k = m.replace(/^[-–]\s*/, '').trim();
        if (k.length > 1 && k.length < 50 && !keywords.includes(k)) keywords.push(k);
      });
    }
  }
  return keywords.slice(0, 25);
}

/**
 * Determina se o bloco de links é "anteriores" ou "próximas" baseado na posição no DOM
 * A página tem: Ocupações Anteriores ... links ... Próximas Ocupações ... links
 */
function splitPrevNextLinks($) {
  const allLinks = [];
  $('a[href*="/cargos/"]').each((_, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().trim();
    if (href && text && href.includes('/cargos/')) {
      const fullUrl = href.startsWith('http') ? href : BASE_URL + (href.startsWith('/') ? href : '/servico/' + href);
      const slug = href.split('/cargos/').pop().split('/')[0];
      allLinks.push({ href: fullUrl, text, slug });
    }
  });

  const pageText = $.html();
  const idxProximas = pageText.toLowerCase().indexOf('próximas ocupações');
  const idxAnteriores = pageText.toLowerCase().indexOf('ocupações anteriores');

  const previous = [];
  const next = [];

  allLinks.forEach(link => {
    const linkPos = pageText.indexOf(link.href);
    if (linkPos < 0) return;
    if (idxProximas >= 0 && linkPos > idxProximas) {
      next.push(link);
    } else if (idxAnteriores >= 0 && linkPos > idxAnteriores) {
      previous.push(link);
    } else {
      previous.push(link);
    }
  });

  const uniquePrev = [...new Map(previous.map(p => [p.slug, p])).values()];
  const uniqueNext = [...new Map(next.map(p => [p.slug, p])).values()];

  return { previous: uniquePrev, next: uniqueNext };
}

/**
 * Extrai dados completos de um cargo: salários + conexões de carreira
 */
async function fetchJobDetails(role) {
  const roleId = role[0];
  const roleTitle = (role[1] || '').replace(/\n/g, ' ').trim();

  try {
    const page1Url = `${BASE_URL}/servico/cargos/${roleId}`;
    const html1 = await fetchWithRetry(page1Url);
    const $1 = cheerio.load(html1);

    let paginationHref = '';
    $1('.mobileButton').each((_, el) => {
      const href = $1(el).attr('href');
      if (href) paginationHref = href;
    });

    const salaryUrl = paginationHref 
      ? `${BASE_URL}/servico/${paginationHref.replace(/^\//, '')}`
      : `${BASE_URL}/servico/cargos/${roleId}/0`;

    const html2 = await fetchWithRetry(salaryUrl);
    const $2 = cheerio.load(html2);

    let salaryHigh = null, salaryAvg = null, salaryLow = null;
    $2('.higher .money').each((_, el) => { salaryHigh = $2(el).html(); });
    $2('.average .money').each((_, el) => { salaryAvg = $2(el).html(); });
    $2('.lower .money').each((_, el) => { salaryLow = $2(el).html(); });

    const { previous, next } = splitPrevNextLinks($2);
    const keywords = extractKeywords($2);

    const slug = salaryUrl.match(/\/cargos\/([^/]+)/)?.[1] || roleId;

    const result = {
      id: roleId,
      title: roleTitle,
      slug,
      salaryHigh: parseSalaryToNumber(salaryHigh) ?? salaryHigh,
      salaryAverage: parseSalaryToNumber(salaryAvg) ?? salaryAvg,
      salaryLower: parseSalaryToNumber(salaryLow) ?? salaryLow,
      url: salaryUrl,
      previousOccupations: previous.map(p => p.href),
      nextOccupations: next.map(p => p.href),
      keywords
    };

    return result;
  } catch (err) {
    console.error(`Erro ao buscar ${roleId}:`, err.message);
    return {
      id: roleId,
      title: roleTitle,
      slug: roleId,
      salaryHigh: null,
      salaryAverage: null,
      salaryLower: null,
      url: '',
      previousOccupations: [],
      nextOccupations: [],
      keywords: [],
      error: err.message
    };
  }
}

/**
 * Processa lista de cargos com limite de concorrência
 * onProgress(completedCount, total, job) é chamado a cada job concluído
 */
async function processWithConcurrency(items, concurrency, fn, onProgress) {
  const results = [];
  let index = 0;
  let completedCount = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      if (i >= items.length) break;
      const r = await fn(items[i], i);
      results[i] = r;
      completedCount++;
      if (onProgress) onProgress(completedCount, items.length, r);
      await sleep(REQUEST_DELAY_MS);
    }
  }

  const workers = Array(Math.min(concurrency, items.length)).fill(null).map(() => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Crawl principal: busca todos os cargos com salários e conexões
 * @param {Array} roles - Lista de cargos do vagasdb [id, title, ...]
 * @param {Object} options - { limit, onProgress }
 */
async function crawlAllCareers(roles, options = {}) {
  const { limit = 0, onProgress } = options;
  const toProcess = limit > 0 ? roles.filter(r => r && r[0]).slice(0, limit) : roles.filter(r => r && r[0]);

  const results = await processWithConcurrency(
    toProcess,
    CONCURRENT_REQUESTS,
    (role) => fetchJobDetails(role),
    onProgress
  );

  return results;
}

/**
 * Compatibilidade: formato legado (array) para takeurl
 * Salva em formato que inclui conexões de carreira
 */
async function crawlLegacyFormat(roles, options = {}) {
  const results = await crawlAllCareers(roles, options);
  return results.map(r => [
    r.id,
    r.title,
    r.salaryHigh,
    r.salaryAverage,
    r.salaryLower,
    r.url,
    r.previousOccupations || [],
    r.nextOccupations || []
  ]);
}

module.exports = {
  crawlAllCareers,
  crawlLegacyFormat,
  fetchJobDetails,
  fetchWithRetry,
  extractCareerLinks,
  splitPrevNextLinks
};
