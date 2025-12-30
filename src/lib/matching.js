/**
 * Duplicate Detection Engine
 * Implements tiered matching with confidence scoring.
 *
 * Tier 1 (Definitive): Exact match on any unique ID → 100% confidence
 * Tier 2 (Strong): Fuzzy name + corroborating data → 85-99% confidence
 * Tier 3 (Possible): Name similarity alone → 70-84% confidence
 * Tier 4 (Investigate): Conflicting signals → flagged for investigation
 */

import Fuse from 'fuse.js';
import {
  normalizeName,
  areNamesSimilar,
  normalizePhone,
  normalizeEmail,
  normalizeAddress,
  stringSimilarity,
} from './normalize.js';

// Match tier definitions
export const MATCH_TIERS = {
  DEFINITIVE: { tier: 1, name: 'Definitive', minConfidence: 100, color: '#10b981' },
  STRONG: { tier: 2, name: 'Strong', minConfidence: 85, color: '#6366f1' },
  POSSIBLE: { tier: 3, name: 'Possible', minConfidence: 70, color: '#f59e0b' },
  INVESTIGATE: { tier: 4, name: 'Investigate', minConfidence: 0, color: '#ef4444' },
};

/**
 * Field configuration for matching
 */
export const DEFAULT_FIELD_CONFIG = {
  // Unique ID fields (Tier 1 match if exact)
  uniqueIdFields: ['PPID', 'clio_contact_id', 'A#'],

  // Name fields for fuzzy matching
  nameFields: ['Client Name', 'First Name', 'Family Name', 'Middle Name'],

  // Corroborating fields (strengthen confidence)
  corroboratingFields: ['Phone Number', 'Client Email', 'DOB', 'Address', 'Address Line 1'],

  // Fields to exclude from merging (computed, system, or special handling)
  excludeFromMerge: [
    'Box Legacy ID',
  ],

  // Fields to concatenate instead of pick-one during merge
  concatenateFields: ['Client Notes'],

  // Link fields that should merge by combining all linked records
  linkFields: ['Case Master View', 'Events', 'Relationships', 'Matters'],
};

/**
 * Extract a normalized "match key" from a record for grouping candidates
 */
export function getMatchKey(record, config = DEFAULT_FIELD_CONFIG) {
  const fields = record.fields || {};

  // Try to build key from First Name + Family Name
  const firstName = (fields['First Name'] || '').toLowerCase().trim();
  const familyName = (fields['Family Name'] || '').toLowerCase().trim();

  if (firstName && familyName) {
    return normalizeName(`${firstName} ${familyName}`).canonical;
  }

  // Fall back to Client Name
  const clientName = fields['Client Name'] || '';
  if (clientName) {
    return normalizeName(clientName).canonical;
  }

  return null;
}

/**
 * Score a potential match between two records
 * Returns: { tier, confidence, reasons, conflicts }
 */
