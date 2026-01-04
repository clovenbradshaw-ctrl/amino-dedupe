/**
 * Cross-Table Duplicate Detection
 * Compares records from two different tables to find potential duplicates.
 */

import Fuse from 'fuse.js';
import {
  normalizeName,
  areNamesSimilar,
  normalizePhone,
  normalizeEmail,
  stringSimilarity,
} from './normalize.js';

// Match confidence tiers
export const MATCH_TIERS = {
  DEFINITIVE: { tier: 1, name: 'Definitive', minConfidence: 95, color: '#10b981' },
  STRONG: { tier: 2, name: 'Strong', minConfidence: 80, color: '#6366f1' },
  POSSIBLE: { tier: 3, name: 'Possible', minConfidence: 60, color: '#f59e0b' },
  WEAK: { tier: 4, name: 'Weak', minConfidence: 40, color: '#ef4444' },
};

/**
 * Get the tier for a given confidence score
 */
function getTier(confidence) {
  if (confidence >= 95) return MATCH_TIERS.DEFINITIVE;
  if (confidence >= 80) return MATCH_TIERS.STRONG;
  if (confidence >= 60) return MATCH_TIERS.POSSIBLE;
  return MATCH_TIERS.WEAK;
}

/**
 * Extract a display name from a record
 * Tries common name field patterns
 */
function extractName(record) {
  const fields = record.fields || {};

  // Try common name field patterns
  const nameFields = [
    'Name', 'name',
    'Client Name', 'ClientName', 'client_name',
    'Full Name', 'FullName', 'full_name',
    'First Name', 'FirstName', 'first_name',
    'Contact Name', 'ContactName', 'contact_name',
    'Company', 'company',
    'Title', 'title',
  ];

  for (const fieldName of nameFields) {
    if (fields[fieldName] && typeof fields[fieldName] === 'string') {
      return fields[fieldName].trim();
    }
  }

  // Try combining first + last name
  const first = fields['First Name'] || fields['FirstName'] || fields['first_name'] || '';
  const last = fields['Last Name'] || fields['LastName'] || fields['last_name'] ||
               fields['Family Name'] || fields['FamilyName'] || '';

  if (first || last) {
    return `${first} ${last}`.trim();
  }

  // Return first non-empty string field as fallback
  for (const [key, val] of Object.entries(fields)) {
    if (typeof val === 'string' && val.trim()) {
      return val.trim().substring(0, 50);
    }
  }

  return `Record ${record.id}`;
}

/**
 * Extract searchable text from a record for fuzzy matching
 */
function extractSearchableText(record) {
  const fields = record.fields || {};
  const parts = [];

  // Add all string fields
  for (const [key, val] of Object.entries(fields)) {
    if (typeof val === 'string' && val.trim()) {
      parts.push(val.trim());
    }
  }

  return parts.join(' ');
}

/**
 * Find common fields between two schemas
 */
export function findCommonFields(schema1, schema2) {
  const fields1 = new Set([...schema1.writableFields, ...schema1.computedFields]);
  const fields2 = new Set([...schema2.writableFields, ...schema2.computedFields]);

  const common = [];
  for (const field of fields1) {
    if (fields2.has(field)) {
      common.push(field);
    }
  }

  return common;
}

/**
 * Score similarity between two records
 * Returns { score, reasons }
 */
