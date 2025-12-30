/**
 * Merge/Unmerge Operations with Full History Tracking
 *
 * All merge operations create an immutable audit record in the `dedupe_history` field.
 * The history supports full reconstruction of original records for unmerge operations.
 */

// Generate a short unique ID for merge events
function generateMergeId() {
  return 'mrg_' + Math.random().toString(36).substr(2, 9);
}

/**
 * Field resolution strategies
 */
export const RESOLUTION_STRATEGIES = {
  KEEP_A: 'keep_a',           // Keep value from survivor (record A)
  KEEP_B: 'keep_b',           // Keep value from merged record (record B)
  KEEP_LONGEST: 'keep_longest', // Keep the longer/more complete value
  KEEP_NONEMPTY: 'keep_nonempty', // Keep first non-empty value
  CONCATENATE: 'concatenate', // Concatenate with delimiter
  MERGE_LINKS: 'merge_links', // Combine all linked record IDs
  MANUAL: 'manual',           // User must decide
  AUTO: 'auto',               // System decided (for identical values)
};

/**
 * Default field resolution configuration
 */
export const DEFAULT_RESOLUTION_CONFIG = {
  // Fields that should concatenate values
  concatenateFields: ['Client Notes'],

  // Fields that should merge linked record arrays
  linkFields: ['Case Master View', 'Events', 'Relationships', 'Matters', 'Client Notes'],

  // Fields to exclude from merge entirely
  excludeFields: ['Box Legacy ID'],

  // Delimiter for concatenation
  concatenateDelimiter: ' | ',
};

/**
 * Compare two field values and determine the best resolution
 */
export function resolveFieldValue(fieldName, valueA, valueB, config = DEFAULT_RESOLUTION_CONFIG) {
  // If field is excluded, don't include in merge
  if (config.excludeFields.includes(fieldName)) {
    return { strategy: 'excluded', value: null, include: false };
  }

  // If both are empty/null, nothing to merge
  if (isEmpty(valueA) && isEmpty(valueB)) {
    return { strategy: RESOLUTION_STRATEGIES.AUTO, value: null, include: false };
  }

  // If values are identical, auto-select
  if (JSON.stringify(valueA) === JSON.stringify(valueB)) {
    return { strategy: RESOLUTION_STRATEGIES.AUTO, value: valueA, include: true };
  }

  // If one is empty, keep the non-empty one
  if (isEmpty(valueA) && !isEmpty(valueB)) {
    return { strategy: RESOLUTION_STRATEGIES.KEEP_B, value: valueB, include: true };
  }
  if (!isEmpty(valueA) && isEmpty(valueB)) {
    return { strategy: RESOLUTION_STRATEGIES.KEEP_A, value: valueA, include: true };
  }

  // Both have values - determine strategy based on field type
  if (config.linkFields.includes(fieldName)) {
    // Merge arrays of linked records
    const merged = mergeArrays(valueA, valueB);
    return { strategy: RESOLUTION_STRATEGIES.MERGE_LINKS, value: merged, include: true };
  }

  if (config.concatenateFields.includes(fieldName)) {
    // Concatenate text values
    const concatenated = concatenateValues(valueA, valueB, config.concatenateDelimiter);
    return { strategy: RESOLUTION_STRATEGIES.CONCATENATE, value: concatenated, include: true };
  }

  // For other fields with different values, require manual selection
  return {
    strategy: RESOLUTION_STRATEGIES.MANUAL,
    valueA,
    valueB,
    include: true,
    needsDecision: true,
  };
}

/**
 * Check if a value is empty
 */
