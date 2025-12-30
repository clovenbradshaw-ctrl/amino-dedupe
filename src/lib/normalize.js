/**
 * Name Normalization and Variant Generation
 * Handles Nashville-specific naming patterns, nicknames, and fuzzy matching prep.
 */

// Common nickname mappings (first name → possible variants)
const NICKNAME_MAP = {
  // Robert variants
  'robert': ['bob', 'bobby', 'rob', 'robbie', 'bert'],
  'bob': ['robert', 'bobby', 'rob'],
  'bobby': ['robert', 'bob', 'rob'],

  // William variants
  'william': ['bill', 'billy', 'will', 'willy', 'liam'],
  'bill': ['william', 'billy', 'will'],
  'billy': ['william', 'bill', 'will'],

  // Richard variants
  'richard': ['rick', 'ricky', 'rich', 'dick', 'dickie'],
  'rick': ['richard', 'ricky', 'rich'],

  // James variants
  'james': ['jim', 'jimmy', 'jamie'],
  'jim': ['james', 'jimmy', 'jamie'],
  'jimmy': ['james', 'jim', 'jamie'],

  // Michael variants
  'michael': ['mike', 'mikey', 'mick', 'mickey'],
  'mike': ['michael', 'mikey', 'mick'],

  // Elizabeth variants
  'elizabeth': ['liz', 'lizzy', 'beth', 'betty', 'eliza', 'lisa'],
  'liz': ['elizabeth', 'lizzy', 'beth'],
  'beth': ['elizabeth', 'liz', 'betty'],

  // Jennifer variants
  'jennifer': ['jen', 'jenny', 'jenn'],
  'jen': ['jennifer', 'jenny'],
  'jenny': ['jennifer', 'jen'],

  // Katherine variants
  'katherine': ['kate', 'katie', 'kathy', 'cathy', 'kit'],
  'catherine': ['kate', 'katie', 'kathy', 'cathy', 'kit'],
  'kate': ['katherine', 'catherine', 'katie'],

  // Margaret variants
  'margaret': ['maggie', 'meg', 'peggy', 'marge', 'margie'],
  'maggie': ['margaret', 'meg'],

  // Charles variants
  'charles': ['charlie', 'chuck', 'chas'],
  'charlie': ['charles', 'chuck'],

  // Joseph variants
  'joseph': ['joe', 'joey', 'jo'],
  'joe': ['joseph', 'joey'],

  // Thomas variants
  'thomas': ['tom', 'tommy', 'thom'],
  'tom': ['thomas', 'tommy'],

  // Christopher variants
  'christopher': ['chris', 'topher', 'kit'],
  'chris': ['christopher', 'christine', 'christina'],

  // Patricia variants
  'patricia': ['pat', 'patty', 'trish', 'tricia'],
  'pat': ['patricia', 'patrick'],

  // Patrick variants
  'patrick': ['pat', 'paddy', 'rick'],

  // Daniel variants
  'daniel': ['dan', 'danny', 'dannie'],
  'dan': ['daniel', 'danny'],

  // Anthony variants
  'anthony': ['tony', 'ant'],
  'tony': ['anthony'],

  // Samuel variants
  'samuel': ['sam', 'sammy'],
  'sam': ['samuel', 'samantha', 'sammy'],

  // Spanish/Latin names common in Nashville
  'jose': ['pepe', 'chepe', 'joe'],
  'francisco': ['paco', 'pancho', 'frank', 'frankie'],
  'guadalupe': ['lupe', 'lupita'],
  'maria': ['mary', 'mari'],
  'jesus': ['chuy', 'chucho'],
  'alejandro': ['alex', 'alejo'],
  'alejandra': ['alex', 'aleja'],
  'miguel': ['mike', 'michael'],
  'guillermo': ['memo', 'william', 'bill'],
  'enrique': ['henry', 'kike'],
  'roberto': ['robert', 'bob', 'beto'],
  'eduardo': ['eddie', 'edward', 'lalo'],
  'fernando': ['fernie', 'nando'],
  'ricardo': ['richard', 'rick', 'ricky'],
};