function scoreRecordSimilarity(record1, record2, commonFields) {
  const fields1 = record1.fields || {};
  const fields2 = record2.fields || {};
  const reasons = [];
  let totalScore = 0;
  let matchedFields = 0;

  for (const fieldName of commonFields) {
    const val1 = fields1[fieldName];
    const val2 = fields2[fieldName];

    // Skip if either value is empty
    if (!val1 || !val2) continue;

    // Handle arrays (linked records)
    if (Array.isArray(val1) || Array.isArray(val2)) {
      continue; // Skip array fields for now
    }

    // Handle strings
    if (typeof val1 === 'string' && typeof val2 === 'string') {
      const v1 = val1.trim().toLowerCase();
      const v2 = val2.trim().toLowerCase();

      if (!v1 || !v2) continue;

      // Exact match
      if (v1 === v2) {
        totalScore += 100;
        matchedFields++;
        reasons.push(`${fieldName}: exact match`);
        continue;
      }

      // Check for name-like fields
      const nameLike = fieldName.toLowerCase().includes('name');
      if (nameLike) {
        const nameMatch = areNamesSimilar(v1, v2, 70);
        if (nameMatch.match) {
          totalScore += nameMatch.score;
          matchedFields++;
          reasons.push(`${fieldName}: ${nameMatch.score}% similar`);
          continue;
        }
      }

      // Check for phone fields
      if (fieldName.toLowerCase().includes('phone')) {
        const phone1 = normalizePhone(v1);
        const phone2 = normalizePhone(v2);
        if (phone1 && phone2 && phone1.length >= 7 && phone1 === phone2) {
          totalScore += 100;
          matchedFields++;
          reasons.push(`${fieldName}: phone match`);
          continue;
        }
      }

      // Check for email fields
      if (fieldName.toLowerCase().includes('email')) {
        const email1 = normalizeEmail(v1);
        const email2 = normalizeEmail(v2);
        if (email1 && email2 && email1 === email2) {
          totalScore += 100;
          matchedFields++;
          reasons.push(`${fieldName}: email match`);
          continue;
        }
      }

      // General string similarity for other fields
      const similarity = stringSimilarity(v1, v2);
      if (similarity >= 80) {
        totalScore += similarity;
        matchedFields++;
        reasons.push(`${fieldName}: ${similarity}% similar`);
      }
    }

    // Handle numbers
    if (typeof val1 === 'number' && typeof val2 === 'number') {
      if (val1 === val2) {
        totalScore += 100;
        matchedFields++;
        reasons.push(`${fieldName}: exact match`);
      }
    }
  }

  // Calculate average score
  const avgScore = matchedFields > 0 ? Math.round(totalScore / matchedFields) : 0;

  return {
    score: avgScore,
    matchedFields,
    reasons,
  };
}

/**
 * Find duplicate candidates between two tables
 *
 * @param {Array} records1 - Records from table 1
 * @param {Array} records2 - Records from table 2
 * @param {Object} schema1 - Schema for table 1
 * @param {Object} schema2 - Schema for table 2
 * @param {Function} onProgress - Progress callback
 * @returns {Array} - Array of match candidates
 */
export function findCrossTableDuplicates(records1, records2, schema1, schema2, onProgress = null) {
  const candidates = [];

  // Find common fields between the two tables
  const commonFields = findCommonFields(schema1, schema2);

  if (commonFields.length === 0) {
    console.warn('No common fields found between tables');
    return candidates;
  }

  // Build search index for table 2 using Fuse.js
  const searchableRecords2 = records2.map(record => ({
    record,
    name: extractName(record),
    searchText: extractSearchableText(record),
  }));

  const fuse = new Fuse(searchableRecords2, {
    keys: ['name', 'searchText'],
    threshold: 0.4, // 60% similarity
    includeScore: true,
  });

  // Compare each record from table 1 against table 2
  const total = records1.length;

  for (let i = 0; i < records1.length; i++) {
    const record1 = records1[i];
    const name1 = extractName(record1);
    const searchText1 = extractSearchableText(record1);

    // Progress update
    if (onProgress && i % 50 === 0) {
      onProgress({
        phase: 'comparing',
        current: i,
        total,
        candidatesFound: candidates.length,
      });
    }

    // Search for similar records in table 2
    const matches = fuse.search(name1 || searchText1);

    for (const match of matches) {
      const record2 = match.item.record;

      // Score the similarity using common fields
      const similarity = scoreRecordSimilarity(record1, record2, commonFields);

      if (similarity.score >= 40 || similarity.matchedFields >= 2) {
        const confidence = Math.min(100, similarity.score);
        const tier = getTier(confidence);

        candidates.push({
          id: `match_${candidates.length}`,
          record1: {
            id: record1.id,
            fields: record1.fields,
            name: name1,
          },
          record2: {
            id: record2.id,
            fields: record2.fields,
            name: extractName(record2),
          },
          confidence,
          tier,
          matchedFields: similarity.matchedFields,
          reasons: similarity.reasons,
          fuseScore: match.score,
        });
      }
    }
  }

  // Sort by confidence (highest first)
  candidates.sort((a, b) => b.confidence - a.confidence);

  return candidates;
}

/**
 * Get summary statistics for match results
 */
export function getMatchStats(candidates) {
  const stats = {
    total: candidates.length,
    byTier: {
      1: candidates.filter(c => c.tier.tier === 1).length,
      2: candidates.filter(c => c.tier.tier === 2).length,
      3: candidates.filter(c => c.tier.tier === 3).length,
      4: candidates.filter(c => c.tier.tier === 4).length,
    },
    avgConfidence: candidates.length > 0
      ? Math.round(candidates.reduce((sum, c) => sum + c.confidence, 0) / candidates.length)
      : 0,
  };

  return stats;
}