function isEmpty(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

/**
 * Merge two arrays, removing duplicates
 */
function mergeArrays(arr1, arr2) {
  const set = new Set([...(arr1 || []), ...(arr2 || [])]);
  return Array.from(set);
}

/**
 * Concatenate two values with a delimiter
 */
function concatenateValues(val1, val2, delimiter) {
  const str1 = String(val1 || '').trim();
  const str2 = String(val2 || '').trim();

  if (!str1) return str2;
  if (!str2) return str1;
  if (str1 === str2) return str1;

  return `${str1}${delimiter}${str2}`;
}

/**
 * Build the merge payload and history entry
 *
 * @param {Object} survivor - The record to keep (will be updated)
 * @param {Array} toMerge - Array of records being merged into survivor
 * @param {Object} fieldDecisions - User's decisions for each field
 * @param {Object} schema - Table schema from Airtable
 * @param {Object} options - Additional options (notes, performedBy, etc.)
 */
export function buildMergePayload(survivor, toMerge, fieldDecisions, schema, options = {}) {
  const timestamp = new Date().toISOString();
  const mergeId = generateMergeId();

  // Build the history entry
  const historyEntry = {
    merge_id: mergeId,
    timestamp,
    action: 'merge',
    confidence: options.confidence || null,
    match_reasons: options.matchReasons || [],
    survivor_record_id: survivor.record.id,
    merged_records: toMerge.map(m => ({
      original_record_id: m.record.id,
      field_snapshot: { ...m.record.fields },
      linked_records: extractLinkedRecords(m.record.fields, schema),
    })),
    field_decisions: fieldDecisions,
    performed_by: options.performedBy || 'user',
    notes: options.notes || '',
  };

  // Build the fields to update on survivor
  const updateFields = {};

  Object.entries(fieldDecisions).forEach(([fieldName, decision]) => {
    if (!decision.include) return;
    if (schema.computedFields.includes(fieldName)) return;
    if (DEFAULT_RESOLUTION_CONFIG.excludeFields.includes(fieldName)) return;

    updateFields[fieldName] = decision.value;
  });

  // Get existing history from survivor
  const existingHistory = parseDedupeHistory(survivor.record.fields.dedupe_history);

  // Append new entry
  existingHistory.push(historyEntry);

  // Update the dedupe_history field
  updateFields.dedupe_history = JSON.stringify(existingHistory, null, 2);

  return {
    mergeId,
    historyEntry,
    updateFields,
    recordsToDelete: toMerge.map(m => m.record.id),
  };
}

/**
 * Extract linked record IDs from fields
 */
function extractLinkedRecords(fields, schema) {
  const linked = {};

  if (!schema) return linked;

  schema.linkFields.forEach(fieldName => {
    const value = fields[fieldName];
    if (Array.isArray(value) && value.length > 0) {
      linked[fieldName] = value;
    }
  });

  return linked;
}

/**
 * Parse existing dedupe_history field
 */
export function parseDedupeHistory(historyField) {
  if (!historyField) return [];

  try {
    const parsed = JSON.parse(historyField);
    // Handle both array format and object with history array
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed.dedupe_history && Array.isArray(parsed.dedupe_history)) {
      return parsed.dedupe_history;
    }
    // Legacy format with _merge_history
    if (parsed._merge_history && Array.isArray(parsed._merge_history)) {
      return parsed._merge_history;
    }
    return [];
  } catch (e) {
    console.error('Failed to parse dedupe_history:', e);
    return [];
  }
}

/**
 * Build unmerge payload to restore a previously merged record
 *
 * @param {Object} survivor - Current survivor record
 * @param {string} mergeId - ID of the merge event to undo
 * @param {Object} schema - Table schema
 */
export function buildUnmergePayload(survivor, mergeId, schema) {
  const history = parseDedupeHistory(survivor.fields.dedupe_history);
  const mergeEvent = history.find(h => h.merge_id === mergeId);

  if (!mergeEvent) {
    throw new Error(`Merge event ${mergeId} not found in history`);
  }

  const timestamp = new Date().toISOString();
  const unmergeId = generateMergeId().replace('mrg_', 'unmrg_');

  // Records to recreate
  const recordsToCreate = mergeEvent.merged_records.map(merged => {
    // Filter out computed fields from snapshot
    const createFields = {};
    Object.entries(merged.field_snapshot).forEach(([key, value]) => {
      if (!schema.computedFields.includes(key)) {
        createFields[key] = value;
      }
    });

    return {
      originalId: merged.original_record_id,
      fields: createFields,
      linkedRecords: merged.linked_records,
    };
  });

  // Determine which fields on survivor need to be reverted
  // This is complex because the survivor may have had subsequent edits
  // For now, we'll just restore linked records that were added from merged records
  const survivorUpdates = {};

  // Build history for the unmerged records
  const unmergeHistoryEntry = {
    merge_id: unmergeId,
    timestamp,
    action: 'unmerge',
    original_merge_id: mergeId,
    survivor_record_id: survivor.id,
    restored_records: mergeEvent.merged_records.map(m => m.original_record_id),
    performed_by: 'user',
    notes: `Unmerge of ${mergeId}`,
  };

  // Update survivor's history
  const updatedHistory = [...history, unmergeHistoryEntry];
  survivorUpdates.dedupe_history = JSON.stringify(updatedHistory, null, 2);

  return {
    unmergeId,
    mergeEvent,
    recordsToCreate,
    survivorUpdates,
    unmergeHistoryEntry,
  };
}

/**
 * Compute all field resolutions for a merge operation
 */