export function scoreMatch(recordA, recordB, config = DEFAULT_FIELD_CONFIG) {
  const fieldsA = recordA.fields || {};
  const fieldsB = recordB.fields || {};
  const reasons = [];
  const conflicts = [];
  let confidence = 0;

  // Check Tier 1: Exact ID match
  for (const idField of config.uniqueIdFields) {
    const valA = fieldsA[idField];
    const valB = fieldsB[idField];

    if (valA && valB) {
      if (valA === valB) {
        reasons.push(`${idField} exact match`);
        confidence = Math.max(confidence, 100);
      } else {
        // Conflicting IDs - flag for investigation
        conflicts.push(`${idField} conflict: "${valA}" vs "${valB}"`);
      }
    }
  }

  // If we have conflicts, this is Tier 4
  if (conflicts.length > 0) {
    return {
      tier: MATCH_TIERS.INVESTIGATE,
      confidence: Math.max(confidence, 50),
      reasons,
      conflicts,
      isConflict: true,
    };
  }

  // If we have a definitive ID match, return Tier 1
  if (confidence >= 100) {
    return {
      tier: MATCH_TIERS.DEFINITIVE,
      confidence: 100,
      reasons,
      conflicts,
      isConflict: false,
    };
  }

  // Check name similarity
  const nameA = buildFullName(fieldsA);
  const nameB = buildFullName(fieldsB);

  if (nameA && nameB) {
    const nameMatch = areNamesSimilar(nameA, nameB, 75);
    if (nameMatch.match) {
      reasons.push(`Name: ${nameMatch.score}% (${nameMatch.reason})`);
      confidence = Math.max(confidence, nameMatch.score);
    }
  }

  // Check corroborating fields
  let corroborationCount = 0;

  // Phone match
  const phoneA = normalizePhone(fieldsA['Phone Number']);
  const phoneB = normalizePhone(fieldsB['Phone Number']);
  if (phoneA && phoneB && phoneA.length >= 10 && phoneA === phoneB) {
    reasons.push('Phone exact match');
    corroborationCount++;
    confidence = Math.min(100, confidence + 10);
  }

  // Email match
  const emailA = normalizeEmail(fieldsA['Client Email']);
  const emailB = normalizeEmail(fieldsB['Client Email']);
  if (emailA && emailB && !emailA.includes('null@blank') && emailA === emailB) {
    reasons.push('Email exact match');
    corroborationCount++;
    confidence = Math.min(100, confidence + 10);
  }

  // DOB match
  const dobA = fieldsA['DOB'];
  const dobB = fieldsB['DOB'];
  if (dobA && dobB && dobA === dobB) {
    reasons.push('DOB exact match');
    corroborationCount++;
    confidence = Math.min(100, confidence + 15);
  }

  // Address similarity
  const addrA = normalizeAddress(fieldsA['Address'] || fieldsA['Address Line 1']);
  const addrB = normalizeAddress(fieldsB['Address'] || fieldsB['Address Line 1']);
  if (addrA && addrB) {
    const addrSim = stringSimilarity(addrA, addrB);
    if (addrSim >= 80) {
      reasons.push(`Address: ${addrSim}% similar`);
      corroborationCount++;
      confidence = Math.min(100, confidence + 5);
    }
  }

  // Determine tier based on confidence and corroboration
  let tier;
  if (confidence >= 100) {
    tier = MATCH_TIERS.DEFINITIVE;
  } else if (confidence >= 85 || (confidence >= 75 && corroborationCount >= 1)) {
    tier = MATCH_TIERS.STRONG;
  } else if (confidence >= 70) {
    tier = MATCH_TIERS.POSSIBLE;
  } else {
    tier = MATCH_TIERS.POSSIBLE;
    confidence = Math.max(confidence, 70); // Floor for any match
  }

  return {
    tier,
    confidence: Math.round(confidence),
    reasons,
    conflicts,
    isConflict: false,
  };
}

/**
 * Build full name from fields
 */
function buildFullName(fields) {
  const parts = [
    fields['First Name'],
    fields['Middle Name'],
    fields['Family Name'],
  ].filter(Boolean);

  if (parts.length > 0) {
    return parts.join(' ');
  }

  return fields['Client Name'] || fields['Full_Name_Normal_Pretty'] || '';
}

/**
 * Score a record for "quality" - higher = more complete = better to keep
 */
export function scoreRecordQuality(record) {
  const fields = record.fields || {};
  let score = 0;

  // Core identity fields (high value)
  if (fields['A#']?.trim()) score += 50;
  if (fields['DOB']) score += 30;
  if (fields['clio_contact_id']) score += 25;
  if (fields['PPID']) score += 20;

  // Box folder info (indicates linked documents)
  if (fields['Box_Folder_ID']) score += 40;
  if (fields['box_shared_link']) score += 10;

  // Contact info
  if (fields['Phone Number']?.trim()) score += 15;
  if (fields['Client Email']?.trim() && !fields['Client Email'].includes('null@blank')) score += 15;

  // Address completeness
  if (fields['Address Line 1'] || fields['Address']) score += 10;
  if (fields['City']) score += 5;
  if (fields['State']) score += 5;
  if (fields['Zip (5)']) score += 5;

  // Linked records (very high value - indicates real activity)
  const caseViews = fields['Case Master View'] || [];
  score += caseViews.length * 100;

  const events = fields['Events'] || [];
  score += events.length * 50;

  const relationships = fields['Relationships'] || [];
  score += relationships.length * 30;

  const matters = fields['Matters'] || [];
  score += matters.length * 80;

  const notes = fields['Client Notes'] || [];
  score += notes.length * 20;

  // Name completeness
  if (fields['First Name']) score += 5;
  if (fields['Middle Name']) score += 3;
  if (fields['Family Name']) score += 5;

  // Entry date (older records may be more established)
  if (fields['Entry Date']) score += 10;

  return score;
}

