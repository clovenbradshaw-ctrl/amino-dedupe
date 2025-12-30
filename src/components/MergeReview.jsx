import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  computeFieldResolutions,
  applyFieldSelections,
  buildMergePayload,
  getMergeSummary,
  hasUnresolvedDecisions,
  RESOLUTION_STRATEGIES,
} from '../lib/merge.js';
import { AirtableClient } from '../lib/airtable.js';

/**
 * MergeReview Component
 * N-way diff view for reviewing and executing merges of 2 or more records.
 */
export default function MergeReview({
  candidate,
  schema,
  credentials,
  fieldConfig,
  onComplete,
  onSkip,
  onMarkNotDuplicate,
  onLog,
}) {
  const [resolutions, setResolutions] = useState({});
  const [merging, setMerging] = useState(false);
  const [notes, setNotes] = useState('');
  const [expandedFields, setExpandedFields] = useState(new Set());

  const log = (message, type = 'info') => {
    if (onLog) onLog(message, type);
  };

  // Get the toMerge array (supports both old and new formats)
  const toMerge = useMemo(() => {
    if (!candidate) return [];
    // New format: toMerge is an array
    if (candidate.toMerge && Array.isArray(candidate.toMerge)) {
      return candidate.toMerge;
    }
    // Old format: just merged as a single object
    if (candidate.merged) {
      return [candidate.merged];
    }
    return [];
  }, [candidate]);

  // Total records including survivor
  const recordCount = toMerge.length + 1;
  const isMultiRecord = recordCount > 2;

  // Compute initial field resolutions
  useEffect(() => {
    if (!candidate || !schema) return;

    const survivor = candidate.survivor;

    const initialResolutions = computeFieldResolutions(survivor, toMerge, schema, {
      ...fieldConfig,
      excludeFields: fieldConfig?.excludeFromMerge || [],
    });

    setResolutions(initialResolutions);
  }, [candidate, schema, fieldConfig, toMerge]);

  // Get fields that need manual decision
  const fieldsNeedingDecision = useMemo(() => {
    return Object.entries(resolutions)
      .filter(([_, r]) => r.needsDecision)
      .map(([fieldName]) => fieldName);
  }, [resolutions]);

  // Summary of merge
  const summary = useMemo(() => {
    return getMergeSummary(resolutions);
  }, [resolutions]);

  // Handle field selection - supports selecting from survivor or any merged record
  const handleFieldSelection = useCallback((fieldName, strategy, value, sourceIndex = null) => {
    setResolutions(prev => ({
      ...prev,
      [fieldName]: {
        ...prev[fieldName],
        strategy,
        value,
        needsDecision: false,
        include: true,
        selectedSource: sourceIndex, // Track which record the value came from
      },
    }));
  }, []);

  // Execute the merge
  const handleMerge = async () => {
    if (hasUnresolvedDecisions(resolutions)) {
      log('Please resolve all field conflicts before merging', 'error');
      return;
    }

    setMerging(true);

    try {
      const client = new AirtableClient(credentials.apiKey, credentials.baseId);

      // Build merge payload with all records to merge
      const payload = buildMergePayload(
        candidate.survivor,
        toMerge,
        resolutions,
        schema,
        {
          confidence: candidate.confidence,
          matchReasons: candidate.reasons,
          notes,
          performedBy: 'user',
        }
      );

      log(`Executing merge ${payload.mergeId} (${recordCount} records)...`, 'info');

      // Update survivor record
      log('Updating survivor record...', 'info');
      await client.updateRecord(
        credentials.tableName,
        candidate.survivor.record.id,
        payload.updateFields
      );
      log('Survivor record updated', 'success');

      // Delete merged record(s)
      log(`Deleting ${payload.recordsToDelete.length} merged record(s)...`, 'info');
      for (const recordId of payload.recordsToDelete) {
        await client.deleteRecord(credentials.tableName, recordId);
      }
      log(`Deleted ${payload.recordsToDelete.length} record(s)`, 'success');

      log(`Merge ${payload.mergeId} completed successfully!`, 'success');

      if (onComplete) {
        onComplete(payload);
      }
    } catch (err) {
      log(`Merge failed: ${err.message}`, 'error');
    } finally {
      setMerging(false);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.key === 'Enter' && !e.shiftKey && fieldsNeedingDecision.length === 0) {
        handleMerge();
      } else if (e.key === 'Escape') {
        onSkip && onSkip();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [fieldsNeedingDecision, handleMerge, onSkip]);

  if (!candidate) {
    return <div className="merge-review empty">Select a candidate to review</div>;
  }

  const survivorFields = candidate.survivor.record.fields;

  // Get all unique field names across all records
  const allFieldNames = useMemo(() => {
    const names = new Set([
      ...Object.keys(survivorFields),
      ...toMerge.flatMap(m => Object.keys(m.record.fields)),
    ]);
    return Array.from(names).sort();
  }, [survivorFields, toMerge]);

  return (
    <div className={`merge-review ${isMultiRecord ? 'multi-record' : ''}`}>
      {/* Header */}
      <div className="merge-header">
        <div className="match-info">
          <span
            className="confidence-badge"
            style={{ backgroundColor: candidate.tier.color }}
          >
            {candidate.confidence}%
          </span>
          <span className="tier-label">{candidate.tier.name} Match</span>
          {isMultiRecord && (
            <span className="record-count-label">{recordCount} records</span>
          )}
        </div>
        <div className="match-reasons">
          {candidate.reasons.map((reason, idx) => (
            <span key={idx} className="reason-badge">{reason}</span>
          ))}
        </div>
      </div>

      {/* Conflicts Warning */}
      {candidate.conflicts && candidate.conflicts.length > 0 && (
        <div className="conflicts-warning">
          <strong>⚠️ Data Conflicts Detected:</strong>
          <ul>
            {candidate.conflicts.map((conflict, idx) => (
              <li key={idx}>{conflict}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Record Headers */}
      <div className={`record-headers record-count-${recordCount}`}>
        <div className="record-header survivor">
          <div className="record-title">
            <span className="record-badge keep">KEEP</span>
            <span className="record-name">{candidate.survivor.name}</span>
          </div>
          <div className="record-meta">
            <span>Score: {candidate.survivor.score}</span>
            <span>ID: {candidate.survivor.record.id}</span>
          </div>
        </div>
        {toMerge.map((record, idx) => (
          <div key={record.record.id} className="record-header merged">
            <div className="record-title">
              <span className="record-badge merge">
                {toMerge.length > 1 ? `MERGE ${idx + 1}` : 'MERGE'}
              </span>
              <span className="record-name">{record.name}</span>
            </div>
            <div className="record-meta">
              <span>Score: {record.score}</span>
              <span>ID: {record.record.id}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Field Diff Table */}
      <div className="field-diff-container">
        <table className={`field-diff-table columns-${recordCount}`}>
          <thead>
            <tr>
              <th className="field-name-col">Field</th>
              <th className="field-value-col">Keep (A)</th>
              {toMerge.map((_, idx) => (
                <th key={idx} className="field-value-col">
                  {toMerge.length > 1 ? `Merge ${idx + 1}` : 'Merge (B)'}
                </th>
              ))}
              <th className="field-action-col">Resolution</th>
            </tr>
          </thead>
          <tbody>
            {allFieldNames.map(fieldName => {
              const resolution = resolutions[fieldName] || {};
              const valueA = survivorFields[fieldName];
              const mergedValues = toMerge.map(m => m.record.fields[fieldName]);
              const isComputed = resolution.isComputed;
              const isExcluded = resolution.isExcluded;
              const needsDecision = resolution.needsDecision;

              // Check if all values match
              const allValues = [valueA, ...mergedValues];
              const allValuesMatch = allValues.every(v => JSON.stringify(v) === JSON.stringify(valueA));

              return (
                <tr
                  key={fieldName}
                  className={`
                    ${isComputed ? 'computed' : ''}
                    ${isExcluded ? 'excluded' : ''}
                    ${needsDecision ? 'needs-decision' : ''}
                    ${allValuesMatch ? 'values-match' : 'values-differ'}
                  `}
                >
                  <td className="field-name">
                    <span>{fieldName}</span>
                    {isComputed && <span className="field-badge computed">computed</span>}
                    {isExcluded && <span className="field-badge excluded">excluded</span>}
                    {resolution.isLinkField && <span className="field-badge link">link</span>}
                  </td>
                  {/* Survivor value column */}
                  <td className="field-value">
                    <div
                      className={`value-cell ${resolution.selectedSource === 0 || resolution.strategy === RESOLUTION_STRATEGIES.KEEP_A ? 'selected' : ''}`}
                      onClick={() => !isComputed && !isExcluded && needsDecision && handleFieldSelection(fieldName, RESOLUTION_STRATEGIES.KEEP_A, valueA, 0)}
                    >
                      {formatValue(valueA) || <span className="empty-value">(empty)</span>}
                    </div>
                  </td>
                  {/* Merged record value columns */}
                  {mergedValues.map((val, idx) => (
                    <td key={idx} className="field-value">
                      <div
                        className={`value-cell ${resolution.selectedSource === idx + 1 || (idx === 0 && resolution.strategy === RESOLUTION_STRATEGIES.KEEP_B && resolution.selectedSource === undefined) ? 'selected' : ''}`}
                        onClick={() => !isComputed && !isExcluded && needsDecision && handleFieldSelection(fieldName, `keep_merged_${idx}`, val, idx + 1)}
                      >
                        {formatValue(val) || <span className="empty-value">(empty)</span>}
                      </div>
                    </td>
                  ))}
                  <td className="field-action">
                    {isComputed ? (
                      <span className="resolution-auto">Read-only</span>
                    ) : isExcluded ? (
                      <span className="resolution-excluded">Excluded</span>
                    ) : needsDecision ? (
                      <div className="decision-buttons">
                        <button
                          className={`btn-pick ${resolution.selectedSource === 0 || resolution.strategy === RESOLUTION_STRATEGIES.KEEP_A ? 'active' : ''}`}
                          onClick={() => handleFieldSelection(fieldName, RESOLUTION_STRATEGIES.KEEP_A, valueA, 0)}
                          title="Keep value from survivor"
                        >
                          A
                        </button>
                        {mergedValues.map((val, idx) => (
                          <button
                            key={idx}
                            className={`btn-pick ${resolution.selectedSource === idx + 1 ? 'active' : ''}`}
                            onClick={() => handleFieldSelection(fieldName, `keep_merged_${idx}`, val, idx + 1)}
                            title={`Use value from merge record ${idx + 1}`}
                          >
                            {toMerge.length > 1 ? idx + 1 : 'B'}
                          </button>
                        ))}
                      </div>
                    ) : resolution.strategy === RESOLUTION_STRATEGIES.AUTO ? (
                      <span className="resolution-auto">Auto</span>
                    ) : resolution.strategy === RESOLUTION_STRATEGIES.MERGE_LINKS ? (
                      <span className="resolution-merge">Merge ({Array.isArray(resolution.value) ? resolution.value.length : 0} links)</span>
                    ) : resolution.strategy === RESOLUTION_STRATEGIES.CONCATENATE ? (
                      <span className="resolution-concat">Concat</span>
                    ) : resolution.strategy === RESOLUTION_STRATEGIES.KEEP_A ? (
                      <span className="resolution-keep-a">← A</span>
                    ) : resolution.strategy?.startsWith('keep_merged_') || resolution.strategy === RESOLUTION_STRATEGIES.KEEP_B ? (
                      <span className="resolution-keep-b">{resolution.selectedSource !== undefined ? `← ${resolution.selectedSource}` : 'B →'}</span>
                    ) : (
                      <span className="resolution-auto">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Summary */}
      <div className="merge-summary">
        <h4>Merge Summary</h4>
        <div className="summary-grid">
          {summary.fieldsToUpdate.length > 0 && (
            <div className="summary-item">
              <span className="summary-label">Fields to update:</span>
              <span className="summary-value">{summary.fieldsToUpdate.length}</span>
            </div>
          )}
          {summary.linksAdded > 0 && (
            <div className="summary-item">
              <span className="summary-label">Links to add:</span>
              <span className="summary-value">{summary.linksAdded}</span>
            </div>
          )}
          {summary.decisionsNeeded.length > 0 && (
            <div className="summary-item warning">
              <span className="summary-label">Decisions needed:</span>
              <span className="summary-value">{summary.decisionsNeeded.length}</span>
            </div>
          )}
        </div>
      </div>

      {/* Notes */}
      <div className="merge-notes">
        <label htmlFor="merge-notes">Notes (optional):</label>
        <textarea
          id="merge-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Add any notes about this merge decision..."
          rows={2}
        />
      </div>

      {/* Actions */}
      <div className="merge-actions">
        <button
          className="btn btn-secondary"
          onClick={onSkip}
          disabled={merging}
        >
          Skip (Esc)
        </button>
        <button
          className="btn btn-warning"
          onClick={onMarkNotDuplicate}
          disabled={merging}
        >
          Not a Duplicate
        </button>
        <button
          className="btn btn-success"
          onClick={handleMerge}
          disabled={merging || fieldsNeedingDecision.length > 0}
        >
          {merging ? 'Merging...' : isMultiRecord ? `Merge ${recordCount} Records (Enter)` : 'Merge Records (Enter)'}
        </button>
      </div>

      {fieldsNeedingDecision.length > 0 && (
        <div className="decisions-reminder">
          Please select a value for: {fieldsNeedingDecision.join(', ')}
        </div>
      )}
    </div>
  );
}

/**
 * Format a field value for display
 */
function formatValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.length <= 3) return value.join(', ');
    return `${value.slice(0, 3).join(', ')} +${value.length - 3} more`;
  }
  if (typeof value === 'object') return JSON.stringify(value);
  const str = String(value);
  if (str.length > 100) return str.slice(0, 100) + '...';
  return str;
}
