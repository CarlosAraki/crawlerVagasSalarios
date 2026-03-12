/**
 * Engine de análise de carreira - encontra os melhores caminhos para maximizar ganhos
 * Baseado em grafos de progressão de carreira e dados salariais
 */

const { parseSalaryToNumber } = require('./salaryParser');

/**
 * Extrai slug do cargo linkado a partir de URL
 * Ex: ".../cargos/engenheiro-de-software/cargos/arquiteto-de-software" -> "arquiteto-de-software"
 */
function extractSlugFromUrl(url) {
  if (!url) return null;
  const parts = url.split('/cargos/').filter(Boolean);
  if (parts.length < 2) return null;
  const lastPart = parts[parts.length - 1];
  return lastPart.split('/')[0].split('?')[0] || null;
}

/**
 * Constrói grafo de carreira a partir dos dados crawleados
 * Nós = cargos com id, título, salários
 * Arestas = progressões (cargo anterior -> cargo atual) ou (atual -> próximo)
 */
function buildCareerGraph(jobsWithConnections) {
  const nodes = new Map(); // slug/id -> { id, title, salaryHigh, salaryAvg, salaryLow, slug }
  const edgesPrev = new Map(); // cargo -> [cargos anteriores]
  const edgesNext = new Map(); // cargo -> [próximos cargos]

  for (const job of jobsWithConnections) {
    const slug = job.slug || job.id;
    if (!slug) continue;

    const salaryHigh = typeof job.salaryHigh === 'number' 
      ? job.salaryHigh 
      : parseSalaryToNumber(job.salaryHigh);
    const salaryAvg = typeof job.salaryAverage === 'number'
      ? job.salaryAverage
      : parseSalaryToNumber(job.salaryAverage);
    const salaryLow = typeof job.salaryLower === 'number'
      ? job.salaryLower
      : parseSalaryToNumber(job.salaryLower);

    nodes.set(slug, {
      id: job.id,
      slug,
      title: (job.title || '').replace(/\n/g, ' ').trim(),
      salaryHigh: salaryHigh ?? 0,
      salaryAvg: salaryAvg ?? 0,
      salaryLow: salaryLow ?? 0,
      url: job.url
    });

    (job.previousOccupations || []).forEach(prev => {
      const prevSlug = typeof prev === 'string' ? extractSlugFromUrl(prev) || prev : prev.slug;
      if (prevSlug) {
        if (!edgesPrev.has(slug)) edgesPrev.set(slug, []);
        edgesPrev.get(slug).push(prevSlug);
        if (!nodes.has(prevSlug)) {
          nodes.set(prevSlug, { id: prevSlug, slug: prevSlug, title: prevSlug.replace(/-/g, ' '), salaryHigh: 0, salaryAvg: 0, salaryLow: 0, url: '' });
        }
      }
    });

    (job.nextOccupations || []).forEach(next => {
      const nextSlug = typeof next === 'string' ? extractSlugFromUrl(next) || next : next.slug;
      if (nextSlug) {
        if (!edgesNext.has(slug)) edgesNext.set(slug, []);
        edgesNext.get(slug).push(nextSlug);
        if (!nodes.has(nextSlug)) {
          nodes.set(nextSlug, { id: nextSlug, slug: nextSlug, title: nextSlug.replace(/-/g, ' '), salaryHigh: 0, salaryAvg: 0, salaryLow: 0, url: '' });
        }
      }
    });
  }

  return { nodes, edgesPrev, edgesNext };
}

/**
 * Encontra o caminho completo até um cargo de alto salário
 * Segue as "ocupações anteriores" para construir a trilha de carreira
 */
function findPathToRole(slug, edgesPrev, nodes, visited = new Set()) {
  if (visited.has(slug)) return [slug];
  visited.add(slug);

  const prev = edgesPrev.get(slug);
  if (!prev || prev.length === 0) return [slug];

  const prevSlug = prev[0];
  const subPath = findPathToRole(prevSlug, edgesPrev, nodes, new Set(visited));
  return [...subPath, slug];
}

/**
 * Calcula score de um caminho (para ranqueamento)
 * Considera: salário final, crescimento ao longo do caminho, número de passos
 */
function pathScore(path, nodes) {
  if (!path || path.length === 0) return 0;
  const salaries = path.map(slug => nodes.get(slug)?.salaryHigh ?? 0);
  const finalSalary = salaries[salaries.length - 1] || 0;
  const avgSalary = salaries.reduce((a, b) => a + b, 0) / salaries.length;
  const growth = path.length > 1 
    ? (finalSalary - (salaries[0] || 0)) / (salaries[0] || 1) 
    : 0;
  return finalSalary * 1.0 + avgSalary * 0.2 + growth * 1000;
}

/**
 * Encontra os TOP N melhores caminhos de carreira para maximizar ganhos
 * @param {Array} jobsWithConnections - Dados dos cargos com conexões
 * @param {number} topN - Quantidade de caminhos
 * @returns {Array} - Top N caminhos ranqueados
 */
function findTopCareerPaths(jobsWithConnections, topN = 10) {
  const { nodes, edgesPrev, edgesNext } = buildCareerGraph(jobsWithConnections);

  const rolesBySalary = [...nodes.values()]
    .filter(n => n.salaryHigh > 0)
    .sort((a, b) => b.salaryHigh - a.salaryHigh);

  const paths = [];
  const seenPaths = new Set();

  for (const role of rolesBySalary) {
    const path = findPathToRole(role.slug, edgesPrev, nodes);
    const pathKey = path.join('->');
    if (seenPaths.has(pathKey)) continue;
    seenPaths.add(pathKey);

    const pathData = path.map(slug => {
      const n = nodes.get(slug);
      return n ? { ...n } : { slug, title: slug, salaryHigh: 0, salaryAvg: 0, salaryLow: 0 };
    });

    paths.push({
      path: pathData,
      finalSalary: role.salaryHigh,
      avgSalary: pathData.reduce((s, p) => s + p.salaryHigh, 0) / pathData.length,
      steps: path.length,
      score: pathScore(path, nodes)
    });
  }

  paths.sort((a, b) => b.score - a.score);
  return paths.slice(0, topN);
}

/**
 * Fallback: quando não há dados de conexões, retorna os top N cargos por salário
 */
function findTopJobsBySalary(jobsData, topN = 10) {
  const { parseSalaryToNumber } = require('./salaryParser');
  const normalized = jobsData.map(job => {
    let salaryHigh = null;
    let title = '';
    let id = '';

    if (Array.isArray(job)) {
      id = job[0];
      title = (job[1] || '').replace(/\n/g, ' ').trim();
      salaryHigh = parseSalaryToNumber(job[7] ?? job[8] ?? job[6]);
    } else {
      id = job.id;
      title = job.title;
      salaryHigh = parseSalaryToNumber(job.salaryHigh) ?? job.salaryHigh;
    }

    return { id, title, salaryHigh: salaryHigh ?? 0, ...job };
  });

  return normalized
    .filter(j => j.salaryHigh > 0)
    .sort((a, b) => b.salaryHigh - a.salaryHigh)
    .slice(0, topN)
    .map((j, i) => ({
      rank: i + 1,
      cargo: j.title,
      salarioAlto: j.salaryHigh,
      id: j.id
    }));
}

module.exports = {
  buildCareerGraph,
  findPathToRole,
  findTopCareerPaths,
  findTopJobsBySalary,
  extractSlugFromUrl,
  pathScore
};
