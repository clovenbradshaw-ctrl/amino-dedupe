/**
 * Case Master View Deduplication & Merge Logic
 *
 * Handles deduplication of Case Master View records with:
 * - Auto-detection of editable fields from schema
 * - Force merge mode for combining all editable data
 * - Special handling for Matter_Flatpack (append, don't overwrite)
 */

/**
 * Default configuration for Case Master merge operations
 */
export const CASE_MASTER_MERGE_CONFIG = {
  // Fields that should be appended (not overwritten)
  appendFields: ['Matter_Flatpack'],

  // Delimiter for appending field values
  appendDelimiter: '\n---\n',

  // Fields to exclude from merge (system/computed fields)
  excludeFields: [
    'Created',
    'Created By',
    'Last Modified',
    'Last Modified By',
    'Record ID',
  ],

  // Fields that are link fields (merge arrays)
  linkFieldTypes: ['multipleRecordLinks'],
};

/**
 * Detect all editable fields from schema
 * @param {Object} schema - Table schema from Airtable
 * @returns {Object} Categorized fields
 */
export function detectEditableFields(schema) {
  const result = {
    editable: [],
    computed: [],
    linkFields: [],
    appendFields: [],
    textFields: [],
    numberFields: [],
    dateFields: [],
    checkboxFields: [],
    selectFields: [],
    allFields: {},
  };

  if (!schema || !schema.allFields) {
    return result;
  }

  Object.entries(schema.allFields).forEach(([fieldName, fieldInfo]) => {
    result.allFields[fieldName] = fieldInfo;

    if (fieldInfo.isComputed) {
      result.computed.push(fieldName);
      return;
    }

    result.editable.push(fieldName);

    // Categorize by type
    switch (fieldInfo.type) {
      case 'multipleRecordLinks':
        result.linkFields.push(fieldName);
        break;
      case 'multilineText':
      case 'richText':
      case 'singleLineText':
        result.textFields.push(fieldName);
        break;
      case 'number':
      case 'currency':
      case 'percent':
        result.numberFields.push(fieldName);
        break;
      case 'date':
      case 'dateTime':
        result.dateFields.push(fieldName);
        break;
      case 'checkbox':
        result.checkboxFields.push(fieldName);
        break;
      case 'singleSelect':
      case 'multipleSelects':
        result.selectFields.push(fieldName);
        break;
      default:
        result.textFields.push(fieldName);
    }

    // Check if this is an append field
    if (CASE_MASTER_MERGE_CONFIG.appendFields.includes(fieldName)) {
      result.appendFields.push(fieldName);
    }
  });

  return result;
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
 * Append two text values together with delimiter
 */
function appendValues(val1, val2, delimiter = CASE_MASTER_MERGE_CONFIG.appendDelimiter) {
  const str1 = String(val1 || '').trim();
  const str2 = String(val2 || '').trim();

  if (!str1 && !str2) return '';
  if (!str1) return str2;
  if (!str2) return str1;
  if (str1 === str2) return str1;

  // Check if str2 is already contained in str1 (avoid duplicates)
  if (str1.includes(str2)) return str1;
  if (str2.includes(str1)) return str2;

  return `${str1}${delimiter}${str2}`;
}

/**
 * Merge two arrays, removing duplicates
 */
function mergeArrays(arr1, arr2) {
  const set = new Set([...(arr1 || []), ...(arr2 || [])]);
  return Array.from(set);
}

/**
 * Find duplicate Case Master records based on configurable fields
 * @param {Array} records - All Case Master records
 * @param {Object} options - Matching options
 * @returns {Array} Duplicate candidate groups
 */
export function findCaseMasterDuplicates(records, options = {}) {
  const {
    matchFields = [],
    fuzzyThreshold = 0.8,
  } = options;

  const duplicates = [];
  const processedPairs = new Set();

  // Build index for matching
  const recordIndex = new Map();

  records.forEach((record, idx) => {
    // Create a composite key from match fields
    const keyParts = matchFields.map(field => {
      const val = record.fields[field];
      if (isEmpty(val)) return '';
      return String(val).toLowerCase().trim();
    }).filter(Boolean);

    if (keyParts.length === 0) return;

    const key = keyParts.join('|');
    if (!recordIndex.has(key)) {
      recordIndex.set(key, []);
    }
    recordIndex.get(key).push({ record, index: idx });
  });

  // Find exact matches within groups
  recordIndex.forEach((group, key) => {
    if (group.length < 2) return;

    // All records in this group are potential duplicates
    const groupRecords = group.map(g => g.record);

    // Sort by quality/completeness
    groupRecords.sort((a, b) => scoreRecordCompleteness(b) - scoreRecordCompleteness(a));

    duplicates.push({
      id: `dup_${duplicates.length}`,
      matchKey: key,
      records: groupRecords,
      survivor: groupRecords[0],
      toMerge: groupRecords.slice(1),
      matchReason: `Matching fields: ${matchFields.join(', ')}`,
    });
  });

  return duplicates;
}

/**
 * Score a record based on completeness (more filled fields = higher score)
 */
export function scoreRecordCompleteness(record) {
  let score = 0;
  const fields = record.fields || {};

  Object.entries(fields).forEach(([key, value]) => {
    if (!isEmpty(value)) {
      // Link fields are worth more
      if (Array.isArray(value)) {
        score += value.length * 2;
      } else if (typeof value === 'string') {
        score += Math.min(value.length / 100, 5); // Cap at 5 points per text field
      } else {
        score += 1;
      }
    }
  });

  return score;
}

/**
 * Compute field resolutions for Case Master merge
 * @param {Object} survivor - Record to keep
 * @param {Array} toMerge - Records being merged
 * @param {Object} schema - Table schema
 * @param {Object} config - Merge configuration
 * @returns {Object} Field resolutions
 */
export function computeCaseMasterResolutions(survivor, toMerge, schema, config = CASE_MASTER_MERGE_CONFIG) {
  const resolutions = {};
  const editableFields = detectEditableFields(schema);
  const allFields = new Set();

  // Collect all field names from all records
  Object.keys(survivor.fields || {}).forEach(f => allFields.add(f));
  toMerge.forEach(record => {
    Object.keys(record.fields || {}).forEach(f => allFields.add(f));
  });

  allFields.forEach(fieldName => {
    const fieldInfo = editableFields.allFields[fieldName];

    // Skip if field not in schema (might be stale)
    if (!fieldInfo) {
      resolutions[fieldName] = {
        strategy: 'skip',
        include: false,
        reason: 'Field not in schema',
      };
      return;
    }

    // Skip computed fields
    if (fieldInfo.isComputed) {
      resolutions[fieldName] = {
        strategy: 'computed',
        include: false,
        reason: 'Computed field - cannot be modified',
      };
      return;
    }

    // Skip excluded fields
    if (config.excludeFields.includes(fieldName)) {
      resolutions[fieldName] = {
        strategy: 'excluded',
        include: false,
        reason: 'Field excluded from merge',
      };
      return;
    }

    const survivorValue = survivor.fields[fieldName];
    const allValues = [survivorValue, ...toMerge.map(r => r.fields[fieldName])];
    const nonEmptyValues = allValues.filter(v => !isEmpty(v));

    // Special handling for Matter_Flatpack - APPEND, don't overwrite
    if (config.appendFields.includes(fieldName)) {
      let appendedValue = '';
      nonEmptyValues.forEach(val => {
        appendedValue = appendValues(appendedValue, val, config.appendDelimiter);
      });

      resolutions[fieldName] = {
        strategy: 'append',
        value: appendedValue || null,
        include: !!appendedValue,
        survivorValue,
        mergedValues: toMerge.map(r => r.fields[fieldName]),
        reason: 'Append field - values combined',
      };
      return;
    }

    // Handle link fields - merge arrays
    if (fieldInfo.type === 'multipleRecordLinks') {
      let merged = Array.isArray(survivorValue) ? [...survivorValue] : [];

      toMerge.forEach(record => {
        const val = record.fields[fieldName];
        if (Array.isArray(val)) {
          val.forEach(id => {
            if (!merged.includes(id)) {
              merged.push(id);
            }
          });
        }
      });

      resolutions[fieldName] = {
        strategy: 'merge_links',
        value: merged.length > 0 ? merged : null,
        include: merged.length > 0,
        survivorValue,
        mergedValues: toMerge.map(r => r.fields[fieldName]),
        reason: 'Link field - arrays merged',
      };
      return;
    }

    // All values empty
    if (nonEmptyValues.length === 0) {
      resolutions[fieldName] = {
        strategy: 'empty',
        value: null,
        include: false,
        reason: 'All values empty',
      };
      return;
    }

    // All values identical
    const uniqueValues = [...new Set(nonEmptyValues.map(v => JSON.stringify(v)))];
    if (uniqueValues.length === 1) {
      resolutions[fieldName] = {
        strategy: 'identical',
        value: nonEmptyValues[0],
        include: true,
        reason: 'All values identical',
      };
      return;
    }

    // Survivor has value, use it (unless force merge mode)
    if (!isEmpty(survivorValue)) {
      resolutions[fieldName] = {
        strategy: 'keep_survivor',
        value: survivorValue,
        include: true,
        survivorValue,
        mergedValues: toMerge.map(r => r.fields[fieldName]),
        reason: 'Keeping survivor value',
        hasConflict: nonEmptyValues.length > 1,
        allValues: nonEmptyValues,
      };
      return;
    }

    // Survivor empty, use first non-empty value from merged records
    resolutions[fieldName] = {
      strategy: 'fill_empty',
      value: nonEmptyValues[0],
      include: true,
      survivorValue: null,
      mergedValues: toMerge.map(r => r.fields[fieldName]),
      reason: 'Filling empty survivor field',
    };
  });

  return resolutions;
}

/**
 * Force merge mode - combine all editable data aggressively
 * Prefers longer/more complete values, appends text fields
 * @param {Object} survivor - Record to keep
 * @param {Array} toMerge - Records being merged
 * @param {Object} schema - Table schema
 * @param {Object} config - Merge configuration
 * @returns {Object} Field resolutions for force merge
 */
export function computeForceMergeResolutions(survivor, toMerge, schema, config = CASE_MASTER_MERGE_CONFIG) {
  const resolutions = {};
  const editableFields = detectEditableFields(schema);
  const allFields = new Set();

  // Collect all field names
  Object.keys(survivor.fields || {}).forEach(f => allFields.add(f));
  toMerge.forEach(record => {
    Object.keys(record.fields || {}).forEach(f => allFields.add(f));
  });

  allFields.forEach(fieldName => {
    const fieldInfo = editableFields.allFields[fieldName];

    if (!fieldInfo) {
      resolutions[fieldName] = { strategy: 'skip', include: false };
      return;
    }

    if (fieldInfo.isComputed) {
      resolutions[fieldName] = { strategy: 'computed', include: false };
      return;
    }

    if (config.excludeFields.includes(fieldName)) {
      resolutions[fieldName] = { strategy: 'excluded', include: false };
      return;
    }

    const survivorValue = survivor.fields[fieldName];
    const allValues = [survivorValue, ...toMerge.map(r => r.fields[fieldName])];
    const nonEmptyValues = allValues.filter(v => !isEmpty(v));

    // Matter_Flatpack - ALWAYS append
    if (config.appendFields.includes(fieldName)) {
      let appendedValue = '';
      nonEmptyValues.forEach(val => {
        appendedValue = appendValues(appendedValue, val, config.appendDelimiter);
      });

      resolutions[fieldName] = {
        strategy: 'append',
        value: appendedValue || null,
        include: !!appendedValue,
        survivorValue,
        mergedValues: toMerge.map(r => r.fields[fieldName]),
        forceMerged: true,
      };
      return;
    }

    // Link fields - always merge arrays
    if (fieldInfo.type === 'multipleRecordLinks') {
      let merged = Array.isArray(survivorValue) ? [...survivorValue] : [];

      toMerge.forEach(record => {
        const val = record.fields[fieldName];
        if (Array.isArray(val)) {
          val.forEach(id => {
            if (!merged.includes(id)) {
              merged.push(id);
            }
          });
        }
      });

      resolutions[fieldName] = {
        strategy: 'merge_links',
        value: merged.length > 0 ? merged : null,
        include: merged.length > 0,
        survivorValue,
        forceMerged: true,
      };
      return;
    }

    // For text fields in force mode - concatenate if different
    if (['multilineText', 'richText', 'singleLineText'].includes(fieldInfo.type)) {
      if (nonEmptyValues.length === 0) {
        resolutions[fieldName] = { strategy: 'empty', value: null, include: false };
        return;
      }

      // Use longest value or concatenate unique values
      const uniqueStrings = [...new Set(nonEmptyValues.map(v => String(v).trim()))];

      if (uniqueStrings.length === 1) {
        resolutions[fieldName] = {
          strategy: 'identical',
          value: uniqueStrings[0],
          include: true,
        };
      } else {
        // Keep longest value for force merge (could also concatenate)
        const longest = uniqueStrings.reduce((a, b) => a.length >= b.length ? a : b, '');
        resolutions[fieldName] = {
          strategy: 'keep_longest',
          value: longest,
          include: true,
          survivorValue,
          allValues: uniqueStrings,
          forceMerged: true,
        };
      }
      return;
    }

    // For other types - keep first non-empty
    if (nonEmptyValues.length === 0) {
      resolutions[fieldName] = { strategy: 'empty', value: null, include: false };
      return;
    }

    resolutions[fieldName] = {
      strategy: 'keep_first',
      value: nonEmptyValues[0],
      include: true,
      forceMerged: nonEmptyValues.length > 1,
    };
  });

  return resolutions;
}

/**
 * Build the final merge payload
 * @param {Object} survivor - Record to keep
 * @param {Array} toMerge - Records being merged
 * @param {Object} resolutions - Field resolutions
 * @param {Object} schema - Table schema
 * @param {Object} options - Additional options
 * @returns {Object} Merge payload
 */
export function buildCaseMasterMergePayload(survivor, toMerge, resolutions, schema, options = {}) {
  const timestamp = new Date().toISOString();
  const mergeId = 'cm_mrg_' + Math.random().toString(36).substr(2, 9);

  // Build fields to update
  const updateFields = {};

  Object.entries(resolutions).forEach(([fieldName, resolution]) => {
    if (!resolution.include) return;
    if (resolution.strategy === 'computed') return;
    if (resolution.strategy === 'excluded') return;
    if (resolution.strategy === 'skip') return;

    // Only include if value is different from current
    const currentValue = survivor.fields[fieldName];
    if (JSON.stringify(currentValue) !== JSON.stringify(resolution.value)) {
      updateFields[fieldName] = resolution.value;
    }
  });

  // Build history entry for audit trail
  const historyEntry = {
    merge_id: mergeId,
    timestamp,
    action: 'case_master_merge',
    forceMode: options.forceMode || false,
    survivor_record_id: survivor.id,
    survivor_snapshot: { ...survivor.fields },
    merged_records: toMerge.map(r => ({
      original_record_id: r.id,
      field_snapshot: { ...r.fields },
    })),
    field_resolutions: resolutions,
    performed_by: options.performedBy || 'user',
    notes: options.notes || '',
  };

  return {
    mergeId,
    historyEntry,
    updateFields,
    recordsToDelete: toMerge.map(r => r.id),
    survivorId: survivor.id,
  };
}

/**
 * Get a summary of what will change in the merge
 */
export function getMergeSummary(resolutions) {
  const summary = {
    fieldsToUpdate: [],
    fieldsAppended: [],
    linksAdded: 0,
    fieldsSkipped: [],
    forceMergedFields: [],
    conflicts: [],
  };

  Object.entries(resolutions).forEach(([fieldName, resolution]) => {
    if (!resolution.include) {
      summary.fieldsSkipped.push(fieldName);
      return;
    }

    if (resolution.strategy === 'append') {
      summary.fieldsAppended.push(fieldName);
      summary.fieldsToUpdate.push(`${fieldName} (appended)`);
    } else if (resolution.strategy === 'merge_links') {
      const originalCount = Array.isArray(resolution.survivorValue) ? resolution.survivorValue.length : 0;
      const newCount = Array.isArray(resolution.value) ? resolution.value.length : 0;
      if (newCount > originalCount) {
        summary.linksAdded += (newCount - originalCount);
        summary.fieldsToUpdate.push(`${fieldName} (+${newCount - originalCount} links)`);
      }
    } else if (resolution.forceMerged) {
      summary.forceMergedFields.push(fieldName);
      summary.fieldsToUpdate.push(`${fieldName} (force merged)`);
    } else if (resolution.hasConflict) {
      summary.conflicts.push(fieldName);
    } else if (resolution.strategy !== 'identical' && resolution.strategy !== 'empty') {
      summary.fieldsToUpdate.push(fieldName);
    }
  });

  return summary;
}

/**
 * Filter records by created date range
 * @param {Array} records - All records
 * @param {Date|string} startDate - Start of date range (inclusive)
 * @param {Date|string} endDate - End of date range (inclusive)
 * @param {string} dateField - Name of the date field to filter on
 * @returns {Array} Filtered records
 */
export function filterByCreatedDate(records, startDate, endDate, dateField = 'Created') {
  if (!startDate && !endDate) return records;

  const start = startDate ? new Date(startDate) : null;
  const end = endDate ? new Date(endDate) : null;

  // Set end date to end of day
  if (end) {
    end.setHours(23, 59, 59, 999);
  }

  return records.filter(record => {
    const dateValue = record.fields[dateField];
    if (!dateValue) return false;

    const recordDate = new Date(dateValue);

    if (start && recordDate < start) return false;
    if (end && recordDate > end) return false;

    return true;
  });
}