export function computeFieldResolutions(survivor, toMerge, schema, config = DEFAULT_RESOLUTION_CONFIG) {
  const resolutions = {};
  const allFields = new Set();

  // Collect all field names
  Object.keys(survivor.record.fields).forEach(f => allFields.add(f));
  toMerge.forEach(m => {
    Object.keys(m.record.fields).forEach(f => allFields.add(f));
  });

  allFields.forEach(fieldName => {
    // Skip computed fields
    if (schema.computedFields.includes(fieldName)) {
      resolutions[fieldName] = {
        strategy: 'computed',
        include: false,
        isComputed: true,
      };
      return;
    }

    // Skip excluded fields
    if (config.excludeFields.includes(fieldName)) {
      resolutions[fieldName] = {
        strategy: 'excluded',
        include: false,
        isExcluded: true,
      };
      return;
    }

    const survivorValue = survivor.record.fields[fieldName];

    // For link fields, merge all values from all records
    if (config.linkFields.includes(fieldName) || schema.linkFields.includes(fieldName)) {
      let merged = Array.isArray(survivorValue) ? [...survivorValue] : [];

      toMerge.forEach(m => {
        const val = m.record.fields[fieldName];
        if (Array.isArray(val)) {
          val.forEach(id => {
            if (!merged.includes(id)) {
              merged.push(id);
            }
          });
        }
      });

      resolutions[fieldName] = {
        strategy: RESOLUTION_STRATEGIES.MERGE_LINKS,
        value: merged.length > 0 ? merged : null,
        include: merged.length > 0,
        survivorValue,
        mergedValues: toMerge.map(m => m.record.fields[fieldName]),
        isLinkField: true,
      };
      return;
    }

    // For concatenate fields, combine all values
    if (config.concatenateFields.includes(fieldName)) {
      let parts = [];
      if (!isEmpty(survivorValue)) parts.push(String(survivorValue));

      toMerge.forEach(m => {
        const val = m.record.fields[fieldName];
        if (!isEmpty(val) && !parts.includes(String(val))) {
          parts.push(String(val));
        }
      });

      const concatenated = parts.join(config.concatenateDelimiter);

      resolutions[fieldName] = {
        strategy: RESOLUTION_STRATEGIES.CONCATENATE,
        value: concatenated || null,
        include: !!concatenated,
        survivorValue,
        mergedValues: toMerge.map(m => m.record.fields[fieldName]),
      };
      return;
    }

    // For other fields, check if all values are the same
    const allValues = [survivorValue, ...toMerge.map(m => m.record.fields[fieldName])];
    const nonEmptyValues = allValues.filter(v => !isEmpty(v));

    if (nonEmptyValues.length === 0) {
      // All empty
      resolutions[fieldName] = {
        strategy: RESOLUTION_STRATEGIES.AUTO,
        value: null,
        include: false,
      };
      return;
    }

    // Check if all non-empty values are the same
    const uniqueValues = [...new Set(nonEmptyValues.map(v => JSON.stringify(v)))];

    if (uniqueValues.length === 1) {
      // All same value
      resolutions[fieldName] = {
        strategy: RESOLUTION_STRATEGIES.AUTO,
        value: nonEmptyValues[0],
        include: true,
        survivorValue,
      };
      return;
    }

    // Values differ - needs manual decision
    resolutions[fieldName] = {
      strategy: RESOLUTION_STRATEGIES.MANUAL,
      value: null, // Will be set by user
      include: true,
      needsDecision: true,
      survivorValue,
      mergedValues: toMerge.map(m => ({
        recordId: m.record.id,
        name: m.name,
        value: m.record.fields[fieldName],
      })),
      allValues: nonEmptyValues,
    };
  });

  return resolutions;
}

/**
 * Apply user's field selections to resolutions
 */
export function applyFieldSelections(resolutions, selections) {
  const updated = { ...resolutions };

  Object.entries(selections).forEach(([fieldName, selection]) => {
    if (updated[fieldName]) {
      updated[fieldName] = {
        ...updated[fieldName],
        strategy: selection.strategy,
        value: selection.value,
        include: selection.include !== false,
        needsDecision: false,
      };
    }
  });

  return updated;
}

/**
 * Check if all required decisions have been made
 */
export function hasUnresolvedDecisions(resolutions) {
  return Object.values(resolutions).some(r => r.needsDecision);
}

/**
 * Get a summary of what will happen in the merge
 */
export function getMergeSummary(resolutions) {
  const summary = {
    fieldsToUpdate: [],
    fieldsKept: [],
    fieldsSkipped: [],
    linksAdded: 0,
    valuesConcatenated: [],
    decisionsNeeded: [],
  };

  Object.entries(resolutions).forEach(([fieldName, resolution]) => {
    if (resolution.isComputed || resolution.isExcluded) {
      summary.fieldsSkipped.push(fieldName);
      return;
    }

    if (resolution.needsDecision) {
      summary.decisionsNeeded.push(fieldName);
      return;
    }

    if (!resolution.include) {
      summary.fieldsSkipped.push(fieldName);
      return;
    }

    if (resolution.strategy === RESOLUTION_STRATEGIES.MERGE_LINKS) {
      const originalCount = Array.isArray(resolution.survivorValue) ? resolution.survivorValue.length : 0;
      const newCount = Array.isArray(resolution.value) ? resolution.value.length : 0;
      if (newCount > originalCount) {
        summary.linksAdded += (newCount - originalCount);
        summary.fieldsToUpdate.push(`${fieldName} (+${newCount - originalCount} links)`);
      }
    } else if (resolution.strategy === RESOLUTION_STRATEGIES.CONCATENATE) {
      summary.valuesConcatenated.push(fieldName);
      summary.fieldsToUpdate.push(fieldName);
    } else if (resolution.strategy === RESOLUTION_STRATEGIES.KEEP_B) {
      summary.fieldsToUpdate.push(`${fieldName} (from merged record)`);
    } else if (resolution.strategy === RESOLUTION_STRATEGIES.AUTO) {
      summary.fieldsKept.push(fieldName);
    } else {
      summary.fieldsToUpdate.push(fieldName);
    }
  });

  return summary;
}
