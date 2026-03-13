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
      url: job.url,
      keywords: job.keywords || []
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
      id: j.id,
      keywords: j.keywords || []
    }));
}

const SYNONYMS = {
  cto: ['chief technology officer', 'diretor de tecnologia', 'diretor tecnologia'],
  cio: ['chief information officer', 'diretor de ti', 'diretor ti', 'diretor de informática'],
  head: ['head of', 'gestor', 'gerente', 'líder', 'lider'],
  ti: ['tecnologia da informação', 'tecnologia informação', 'it ', ' it'],
  devops: ['dev ops', 'ci/cd'],
  cloud: ['aws', 'azure', 'gcp', 'cloud computing'],
  lgpd: ['proteção de dados', 'privacidade de dados']
};

function expandSynonyms(word) {
  const w = word.toLowerCase().trim();
  if (SYNONYMS[w]) return [w, ...SYNONYMS[w]];
  return [w];
}

/**
 * Análise por keywords do currículo: ranqueia cargos pela afinidade
 */
function analyzeByKeywords(jobs, userKeywords, topN = 20) {
  const { formatSalary } = require('./salaryParser');
  const kwList = Array.isArray(userKeywords)
    ? userKeywords
    : (userKeywords || '').split(/[,;|\n()]+/).map(k => k.trim()).filter(k => k.length > 1);

  const normalize = (s) => (s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

  const scoreJob = (job) => {
    const title = normalize(job.title || '');
    const jobKeywords = (job.keywords || []).map(k => normalize(String(k))).join(' ');
    const searchable = title + ' ' + jobKeywords;

    let score = 0;
    const matched = [];
    for (const kw of kwList) {
      const variants = expandSynonyms(kw);
      for (const v of variants) {
        const n = normalize(v);
        if (n.length < 2) continue;
        if (searchable.includes(n) || title.includes(n)) {
          const wordScore = n.length > 4 ? 2 : 1;
          score += wordScore;
          if (!matched.includes(kw)) matched.push(kw);
          break;
        }
      }
      const words = kw.split(/\s+/).filter(w => w.length > 2);
      if (words.length > 1 && words.every(w => searchable.includes(normalize(w)))) {
        score += 3;
        if (!matched.includes(kw)) matched.push(kw);
      }
    }
    return { score, matched };
  };

  const normalizeJob = (j) => ({
    ...j,
    title: (j.title || '').replace(/\n/g, ' ').trim(),
    salaryHigh: typeof j.salaryHigh === 'number' ? j.salaryHigh : parseSalaryToNumber(j.salaryHigh) ?? 0
  });

  const jobList = Array.isArray(jobs) && jobs.length > 0 && Array.isArray(jobs[0])
    ? jobs.map(row => ({
        id: row[0],
        title: row[1],
        salaryHigh: row[2] ?? row[7],
        keywords: row[13] || []
      }))
    : jobs;

  const scored = jobList
    .map(normalizeJob)
    .map(job => {
      const { score, matched } = scoreJob(job);
      return { ...job, keywordScore: score, matchedKeywords: matched };
    })
    .sort((a, b) => {
      if (b.keywordScore !== a.keywordScore) return b.keywordScore - a.keywordScore;
      return (b.salaryHigh || 0) - (a.salaryHigh || 0);
    });

  const toReturn = scored.slice(0, topN);
  return toReturn.map((j, i) => ({
    rank: i + 1,
    cargo: j.title,
    salarioAlto: j.salaryHigh,
    salarioFormatado: formatSalary(j.salaryHigh),
    afinidade: j.keywordScore,
    keywordsEncontradas: j.matchedKeywords,
    keywordsCargo: (j.keywords || []).slice(0, 10)
  }));
}

/**
 * Níveis de senioridade para progressão sintética (quando não há conexões no grafo)
 */
const SENIORITY_KEYWORDS = [
  ['analista', 'desenvolvedor', 'programador', 'técnico', 'assistente', 'especialista júnior'],
  ['coordenador', 'supervisor', 'especialista sênior', 'líder técnico', 'tech lead'],
  ['gerente', 'gestor', 'head'],
  ['diretor', 'superintendente'],
  ['cto', 'cio', 'ceo', 'cfo', 'chief', 'diretor superintendente']
];

const MIN_INTERMEDIATES = 5;
const MIN_KEYWORDS_PARA_PROXIMO = 5;

/** Keywords genéricas de evolução de carreira por domínio (usadas como fallback) */
const KEYWORDS_PROGRESSAO = {
  ti: ['Liderança Técnica', 'Gestão de Equipes', 'Cloud Computing', 'Arquitetura de Sistemas', 'DevOps', 'Metodologias Ágeis', 'Planejamento Estratégico', 'Governança de TI', 'Segurança da Informação', 'Integração de Sistemas'],
  geral: ['Liderança', 'Gestão de Pessoas', 'Planejamento Estratégico', 'Análise de Dados', 'Comunicação Executiva', 'Gestão de Projetos', 'Budget e Orçamento', 'Desenvolvimento Profissional', 'Mentoria']
};

function getSeniorityLevel(title) {
  const t = (title || '').toLowerCase();
  for (let i = 0; i < SENIORITY_KEYWORDS.length; i++) {
    if (SENIORITY_KEYWORDS[i].some(kw => t.includes(kw))) return i;
  }
  return 2;
}

function normalizeTitle(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();
}

function titleSimilarity(a, b) {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.8;
  const wordsA = new Set(na.split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(nb.split(/\s+/).filter(w => w.length > 2));
  const intersect = [...wordsA].filter(w => wordsB.has(w)).length;
  return intersect / Math.max(wordsA.size, wordsB.size, 1);
}

/**
 * Calcula keywords necessárias para evoluir do cargo atual para o próximo.
 * Garante mínimo MIN_KEYWORDS_PARA_PROXIMO e melhora o relacionamento entre cargos.
 */
function computeKeywordsParaProximo(currentJob, nextJob, jobList = []) {
  if (!nextJob) return [];
  const MIN = MIN_KEYWORDS_PARA_PROXIMO;
  const result = [];
  const seenNorm = new Set();

  const pushUnique = (kw) => {
    const n = String(kw).trim();
    if (n.length <= 2 || n.length >= 60) return false;
    const norm = normalizeTitle(n);
    if (seenNorm.has(norm)) return false;
    seenNorm.add(norm);
    result.push(n);
    return true;
  };

  const currentKw = new Set((currentJob?.keywords || []).map(k => normalizeTitle(String(k))));
  const nextKw = (nextJob?.keywords || []).map(k => String(k).trim()).filter(Boolean);

  // 1. Keywords do próximo cargo que o atual não tem (relacionamento direto)
  for (const k of nextKw) {
    if (!currentKw.has(normalizeTitle(k)) && result.length < 12) pushUnique(k);
  }

  // 2. Palavras significativas do título do próximo cargo
  if (nextJob?.title) {
    const stopwords = /^(de|da|do|das|dos|em|e|ou|para|com|são)$/i;
    const titleWords = (nextJob.title || '').split(/\s+/)
      .filter(w => w.length > 3 && !stopwords.test(w));
    for (const w of titleWords) {
      if (result.length >= 12) break;
      pushUnique(w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    }
  }

  // 3. Keywords de cargos similares ao próximo (enriquecimento)
  const nextNorm = normalizeTitle(nextJob?.title || '');
  const isTI = /ti|tecnologia|informatica|sistema|software|desenvolvedor/.test(
    normalizeTitle(currentJob?.title || '') + nextNorm
  );
  const similarJobs = (jobList || []).filter(j => {
    const jNorm = normalizeTitle(j?.title || '');
    return jNorm && jNorm !== nextNorm && titleSimilarity(j?.title || '', nextJob?.title || '') >= 0.3;
  });
  for (const j of similarJobs.slice(0, 5)) {
    for (const k of (j.keywords || [])) {
      if (result.length >= 12) break;
      pushUnique(k);
    }
  }

  // 4. Fallback: keywords genéricas de progressão até atingir o mínimo
  const progressao = isTI ? KEYWORDS_PROGRESSAO.ti : KEYWORDS_PROGRESSAO.geral;
  for (const k of progressao) {
    if (result.length >= MIN) break;
    pushUnique(k);
  }

  // 5. Garantia: se ainda faltar, preenche com termos adicionais
  const extra = ['Visão Estratégica', 'Tomada de Decisão', 'Gestão de Stakeholders', 'Inovação', 'Resolução de Problemas'];
  for (const k of extra) {
    if (result.length >= MIN) break;
    pushUnique(k);
  }

  return result.slice(0, Math.max(MIN, result.length));
}

/**
 * Encontra até 4 caminhos de carreira: from → to (mesmo início e fim)
 * Caminhos podem convergir e divergir como grafo de progressão
 * Cada path tem mínimo 5 intermediários, salários crescentes
 */
function findCareerPaths(jobs, fromTitle, toTitle, maxPaths = 4) {
  const result = findCareerPath(jobs, fromTitle, toTitle, { minIntermediates: MIN_INTERMEDIATES });
  const paths = [result.path];
  const path1Intermediates = (result.path || []).slice(1, -1).map(p => normalizeTitle(p.cargo));
  const toNorm = normalizeTitle(result.to);

  const tryAddPath = (opts) => {
    const r = findCareerPath(jobs, fromTitle, toTitle, { ...opts, minIntermediates: MIN_INTERMEDIATES });
    if (!r.path || r.path.length < 5) return false;
    const lastNorm = normalizeTitle((r.path || [])[(r.path || []).length - 1]?.cargo);
    if (lastNorm !== toNorm) return false;
    const newKey = (r.path || []).map(p => p.cargo).join('|');
    if (paths.some(p => (p || []).map(n => n.cargo).join('|') === newKey)) return false;
    paths.push(r.path);
    return true;
  };

  if (maxPaths >= 2) {
    tryAddPath({ excludeTitles: path1Intermediates.slice(0, 3), preferSalaryOnly: true });
  }
  if (maxPaths >= 3) {
    tryAddPath({ excludeTitles: path1Intermediates.slice(1, 4), preferSalaryOnly: false });
  }
  if (maxPaths >= 4) {
    tryAddPath({ excludeTitles: path1Intermediates.slice(2, 5), preferSalaryOnly: true });
  }

  return {
    paths,
    from: result.from,
    to: result.to,
    targetReached: result.targetReached,
    nota: result.nota
  };
}

/**
 * Encontra caminho de carreira: from (cargo atual) → to (cargo alvo)
 * options: { excludeTitles: Set|Array } - títulos a excluir (para path alternativo)
 */
function findCareerPath(jobs, fromTitle, toTitle, options = {}) {
  const excludeTitles = new Set((options.excludeTitles || []).map(t => normalizeTitle(t)));
  const minIntermediates = options.minIntermediates ?? MIN_INTERMEDIATES;
  const jobList = Array.isArray(jobs) && jobs.length > 0 && !Array.isArray(jobs[0])
    ? jobs
    : jobs.map(row => ({
        id: row[0],
        title: row[1],
        slug: row[4] || row[0],
        salaryHigh: row[2] ?? row[7],
        keywords: row[13] || []
      }));

  const bySlug = new Map();
  const byTitle = new Map();
  jobList.forEach(j => {
    const title = (j.title || '').replace(/\n/g, ' ').trim();
    bySlug.set(j.slug || j.id, { ...j, title });
    byTitle.set(normalizeTitle(title), { ...j, title });
  });

  const findBestMatch = (searchTitle) => {
    const n = normalizeTitle(searchTitle);
    if (byTitle.has(n)) return byTitle.get(n);
    let best = null;
    let bestScore = 0;
    for (const [title, job] of byTitle) {
      const score = titleSimilarity(searchTitle, job.title);
      if (score > bestScore && score >= 0.3) {
        bestScore = score;
        best = job;
      }
    }
    return best;
  };

  const fromJob = findBestMatch(fromTitle) || { title: fromTitle, salaryHigh: 0, keywords: [], slug: 'current' };
  const toJob = findBestMatch(toTitle) || { title: toTitle, salaryHigh: 0, keywords: [], slug: 'target' };

  const edgesNext = new Map();
  const edgesPrev = new Map();
  jobList.forEach(j => {
    (j.previousOccupations || []).forEach(url => {
      const slug = extractSlugFromUrl(url) || url;
      if (slug && slug !== j.slug) {
        if (!edgesPrev.has(j.slug)) edgesPrev.set(j.slug, []);
        edgesPrev.get(j.slug).push(slug);
      }
    });
    (j.nextOccupations || []).forEach(url => {
      const slug = extractSlugFromUrl(url) || url;
      if (slug && slug !== j.slug) {
        if (!edgesNext.has(j.slug)) edgesNext.set(j.slug, []);
        edgesNext.get(j.slug).push(slug);
      }
    });
  });

  const bfs = (startSlug, endSlug, useNext) => {
    const edges = useNext ? edgesNext : edgesPrev;
    const q = [[startSlug]];
    const visited = new Set([startSlug]);
    while (q.length > 0) {
      const path = q.shift();
      const cur = path[path.length - 1];
      if (cur === endSlug) return path;
      const neighbors = edges.get(cur) || [];
      for (const n of neighbors) {
        if (!visited.has(n)) {
          visited.add(n);
          q.push([...path, n]);
        }
      }
    }
    return null;
  };

  let pathSlugs = null;
  if (fromJob.slug && toJob.slug && fromJob.slug !== 'current' && toJob.slug !== 'target') {
    pathSlugs = bfs(fromJob.slug, toJob.slug, true);
    if (!pathSlugs) pathSlugs = bfs(toJob.slug, fromJob.slug, false);
    if (pathSlugs && !pathSlugs.includes(fromJob.slug)) pathSlugs.reverse();
  }

  let pathJobs = [];
  if (pathSlugs && pathSlugs.length >= 2) {
    const rawPath = pathSlugs.map(s => typeof s === 'string' ? (bySlug.get(s) || { slug: s, title: s, salaryHigh: 0, keywords: [] }) : s);
    pathJobs = [rawPath[0]];
    for (let i = 1; i < rawPath.length; i++) {
      const prevSal = pathJobs[pathJobs.length - 1]?.salaryHigh || 0;
      const currSal = rawPath[i]?.salaryHigh || 0;
      if (currSal > prevSal) pathJobs.push(rawPath[i]);
    }
    if (pathJobs.length < rawPath.length && normalizeTitle(pathJobs[pathJobs.length - 1]?.title) !== normalizeTitle(toJob?.title)) {
      const targetSal = toJob?.salaryHigh || 0;
      const lastSal = pathJobs[pathJobs.length - 1]?.salaryHigh || 0;
      if (targetSal > lastSal) pathJobs.push(toJob);
    }
  } else {
    const fromLevel = getSeniorityLevel(fromJob.title);
    const toLevel = getSeniorityLevel(toJob.title);
    const targetLevel = Math.max(toLevel, fromLevel + 1);
    pathJobs = [fromJob];
    const seenTitles = new Set([normalizeTitle(fromJob.title)]);
    let currentLevel = fromLevel;
    const domainWords = [...normalizeTitle(fromJob.title).split(/\s+/), ...normalizeTitle(toJob.title).split(/\s+/)]
      .filter(w => w.length > 2);
    const fromNorm = normalizeTitle(fromJob.title);
    const toNorm = normalizeTitle(toJob.title);
    const preferDomain = /ti|tecnologia|informa|sistema|software|tecnologia/.test(fromNorm + toNorm);

    const toSalaryVal = toJob.salaryHigh || parseSalaryToNumber(toJob.salaryHigh) || 999999;
    const lastSalary = () => (pathJobs[pathJobs.length - 1]?.salaryHigh || 0);
    const intermediatesCount = () => Math.max(0, pathJobs.length - 1);
    const minInt = minIntermediates;
    let noProgressCount = 0;

    while ((intermediatesCount() < minInt || currentLevel < targetLevel) && pathJobs.length < 12 && noProgressCount < 3) {
      const minSalary = lastSalary();
      const maxSalaryForStep = toSalaryVal - 1;
      const needMore = intermediatesCount() < minInt;
      const allowSameLevel = needMore && currentLevel >= fromLevel;
      const levelRange = allowSameLevel ? [currentLevel, Math.min(currentLevel + 1, 4)] : [Math.min(currentLevel + 1, 4), Math.min(currentLevel + 1, 4)];
      const candidates = jobList.filter(j => {
        const sal = j.salaryHigh || parseSalaryToNumber(j.salaryHigh) || 0;
        if (sal <= minSalary || sal >= toSalaryVal) return false;
        const jLevel = getSeniorityLevel(j.title);
        const jTitle = normalizeTitle(j.title);
        const levelOk = jLevel >= levelRange[0] && jLevel <= levelRange[1];
        if (!levelOk || seenTitles.has(jTitle) || excludeTitles.has(jTitle)) return false;
        const jWords = jTitle.split(/\s+/);
        const hasDomain = domainWords.some(dw => jWords.some(jw => jw.includes(dw) || dw.includes(jw)));
        const hasTech = /ti|tecnologia|informa|sistema|software/.test(jTitle);
        const matches = hasDomain || hasTech;
        if (preferDomain && hasTech) return matches;
        return matches;
      });
      const techBonus = options.preferSalaryOnly ? 0 : 50000;
      const stepsLeft = minInt - intermediatesCount();
      const salaryRoom = toSalaryVal - minSalary;
      const idealNextSalary = stepsLeft > 1 ? minSalary + salaryRoom / (stepsLeft + 1) : toSalaryVal - 1;
      const sorted = candidates.sort((a, b) => {
        const aTech = /\bti\b|tecnologia|sistemas|software|informatica/.test(normalizeTitle(a.title)) ? techBonus : 0;
        const bTech = /\bti\b|tecnologia|sistemas|software|informatica/.test(normalizeTitle(b.title)) ? techBonus : 0;
        const aSal = a.salaryHigh || 0;
        const bSal = b.salaryHigh || 0;
        const penalty = (sal) => stepsLeft > 2 ? Math.abs(sal - idealNextSalary) * 2 : 0;
        const score = (tech, sal) => tech + sal - penalty(sal);
        return score(bTech, bSal) - score(aTech, aSal);
      });
      const best = sorted[0];
      if (!best) {
        noProgressCount++;
        currentLevel = Math.min(currentLevel + 1, 4);
        if (currentLevel >= targetLevel && intermediatesCount() >= minInt) break;
        continue;
      }
      noProgressCount = 0;
      pathJobs.push(best);
      seenTitles.add(normalizeTitle(best.title));
      if (getSeniorityLevel(best.title) > currentLevel) currentLevel = getSeniorityLevel(best.title);
    }
    const lastInPath = pathJobs[pathJobs.length - 1];
    const toSalary = toJob.salaryHigh || parseSalaryToNumber(toJob.salaryHigh) || 0;
    const lastSal = lastInPath?.salaryHigh || 0;
    if (normalizeTitle(lastInPath?.title) !== normalizeTitle(toJob.title)) {
      if (toSalary > lastSal) {
        pathJobs.push(toJob);
      } else {
        const targetWords = normalizeTitle(toJob.title).split(/\s+/).filter(w => w.length > 3);
        const altCandidates = jobList.filter(j => {
          const sal = j.salaryHigh || parseSalaryToNumber(j.salaryHigh) || 0;
          if (sal <= lastSal) return false;
          const jTitle = normalizeTitle(j.title);
          if (seenTitles.has(jTitle)) return false;
          return targetWords.some(tw => jTitle.includes(tw));
        }).sort((a, b) => (b.salaryHigh || 0) - (a.salaryHigh || 0));
        const bestAlt = altCandidates[0];
        if (bestAlt) {
          pathJobs.push(bestAlt);
          seenTitles.add(normalizeTitle(bestAlt.title));
        }
      }
    }
  }

  const pathWithKeywords = pathJobs.map((job, i) => {
    const next = pathJobs[i + 1];
    const toAcquire = computeKeywordsParaProximo(job, next, jobList);
    return {
      cargo: job.title,
      salarioAlto: job.salaryHigh || 0,
      keywords: job.keywords || [],
      keywordsParaProximo: toAcquire
    };
  });

  const reachedTarget = pathWithKeywords.length > 0 &&
    normalizeTitle(pathWithKeywords[pathWithKeywords.length - 1].cargo) === normalizeTitle(toJob.title);

  return {
    path: pathWithKeywords,
    from: fromJob.title,
    to: toJob.title,
    targetReached: reachedTarget,
    nota: !reachedTarget ? 'O cargo alvo tem salário menor que os passos intermediários. O caminho mostra uma progressão com salários sempre crescentes.' : null
  };
}

function suggestJobTitles(jobs, query, limit = 15) {
  const q = normalizeTitle(query || '').trim();
  if (q.length < 2) return [];
  const jobList = Array.isArray(jobs) ? jobs : [jobs];
  const normalize = (row) => ({ title: Array.isArray(row) ? (row[1] || '') : (row.title || row.cargo || '') });
  const results = [];
  const seen = new Set();
  const qWords = q.split(/\s+/).filter(Boolean);
  for (const row of jobList) {
    const j = normalize(row);
    const title = (j.title || '').replace(/\n/g, ' ').trim();
    if (!title || seen.has(normalizeTitle(title))) continue;
    const nt = normalizeTitle(title);
    if (nt.includes(q) || (qWords.length > 0 && qWords.every(w => nt.includes(w)))) {
      seen.add(nt);
      const score = nt.startsWith(q) ? 2 : (nt.includes(q) ? 1 : 0);
      results.push({ title, score });
    }
  }
  results.sort((a, b) => (b.score || 0) - (a.score || 0));
  return results.slice(0, limit).map(r => ({ title: r.title }));
}

module.exports = {
  buildCareerGraph,
  findPathToRole,
  findTopCareerPaths,
  findTopJobsBySalary,
  analyzeByKeywords,
  findCareerPath,
  findCareerPaths,
  suggestJobTitles,
  extractSlugFromUrl,
  pathScore
};
