/**
 * Utilitário para parsing de salários no formato brasileiro
 * Converte "R$ 8.600,00", "$ 11.700,00" etc. para número
 */

/**
 * Parse salário em formato BR (R$ 8.600,00 ou $ 11.700,00) para número
 * @param {string} salaryStr - String do salário
 * @returns {number|null} - Valor numérico ou null se inválido
 */
function parseSalaryToNumber(salaryStr) {
  if (!salaryStr || typeof salaryStr !== 'string' || salaryStr === 'N/I') {
    return null;
  }
  const cleaned = salaryStr
    .replace(/[R$]/gi, '')
    .replace(/\s/g, '')
    .replace(/\./g, '')  // Remove separador de milhar
    .replace(',', '.');  // Decimal
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Formata número para exibição em Real
 * @param {number} value 
 * @returns {string}
 */
function formatSalary(value) {
  if (value == null || isNaN(value)) return 'N/I';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(value);
}

module.exports = { parseSalaryToNumber, formatSalary };
