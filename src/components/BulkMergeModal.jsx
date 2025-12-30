import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  computeFieldResolutions,
  buildMergePayload,
  hasUnresolvedDecisions,
  RESOLUTION_STRATEGIES,
} from '../lib/merge.js';
import { AirtableClient } from '../lib/airtable.js';

/**
 * BulkMergeModal Component
 * Handles bulk merge operations with automatic resolution for conflict-free candidates
 * and manual resolution for candidates with conflicting field values.
 */
export default function BulkMergeModal({
  candidates,
  schema,
  credentials,
  fieldConfig,
  onComplete,
  onCancel,
  onLog,
}) {
  // Processing states
  const [phase, setPhase] = useState('analyzing'); // analyzing, conflicts, processing, complete
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [results, setResults] = useState({ successful: 0, failed: 0, skipped: 0 });

  // Candidates categorized by whether they have conflicts
  const [autoMergeCandidates, setAutoMergeCandidates] = useState([]);
  const [conflictCandidates, setConflictCandidates] = useState([]);
  const [conflictResolutions, setConflictResolutions] = useState({});

  // Current conflict being resolved
  const [currentConflictIndex, setCurrentConflictIndex] = useState(0);

  const log = (message, type = 'info') => {
    if (onLog) onLog(message, type);
  };

  // Analyze candidates on mount
  useEffect(() => {
    analyzeCandidates();
  }, []);

  const analyzeCandidates = () => {
    setPhase('analyzing');
    const autoMerge = [];
    const conflicts = [];
    const resolutions = {};

    candidates.forEach(candidate => {
      // Compute field resolutions
      const fieldResolutions = computeFieldResolutions(
        candidate.survivor,
        [candidate.merged],
        schema,
        {
          ...fieldConfig,
          excludeFields: fieldConfig?.excludeFromMerge || [],
        }
      );

      // Check if there are any unresolved decisions needed
      const needsManualDecision = hasUnresolvedDecisions(fieldResolutions);

      if (needsManualDecision) {
        conflicts.push(candidate);
        resolutions[candidate.id] = fieldResolutions;
      } else {
        autoMerge.push({ candidate, resolutions: fieldResolutions });
      }
    });

    setAutoMergeCandidates(autoMerge);
    setConflictCandidates(conflicts);
    setConflictResolutions(resolutions);

    // If no conflicts, go straight to processing
    if (conflicts.length === 0) {
      setPhase('processing');
    } else {
      setPhase('conflicts');
    }
  };

  // Handle field selection for conflict resolution
  const handleFieldSelection = useCallback((candidateId, fieldName, strategy, value) => {
    setConflictResolutions(prev => ({
      ...prev,
      [candidateId]: {
        ...prev[candidateId],
        [fieldName]: {
          ...prev[candidateId][fieldName],
          strategy,
          value,
          needsDecision: false,
          include: true,
        },
      },
    }));
  }, []);

  // Get fields needing decision for current conflict
  const currentConflict = conflictCandidates[currentConflictIndex];
  const currentResolutions = currentConflict ? conflictResolutions[currentConflict.id] : {};
  const fieldsNeedingDecision = useMemo(() => {
    if (!currentResolutions) return [];
    return Object.entries(currentResolutions)
      .filter(([_, r]) => r.needsDecision)
      .map(([fieldName, r]) => ({
        fieldName,
        valueA: r.survivorValue,
        valueB: r.mergedValues?.[0]?.value || r.allValues?.[1],
      }));
  }, [currentResolutions]);

  // Check if current conflict is resolved
  const isCurrentConflictResolved = fieldsNeedingDecision.length === 0;

  // Move to next conflict or start processing
  const handleNextConflict = () => {
    if (currentConflictIndex < conflictCandidates.length - 1) {
      setCurrentConflictIndex(prev => prev + 1);
    } else {
      // All conflicts resolved, start processing
      setPhase('processing');
    }
  };

  // Skip current conflict
  const handleSkipConflict = () => {
    // Remove from conflict list and add to skipped count
    setConflictCandidates(prev => prev.filter((_, i) => i !== currentConflictIndex));
    setResults(prev => ({ ...prev, skipped: prev.skipped + 1 }));

    if (currentConflictIndex >= conflictCandidates.length - 1) {
      // Was the last one, start processing
      if (conflictCandidates.length <= 1) {
        setPhase('processing');
      }
    }
  };

  // Process all merges
  useEffect(() => {
    if (phase !== 'processing') return;

    const processAllMerges = async () => {
      const client = new AirtableClient(credentials.apiKey, credentials.baseId);

      // Combine auto-merge candidates with resolved conflict candidates
      const allToMerge = [
        ...autoMergeCandidates,
        ...conflictCandidates.map(c => ({
          candidate: c,
          resolutions: conflictResolutions[c.id],
        })),
      ];

      setProgress({ current: 0, total: allToMerge.length });
      let successful = results.successful;
      let failed = results.failed;

      for (let i = 0; i < allToMerge.length; i++) {
        const { candidate, resolutions } = allToMerge[i];
        setProgress({ current: i + 1, total: allToMerge.length });

        try {
          // Build merge payload
          const payload = buildMergePayload(
            candidate.survivor,
            [candidate.merged],
            resolutions,
            schema,
            {
              confidence: candidate.confidence,
              matchReasons: candidate.reasons,
              notes: 'Bulk merge operation',
              performedBy: 'user',
            }
          );

          log(`Merging: ${candidate.survivor.name} <- ${candidate.merged.name}`, 'info');

          // Update survivor record
          await client.updateRecord(
            credentials.tableName,
            candidate.survivor.record.id,
            payload.updateFields
          );

          // Delete merged record(s)
          for (const recordId of payload.recordsToDelete) {
            await client.deleteRecord(credentials.tableName, recordId);
          }

          successful++;
          log(`Merged successfully: ${payload.mergeId}`, 'success');
        } catch (err) {
          failed++;
          log(`Failed to merge ${candidate.survivor.name}: ${err.message}`, 'error');
        }
      }

      setResults({ successful, failed, skipped: results.skipped });
      setPhase('complete');
    };

    processAllMerges();
  }, [phase]);

  // Render based on phase
  const renderContent = () => {
    switch (phase) {
      case 'analyzing':
        return (
          <div className="bulk-merge-analyzing">
            <div className="loading-spinner">
              <div className="spinner"></div>
            </div>
            <p>Analyzing {candidates.length} candidates...</p>
          </div>
        );

      case 'conflicts':
        return (
          <div className="bulk-merge-conflicts">
            <div className="conflict-progress">
              <span>Resolving conflicts: {currentConflictIndex + 1} of {conflictCandidates.length}</span>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${((currentConflictIndex + 1) / conflictCandidates.length) * 100}%` }}
                />
              </div>
            </div>

            {autoMergeCandidates.length > 0 && (
              <div className="auto-merge-info">
                {autoMergeCandidates.length} candidates will be auto-merged (no conflicts)
              </div>
            )}

            {currentConflict && (
              <div className="conflict-resolution">
                <div className="conflict-header">
                  <div className="conflict-records">
                    <span className="record-a">{currentConflict.survivor.name}</span>
                    <span className="merge-arrow">+</span>
                    <span className="record-b">{currentConflict.merged.name}</span>
                  </div>
                  <span
                    className="confidence-badge"
                    style={{ backgroundColor: currentConflict.tier.color }}
                  >
                    {currentConflict.confidence}%
                  </span>
                </div>

                <div className="conflict-fields">
                  <h4>Choose value for each conflicting field:</h4>
                  {fieldsNeedingDecision.map(({ fieldName, valueA, valueB }) => (
                    <div key={fieldName} className="conflict-field">
                      <div className="field-name">{fieldName}</div>
                      <div className="field-choices">
                        <button
                          className={`choice-btn ${currentResolutions[fieldName]?.strategy === RESOLUTION_STRATEGIES.KEEP_A ? 'selected' : ''}`}
                          onClick={() => handleFieldSelection(currentConflict.id, fieldName, RESOLUTION_STRATEGIES.KEEP_A, valueA)}
                        >
                          <span className="choice-label">A</span>
                          <span className="choice-value">{formatValue(valueA)}</span>
                        </button>
                        <button
                          className={`choice-btn ${currentResolutions[fieldName]?.strategy === RESOLUTION_STRATEGIES.KEEP_B ? 'selected' : ''}`}
                          onClick={() => handleFieldSelection(currentConflict.id, fieldName, RESOLUTION_STRATEGIES.KEEP_B, valueB)}
                        >
                          <span className="choice-label">B</span>
                          <span className="choice-value">{formatValue(valueB)}</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="conflict-actions">
                  <button className="btn btn-secondary" onClick={handleSkipConflict}>
                    Skip This Pair
                  </button>
                  <button
                    className="btn btn-success"
                    onClick={handleNextConflict}
                    disabled={!isCurrentConflictResolved}
                  >
                    {currentConflictIndex < conflictCandidates.length - 1 ? 'Next Conflict' : 'Start Merging'}
                  </button>
                </div>
              </div>
            )}
          </div>
        );

      case 'processing':
        return (
          <div className="bulk-merge-processing">
            <div className="loading-spinner">
              <div className="spinner"></div>
            </div>
            <p>Processing merges...</p>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%` }}
              />
            </div>
            <p className="progress-text">
              {progress.current} of {progress.total} completed
            </p>
          </div>
        );

      case 'complete':
        return (
          <div className="bulk-merge-complete">
            <div className="complete-icon">
              {results.failed === 0 ? '✓' : '⚠'}
            </div>
            <h3>Bulk Merge Complete</h3>
            <div className="results-summary">
              <div className="result-item success">
                <span className="result-count">{results.successful}</span>
                <span className="result-label">Successful</span>
              </div>
              {results.failed > 0 && (
                <div className="result-item failed">
                  <span className="result-count">{results.failed}</span>
                  <span className="result-label">Failed</span>
                </div>
              )}
              {results.skipped > 0 && (
                <div className="result-item skipped">
                  <span className="result-count">{results.skipped}</span>
                  <span className="result-label">Skipped</span>
                </div>
              )}
            </div>
            <button className="btn btn-primary" onClick={() => onComplete(results)}>
              Done
            </button>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content bulk-merge-modal">
        <div className="modal-header">
          <h2>Bulk Merge</h2>
          {phase !== 'processing' && phase !== 'complete' && (
            <button className="modal-close" onClick={onCancel}>&times;</button>
          )}
        </div>
        <div className="modal-body">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}

/**
 * Format a field value for display
 */
function formatValue(value) {
  if (value === null || value === undefined) return '(empty)';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) {
    if (value.length === 0) return '(empty)';
    if (value.length <= 3) return value.join(', ');
    return `${value.slice(0, 3).join(', ')} +${value.length - 3} more`;
  }
  if (typeof value === 'object') return JSON.stringify(value);
  const str = String(value);
  if (str.length > 50) return str.slice(0, 50) + '...';
  return str;
}