// Build reverse mapping
const NICKNAME_REVERSE = {};
Object.entries(NICKNAME_MAP).forEach(([name, variants]) => {
  variants.forEach(variant => {
    if (!NICKNAME_REVERSE[variant]) {
      NICKNAME_REVERSE[variant] = [];
    }
    if (!NICKNAME_REVERSE[variant].includes(name)) {
      NICKNAME_REVERSE[variant].push(name);
    }
  });
});

// Honorifics and titles to strip
const HONORIFICS = [
  'dr', 'dr.', 'doctor',
  'mr', 'mr.', 'mister',
  'mrs', 'mrs.', 'missus',
  'ms', 'ms.', 'miss',
  'prof', 'prof.', 'professor',
  'rev', 'rev.', 'reverend',
  'hon', 'hon.', 'honorable',
  'sr', 'sr.', 'señor', 'senor',
  'sra', 'sra.', 'señora', 'senora',
];

// Suffixes to extract
const SUFFIXES = [
  'jr', 'jr.', 'junior',
  'sr', 'sr.', 'senior',
  'i', 'ii', 'iii', 'iv', 'v',
  '1st', '2nd', '3rd', '4th',
  'esq', 'esq.', 'esquire',
  'phd', 'ph.d', 'ph.d.',
  'md', 'm.d', 'm.d.',
];

/**
 * Remove diacritical marks (accents) from a string
 * e.g., "García" → "Garcia"
 */