/**
 * Find all duplicate candidates in a list of records
 * Returns grouped candidates with match scores
 */
export function findDuplicateCandidates(records, config = DEFAULT_FIELD_CONFIG, onProgress = null) {
  const candidates = [];
  const processedPairs = new Set();

  // Group records by approximate match key for efficiency
  const keyGroups = new Map();

  records.forEach((record, idx) => {
    const key = getMatchKey(record, config);
    if (!key) return;

    if (!keyGroups.has(key)) {
      keyGroups.set(key, []);
    }
    keyGroups.get(key).push({ record, index: idx });
  });

  // Find duplicates within each group
  let groupsProcessed = 0;
  const totalGroups = keyGroups.size;

  keyGroups.forEach((group, key) => {
    if (group.length < 2) {
      groupsProcessed++;
      return;
    }

    // Compare each pair within the group
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const pairKey = [group[i].record.id, group[j].record.id].sort().join('|');

        if (processedPairs.has(pairKey)) continue;
        processedPairs.add(pairKey);

        const matchResult = scoreMatch(group[i].record, group[j].record, config);

        if (matchResult.confidence >= 70 || matchResult.isConflict) {
          // Score both records for quality
          const scoreA = scoreRecordQuality(group[i].record);
          const scoreB = scoreRecordQuality(group[j].record);

          // Determine which is the survivor (higher score)
          const [survivor, merged] = scoreA >= scoreB
            ? [group[i], group[j]]
            : [group[j], group[i]];

          candidates.push({
            id: `match_${candidates.length}`,
            matchKey: key,
            ...matchResult,
            survivor: {
              record: survivor.record,
              score: scoreA >= scoreB ? scoreA : scoreB,
              name: buildFullName(survivor.record.fields),
            },
            merged: {
              record: merged.record,
              score: scoreA >= scoreB ? scoreB : scoreA,
              name: buildFullName(merged.record.fields),
            },
          });
        }
      }
    }

    groupsProcessed++;
    if (onProgress && groupsProcessed % 100 === 0) {
      onProgress({
        phase: 'matching',
        current: groupsProcessed,
        total: totalGroups,
        candidatesFound: candidates.length,
      });
    }
  });

  // Also use Fuse.js for fuzzy matching across different keys
  const fuseRecords = records.map((record, idx) => ({
    record,
    index: idx,
    searchName: buildFullName(record.fields),
  })).filter(r => r.searchName);

  const fuse = new Fuse(fuseRecords, {
    keys: ['searchName'],
    threshold: 0.3, // 70% similarity
    includeScore: true,
  });

  // Search for fuzzy matches
  fuseRecords.forEach((item, idx) => {
    if (idx % 100 === 0 && onProgress) {
      onProgress({
        phase: 'fuzzy',
        current: idx,
        total: fuseRecords.length,
        candidatesFound: candidates.length,
      });
    }

    const matches = fuse.search(item.searchName);

    matches.forEach(match => {
      if (match.refIndex === idx) return; // Skip self

      const pairKey = [item.record.id, match.item.record.id].sort().join('|');
      if (processedPairs.has(pairKey)) return;
      processedPairs.add(pairKey);

      const matchResult = scoreMatch(item.record, match.item.record, config);

      if (matchResult.confidence >= 70 || matchResult.isConflict) {
        const scoreA = scoreRecordQuality(item.record);
        const scoreB = scoreRecordQuality(match.item.record);

        const [survivor, merged] = scoreA >= scoreB
          ? [item, match.item]
          : [match.item, item];

        candidates.push({
          id: `match_${candidates.length}`,
          matchKey: normalizeName(item.searchName).canonical,
          ...matchResult,
          survivor: {
            record: survivor.record,
            score: scoreA >= scoreB ? scoreA : scoreB,
            name: buildFullName(survivor.record.fields),
          },
          merged: {
            record: merged.record,
            score: scoreA >= scoreB ? scoreB : scoreA,
            name: buildFullName(merged.record.fields),
          },
        });
      }
    });
  });

  // Sort by tier (lowest first = most confident) then by confidence (highest first)
  candidates.sort((a, b) => {
    if (a.tier.tier !== b.tier.tier) {
      return a.tier.tier - b.tier.tier;
    }
    return b.confidence - a.confidence;
  });

  return candidates;
}

