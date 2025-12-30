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
 * and multiple options for handling candidates with conflicts.
 *
 * Features:
 * - Summary view showing auto-merge vs conflict counts
 * - "Merge Auto Only" - process only conflict-free candidates
 * - "Apply A/B to All" - batch resolve all conflicts with survivor or merged values
 * - Skip conflicts option during individual resolution
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
  // Processing states: summary -> conflicts (optional) -> processing -> complete
  const [phase, setPhase] = useState('analyzing');
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [results, setResults] = useState({ successful: 0, failed: 0, skipped: 0 });

  // Candidates categorized by whether they have conflicts
  const [autoMergeCandidates, setAutoMergeCandidates] = useState([]);
  const [conflictCandidates, setConflictCandidates] = useState([]);
  const [conflictResolutions, setConflictResolutions] = useState({});

  // Track which candidates to actually merge (user may choose to skip conflicts)
  const [candidatesToMerge, setCandidatesToMerge] = useState([]);

  // Current conflict being resolved (for individual resolution mode)
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

    // Go to summary phase
    setPhase('summary');
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

  // Apply a strategy to ALL conflicts (batch resolution)
  const applyToAllConflicts = useCallback((preferSurvivor) => {
    const strategy = preferSurvivor ? RESOLUTION_STRATEGIES.KEEP_A : RESOLUTION_STRATEGIES.KEEP_B;

    setConflictResolutions(prev => {
      const updated = { ...prev };

      conflictCandidates.forEach(candidate => {
        const candidateResolutions = { ...updated[candidate.id] };

        Object.entries(candidateResolutions).forEach(([fieldName, resolution]) => {
          if (resolution.needsDecision) {
            const value = preferSurvivor ? resolution.survivorValue :
              (resolution.mergedValues?.[0]?.value || resolution.allValues?.[1]);

            candidateResolutions[fieldName] = {
              ...resolution,
              strategy,
              value,
              needsDecision: false,
              include: true,
            };
          }
        });

        updated[candidate.id] = candidateResolutions;
      });

      return updated;
    });
  }, [conflictCandidates]);

  // Start processing with only auto-merge candidates
  const handleMergeAutoOnly = () => {
    setCandidatesToMerge(autoMergeCandidates);
    setResults(prev => ({ ...prev, skipped: conflictCandidates.length }));
    setPhase('processing');
  };

  // Start processing all candidates after batch resolution
  const handleMergeAllWithStrategy = (preferSurvivor) => {
    applyToAllConflicts(preferSurvivor);
    // Small delay to let state update
    setTimeout(() => {
      const allToMerge = [
        ...autoMergeCandidates,
        ...conflictCandidates.map(c => ({
          candidate: c,
          resolutions: conflictResolutions[c.id],
        })),
      ];
      setCandidatesToMerge(allToMerge);
      setPhase('processing');
    }, 100);
  };

  // Start individual conflict resolution
  const handleResolveIndividually = () => {
    if (conflictCandidates.length === 0) {
      // No conflicts, go straight to processing
      setCandidatesToMerge(autoMergeCandidates);
      setPhase('processing');
    } else {
      setCurrentConflictIndex(0);
      setPhase('conflicts');
    }
  };

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
      const allToMerge = [
        ...autoMergeCandidates,
        ...conflictCandidates.map(c => ({
          candidate: c,
          resolutions: conflictResolutions[c.id],
        })),
      ];
      setCandidatesToMerge(allToMerge);
      setPhase('processing');
    }
  };

  // Skip current conflict
  const handleSkipConflict = () => {
    setResults(prev => ({ ...prev, skipped: prev.skipped + 1 }));

    if (currentConflictIndex < conflictCandidates.length - 1) {
      // Move to next conflict
      setCurrentConflictIndex(prev => prev + 1);
    } else {
      // Was the last conflict, start processing with remaining
      const resolvedConflicts = conflictCandidates
        .filter((c, i) => i !== currentConflictIndex)
        .filter(c => !hasUnresolvedDecisions(conflictResolutions[c.id]))
        .map(c => ({
          candidate: c,
          resolutions: conflictResolutions[c.id],
        }));

      setCandidatesToMerge([...autoMergeCandidates, ...resolvedConflicts]);
      setPhase('processing');
    }
  };

  // Skip all remaining conflicts
  const handleSkipAllRemaining = () => {
    const remaining = conflictCandidates.length - currentConflictIndex;
    setResults(prev => ({ ...prev, skipped: prev.skipped + remaining }));

    // Get all resolved conflicts before current
    const resolvedConflicts = conflictCandidates
      .slice(0, currentConflictIndex)
      .filter(c => !hasUnresolvedDecisions(conflictResolutions[c.id]))
      .map(c => ({
        candidate: c,
        resolutions: conflictResolutions[c.id],
      }));

    setCandidatesToMerge([...autoMergeCandidates, ...resolvedConflicts]);
    setPhase('processing');
  };

  // Process all merges
  useEffect(() => {
    if (phase !== 'processing') return;

    const processAllMerges = async () => {
      const client = new AirtableClient(credentials.apiKey, credentials.baseId);

      // Use candidatesToMerge which was set before entering processing phase
      const allToMerge = candidatesToMerge.length > 0 ? candidatesToMerge : [
        ...autoMergeCandidates,
        ...conflictCandidates
          .filter(c => !hasUnresolvedDecisions(conflictResolutions[c.id]))
          .map(c => ({
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

      case 'summary':
        return (
          <div className="bulk-merge-summary">
            <div className="summary-stats">
              <div className="summary-stat auto-merge">
                <div className="stat-number">{autoMergeCandidates.length}</div>
                <div className="stat-label">Auto-Mergeable</div>
                <div className="stat-desc">No conflicts, ready to merge</div>
              </div>
              <div className="summary-stat conflicts">
                <div className="stat-number">{conflictCandidates.length}</div>
                <div className="stat-label">Need Decisions</div>
                <div className="stat-desc">Have conflicting field values</div>
              </div>
            </div>

            <div className="summary-actions">
              <h3>Choose how to proceed:</h3>

              {autoMergeCandidates.length > 0 && (
                <div className="action-option primary-action">
                  <button
                    className="btn btn-success btn-large"
                    onClick={handleMergeAutoOnly}
                  >
                    Merge Auto-Only ({autoMergeCandidates.length})
                  </button>
                  <span className="action-desc">
                    Process only conflict-free candidates, skip the rest
                  </span>
                </div>
              )}

              {conflictCandidates.length > 0 && (
                <>
                  <div className="action-divider">
                    <span>Or resolve conflicts:</span>
                  </div>

                  <div className="action-option">
                    <button
                      className="btn btn-primary"
                      onClick={() => handleMergeAllWithStrategy(true)}
                    >
                      Keep Survivor Values (A)
                    </button>
                    <span className="action-desc">
                      For all conflicts, prefer the "Keep" record's values
                    </span>
                  </div>

                  <div className="action-option">
                    <button
                      className="btn btn-primary"
                      onClick={() => handleMergeAllWithStrategy(false)}
                    >
                      Keep Merged Values (B)
                    </button>
                    <span className="action-desc">
                      For all conflicts, prefer the "Merge" record's values
                    </span>
                  </div>

                  <div className="action-option secondary">
                    <button
                      className="btn btn-secondary"
                      onClick={handleResolveIndividually}
                    >
                      Resolve Individually
                    </button>
                    <span className="action-desc">
                      Review each conflict one at a time
                    </span>
                  </div>
                </>
              )}

              {autoMergeCandidates.length === 0 && conflictCandidates.length === 0 && (
                <div className="no-candidates">
                  <p>No candidates to merge.</p>
                </div>
              )}
            </div>
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
                  <div className="conflict-actions-left">
                    <button className="btn btn-secondary btn-small" onClick={handleSkipConflict}>
                      Skip This
                    </button>
                    {currentConflictIndex < conflictCandidates.length - 1 && (
                      <button className="btn btn-secondary btn-small" onClick={handleSkipAllRemaining}>
                        Skip All Remaining ({conflictCandidates.length - currentConflictIndex})
                      </button>
                    )}
                  </div>
                  <button
                    className="btn btn-success"
                    onClick={handleNextConflict}
                    disabled={!isCurrentConflictResolved}
                  >
                    {currentConflictIndex < conflictCandidates.length - 1 ? 'Next' : 'Start Merging'}
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