export function removeAccents(str) {
  if (!str) return '';
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Extract and normalize name components
 * Returns: { canonical, variants, honorifics, suffixes, parts }
 */
export function normalizeName(fullName) {
  if (!fullName || typeof fullName !== 'string') {
    return {
      canonical: '',
      variants: [],
      honorifics: [],
      suffixes: [],
      parts: [],
      original: fullName || '',
    };
  }

  // Clean and lowercase
  let name = removeAccents(fullName)
    .toLowerCase()
    .trim()
    // Remove extra whitespace
    .replace(/\s+/g, ' ')
    // Remove common punctuation
    .replace(/[.,'"()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const foundHonorifics = [];
  const foundSuffixes = [];

  // Extract honorifics
  HONORIFICS.forEach(h => {
    const regex = new RegExp(`\\b${h.replace('.', '\\.')}\\b`, 'gi');
    if (regex.test(name)) {
      foundHonorifics.push(h.replace('.', ''));
      name = name.replace(regex, ' ').replace(/\s+/g, ' ').trim();
    }
  });

  // Extract suffixes
  SUFFIXES.forEach(s => {
    const regex = new RegExp(`\\b${s.replace('.', '\\.')}\\b`, 'gi');
    if (regex.test(name)) {
      foundSuffixes.push(s.replace('.', ''));
      name = name.replace(regex, ' ').replace(/\s+/g, ' ').trim();
    }
  });

  // Split into parts and filter empty
  const parts = name.split(/[\s,]+/).filter(p => p.length > 0);

  // Handle "Last, First" format
  if (fullName.includes(',')) {
    const commaParts = fullName.split(',').map(p => p.trim());
    if (commaParts.length === 2) {
      // Assume "Last, First Middle" format
      const lastName = removeAccents(commaParts[0]).toLowerCase().trim();
      const firstMiddle = removeAccents(commaParts[1]).toLowerCase().trim().split(/\s+/);
      parts.length = 0;
      parts.push(...firstMiddle, lastName);
    }
  }

  // Generate canonical form (sorted alphabetically for comparison)
  const canonical = parts.slice().sort().join(' ');

  // Generate variants based on nicknames
  const variants = new Set([canonical]);

  parts.forEach((part, idx) => {
    // Check direct nicknames
    const nicknames = NICKNAME_MAP[part] || [];
    // Check reverse nicknames
    const reverseNicknames = NICKNAME_REVERSE[part] || [];

    const allVariants = [...nicknames, ...reverseNicknames];

    allVariants.forEach(variant => {
      const newParts = [...parts];
      newParts[idx] = variant;
      variants.add(newParts.slice().sort().join(' '));
    });
  });

  return {
    canonical,
    variants: Array.from(variants),
    honorifics: foundHonorifics,
    suffixes: foundSuffixes,
    parts,
    original: fullName,
  };
}

/**
 * Calculate Levenshtein distance between two strings
 */
export function levenshteinDistance(a, b) {
  if (!a || !b) return Math.max((a || '').length, (b || '').length);

  const matrix = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity score between two strings (0-100)
 */
export function stringSimilarity(a, b) {
  if (!a && !b) return 100;
  if (!a || !b) return 0;

  const distance = levenshteinDistance(a.toLowerCase(), b.toLowerCase());
  const maxLen = Math.max(a.length, b.length);

  if (maxLen === 0) return 100;

  return Math.round((1 - distance / maxLen) * 100);
}

/**
 * Check if two names might be the same person considering nicknames
 */
export function areNamesSimilar(name1, name2, threshold = 80) {
  const norm1 = normalizeName(name1);
  const norm2 = normalizeName(name2);

  // Check canonical match
  if (norm1.canonical === norm2.canonical) {
    return { match: true, score: 100, reason: 'exact_canonical' };
  }

  // Check variant match
  for (const v1 of norm1.variants) {
    for (const v2 of norm2.variants) {
      if (v1 === v2) {
        return { match: true, score: 95, reason: 'nickname_variant' };
      }
    }
  }

  // Check fuzzy match on canonical
  const similarity = stringSimilarity(norm1.canonical, norm2.canonical);
  if (similarity >= threshold) {
    return { match: true, score: similarity, reason: 'fuzzy_match' };
  }

  // Check if parts overlap significantly
  const sharedParts = norm1.parts.filter(p => norm2.parts.includes(p));
  if (sharedParts.length >= 2 && sharedParts.length >= Math.min(norm1.parts.length, norm2.parts.length)) {
    return { match: true, score: 85, reason: 'shared_parts' };
  }

  return { match: false, score: similarity, reason: 'no_match' };
}

/**
 * Generate phonetic code (simplified Soundex-like)
 */
export function phoneticCode(str) {
  if (!str) return '';

  const cleaned = removeAccents(str).toLowerCase().replace(/[^a-z]/g, '');
  if (!cleaned) return '';

  const codes = {
    b: '1', f: '1', p: '1', v: '1',
    c: '2', g: '2', j: '2', k: '2', q: '2', s: '2', x: '2', z: '2',
    d: '3', t: '3',
    l: '4',
    m: '5', n: '5',
    r: '6',
  };

  let result = cleaned[0].toUpperCase();
  let prevCode = codes[cleaned[0]] || '';

  for (let i = 1; i < cleaned.length && result.length < 4; i++) {
    const code = codes[cleaned[i]];
    if (code && code !== prevCode) {
      result += code;
      prevCode = code;
    } else if (!code) {
      prevCode = '';
    }
  }

  return result.padEnd(4, '0');
}

/**
 * Normalize phone number for comparison
 */
export function normalizePhone(phone) {
  if (!phone) return '';
  // Remove all non-digits
  const digits = phone.replace(/\D/g, '');
  // Remove country code if present
  if (digits.length === 11 && digits[0] === '1') {
    return digits.slice(1);
  }
  return digits;
}

/**
 * Normalize email for comparison
 */
export function normalizeEmail(email) {
  if (!email) return '';
  return email.toLowerCase().trim();
}

/**
 * Normalize address for comparison
 */
export function normalizeAddress(address) {
  if (!address) return '';

  return removeAccents(address)
    .toLowerCase()
    .trim()
    // Standardize common abbreviations
    .replace(/\bstreet\b/g, 'st')
    .replace(/\bavenue\b/g, 'ave')
    .replace(/\bdrive\b/g, 'dr')
    .replace(/\bboulevard\b/g, 'blvd')
    .replace(/\broad\b/g, 'rd')
    .replace(/\bcourt\b/g, 'ct')
    .replace(/\blane\b/g, 'ln')
    .replace(/\bapartment\b/g, 'apt')
    .replace(/\bsuite\b/g, 'ste')
    .replace(/\bnorth\b/g, 'n')
    .replace(/\bsouth\b/g, 's')
    .replace(/\beast\b/g, 'e')
    .replace(/\bwest\b/g, 'w')
    // Remove punctuation and extra spaces
    .replace(/[.,#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