/**
 * Group multiple candidates that reference the same records into merge groups
 * This handles cases where A matches B, and B matches C → group all three
 */
export function groupCandidates(candidates) {
  const recordToGroup = new Map();
  const groups = [];

  candidates.forEach(candidate => {
    const survivorId = candidate.survivor.record.id;
    const mergedId = candidate.merged.record.id;

    const survivorGroup = recordToGroup.get(survivorId);
    const mergedGroup = recordToGroup.get(mergedId);

    if (!survivorGroup && !mergedGroup) {
      // Create new group
      const group = {
        id: `group_${groups.length}`,
        records: [candidate.survivor, candidate.merged],
        matches: [candidate],
        bestTier: candidate.tier,
        highestConfidence: candidate.confidence,
      };
      groups.push(group);
      recordToGroup.set(survivorId, group);
      recordToGroup.set(mergedId, group);
    } else if (survivorGroup && !mergedGroup) {
      // Add merged to survivor's group
      survivorGroup.records.push(candidate.merged);
      survivorGroup.matches.push(candidate);
      survivorGroup.highestConfidence = Math.max(survivorGroup.highestConfidence, candidate.confidence);
      if (candidate.tier.tier < survivorGroup.bestTier.tier) {
        survivorGroup.bestTier = candidate.tier;
      }
      recordToGroup.set(mergedId, survivorGroup);
    } else if (!survivorGroup && mergedGroup) {
      // Add survivor to merged's group
      mergedGroup.records.push(candidate.survivor);
      mergedGroup.matches.push(candidate);
      mergedGroup.highestConfidence = Math.max(mergedGroup.highestConfidence, candidate.confidence);
      if (candidate.tier.tier < mergedGroup.bestTier.tier) {
        mergedGroup.bestTier = candidate.tier;
      }
      recordToGroup.set(survivorId, mergedGroup);
    } else if (survivorGroup !== mergedGroup) {
      // Merge the two groups
      mergedGroup.records.forEach(r => {
        if (!survivorGroup.records.find(sr => sr.record.id === r.record.id)) {
          survivorGroup.records.push(r);
        }
        recordToGroup.set(r.record.id, survivorGroup);
      });
      survivorGroup.matches.push(...mergedGroup.matches, candidate);
      survivorGroup.highestConfidence = Math.max(survivorGroup.highestConfidence, mergedGroup.highestConfidence, candidate.confidence);
      if (mergedGroup.bestTier.tier < survivorGroup.bestTier.tier) {
        survivorGroup.bestTier = mergedGroup.bestTier;
      }
      // Remove the merged group
      const idx = groups.indexOf(mergedGroup);
      if (idx > -1) groups.splice(idx, 1);
    } else {
      // Both already in same group, just add the match
      survivorGroup.matches.push(candidate);
    }
  });

  // For each group, determine the best survivor (highest quality score)
  groups.forEach(group => {
    // Remove duplicates from records
    const seen = new Set();
    group.records = group.records.filter(r => {
      if (seen.has(r.record.id)) return false;
      seen.add(r.record.id);
      return true;
    });

    // Sort by quality score descending
    group.records.sort((a, b) => b.score - a.score);

    // Best record is the survivor
    group.survivor = group.records[0];
    group.toMerge = group.records.slice(1);
  });

  return groups;
}
