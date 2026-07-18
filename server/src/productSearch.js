'use strict';

// Keep this allowlist deliberately narrow: product search may inspect only fields
// already safe for the authenticated sales/report scope.
const SEARCH_FIELDS = Object.freeze([
  'product_name',
  'iit_code',
  'active_ingredient',
  'ham_luong',
  'strength',
  'uom',
  'province',
  'route',
  'unit_code',
  'unit_name',
  'emp_code',
  'emp_name',
  'contractor_code',
  'contractor_name',
  'contractor',
  'bid_package',
  'priority',
]);

function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokens(value) {
  const normalized = normalize(value);
  return normalized ? normalized.split(' ') : [];
}

// Bounded Levenshtein: returns maxDistance + 1 as soon as a match is impossible.
function editDistanceWithin(a, b, maxDistance) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = current[0];
    for (let j = 1; j <= b.length; j += 1) {
      const value = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      current[j] = value;
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    previous = current;
  }
  return previous[b.length];
}

function typoAllowance(token) {
  if (token.length >= 8) return 2;
  if (token.length >= 4) return 1;
  return 0;
}

function tokenMatches(queryToken, candidateToken) {
  if (queryToken === candidateToken) return true;
  // Preserve useful prefix/partial matching without allowing one-letter searches
  // to fan out across almost every result.
  if (queryToken.length >= 2 && candidateToken.includes(queryToken)) return true;
  // Do not fuzzy-match identifiers/numbers (DN016, QL-001, strengths): a
  // one-character change there can mean a different employee or product.
  if (!/^[a-z]+$/.test(queryToken) || !/^[a-z]+$/.test(candidateToken)) return false;
  const allowance = typoAllowance(queryToken);
  return allowance > 0 && editDistanceWithin(queryToken, candidateToken, allowance) <= allowance;
}

function searchableValues(row = {}, metadata = {}) {
  return SEARCH_FIELDS.flatMap((field) => {
    const values = [row[field], metadata[field]];
    return values.filter((value) => value !== undefined && value !== null && value !== '');
  });
}

function matchesProductSearch(row, query, metadata = {}) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return true;
  const values = searchableValues(row, metadata);
  const haystack = normalize(values.join(' '));
  if (haystack.includes(normalizedQuery)) return true;
  const queryTokens = tokens(normalizedQuery);
  const candidateTokens = tokens(haystack);
  let fuzzyTokenCount = 0;
  for (const queryToken of queryTokens) {
    const direct = candidateTokens.some((candidateToken) => queryToken === candidateToken
      || (queryToken.length >= 2 && candidateToken.includes(queryToken)));
    if (direct) continue;
    const fuzzy = candidateTokens.some((candidateToken) => tokenMatches(queryToken, candidateToken));
    if (!fuzzy) return false;
    // Multi-field queries may contain one typo, but two fuzzy substitutions are
    // too ambiguous (e.g. "thong nhat" must not become "thanh nhiet").
    fuzzyTokenCount += 1;
    if (fuzzyTokenCount > 1) return false;
  }
  return true;
}

function filterProductRows(rows, query, metadataForRow = () => ({})) {
  if (!normalize(query)) return rows;
  return rows.filter((row) => matchesProductSearch(row, query, metadataForRow(row) || {}));
}

module.exports = {
  SEARCH_FIELDS,
  normalize,
  editDistanceWithin,
  matchesProductSearch,
  filterProductRows,
};
