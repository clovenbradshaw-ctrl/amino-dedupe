import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { AirtableClient } from '../lib/airtable.js';
import {
  detectEditableFields,
  findCaseMasterDuplicates,
  computeCaseMasterResolutions,
  computeForceMergeResolutions,
  buildCaseMasterMergePayload,
  getMergeSummary,
  filterByCreatedDate,
  scoreRecordCompleteness,
  CASE_MASTER_MERGE_CONFIG,
} from '../lib/caseMasterMerge.js';

const RECORDS_PER_PAGE = 100;

// Case Master View table ID
const CASE_MASTER_VIEW_TABLE_ID = 'tblgynOzESGvAXAsK';

/**
 * Case Master View Deduplication Component
 *
 * Features:
 * - Filter by Created date
 * - Auto-detect all editable fields
 * - Force merge mode for combining all editable data
 * - Special handling for Matter_Flatpack (append, don't overwrite)
 */
export default function CaseMasterDedup({
  credentials,
  onLog,
}) {
  // State
  const [loading, setLoading] = useState(false);
  const [schema, setSchema] = useState(null);
  const [records, setRecords] = useState([]);
  const [duplicateGroups, setDuplicateGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [merging, setMerging] = useState(false);

  // Filter state
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [matchFields, setMatchFields] = useState([]);

  // Mode state
  const [forceMode, setForceMode] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [resolutions, setResolutions] = useState({});

  // Pagination
  const [visibleCount, setVisibleCount] = useState(RECORDS_PER_PAGE);

  // Field detection
  const [editableFields, setEditableFields] = useState(null);

  // Table selection (defaults to Case Master View table ID)
  const [tableName, setTableName] = useState(CASE_MASTER_VIEW_TABLE_ID);
  const [availableTables, setAvailableTables] = useState([]);

  const log = (message, type = 'info') => {
    if (onLog) onLog(message, type);
  };

  // Fetch available tables on mount
  useEffect(() => {
    if (!credentials) return;

    const fetchTables = async () => {
      try {
        const client = new AirtableClient(credentials.apiKey, credentials.baseId);
        const result = await client.request(client.metaUrl);
        // Store both id and name for each table
        setAvailableTables(result.tables.map(t => ({ id: t.id, name: t.name })));

        // Find Case Master View table and set it as default if found
        const caseMasterTable = result.tables.find(t => t.id === CASE_MASTER_VIEW_TABLE_ID);
        if (caseMasterTable) {
          setTableName(caseMasterTable.id);
          log(`Found Case Master View table: ${caseMasterTable.name}`, 'success');
        }
      } catch (err) {
        log(`Failed to fetch tables: ${err.message}`, 'error');
      }
    };

    fetchTables();
  }, [credentials]);

  // Fetch schema when table changes
  useEffect(() => {
    if (!credentials || !tableName) return;

    const fetchSchema = async () => {
      try {
        const client = new AirtableClient(credentials.apiKey, credentials.baseId);
        const tableSchema = await client.getTableSchema(tableName);
        setSchema(tableSchema);

        // Detect editable fields
        const fields = detectEditableFields(tableSchema);
        setEditableFields(fields);

        // Set default match fields
        const defaultMatchFields = fields.textFields.slice(0, 3);
        setMatchFields(defaultMatchFields);

        log(`Loaded schema for ${tableName}: ${fields.editable.length} editable fields`, 'success');
      } catch (err) {
        log(`Failed to fetch schema: ${err.message}`, 'error');
      }
    };

    fetchSchema();
  }, [credentials, tableName]);

  // Scan for records and duplicates
  const runScan = async () => {
    if (!credentials || !schema) {
      log('Please wait for schema to load', 'warning');
      return;
    }

    setLoading(true);
    setDuplicateGroups([]);
    setSelectedGroup(null);
    setVisibleCount(RECORDS_PER_PAGE);

    try {
      const client = new AirtableClient(credentials.apiKey, credentials.baseId);

      log(`Fetching records from ${tableName}...`, 'info');

      const allRecords = await client.getAllRecords(tableName, {
        onProgress: (p) => {
          log(`Fetched ${p.total} records...`, 'info');
        },
      });

      log(`Fetched ${allRecords.length} total records`, 'success');

      // Filter by date if specified
      let filteredRecords = allRecords;
      if (dateStart || dateEnd) {
        filteredRecords = filterByCreatedDate(allRecords, dateStart, dateEnd);
        log(`Filtered to ${filteredRecords.length} records by date range`, 'info');
      }

      setRecords(filteredRecords);

      // Find duplicates
      if (matchFields.length === 0) {
        log('Please select at least one field for matching', 'warning');
        setLoading(false);
        return;
      }

      log('Analyzing for duplicates...', 'info');

      const duplicates = findCaseMasterDuplicates(filteredRecords, {
        matchFields,
      });

      setDuplicateGroups(duplicates);
      log(`Found ${duplicates.length} duplicate groups`, 'success');

    } catch (err) {
      log(`Scan failed: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Select a duplicate group for review/merge
  const selectGroup = useCallback((group) => {
    setSelectedGroup(group);
    setShowPreview(false);

    if (group && schema) {
      // Compute resolutions based on mode
      const computedResolutions = forceMode
        ? computeForceMergeResolutions(group.survivor, group.toMerge, schema)
        : computeCaseMasterResolutions(group.survivor, group.toMerge, schema);

      setResolutions(computedResolutions);
    }
  }, [schema, forceMode]);

  // Re-compute resolutions when force mode changes
  useEffect(() => {
    if (selectedGroup && schema) {
      const computedResolutions = forceMode
        ? computeForceMergeResolutions(selectedGroup.survivor, selectedGroup.toMerge, schema)
        : computeCaseMasterResolutions(selectedGroup.survivor, selectedGroup.toMerge, schema);

      setResolutions(computedResolutions);
    }
  }, [forceMode, selectedGroup, schema]);

  // Execute the merge
  const executeMerge = async () => {
    if (!selectedGroup || !schema || !credentials) return;

    setMerging(true);

    try {
      const client = new AirtableClient(credentials.apiKey, credentials.baseId);

      // Build merge payload
      const payload = buildCaseMasterMergePayload(
        selectedGroup.survivor,
        selectedGroup.toMerge,
        resolutions,
        schema,
        { forceMode, performedBy: 'user' }
      );

      log(`Executing merge ${payload.mergeId}...`, 'info');

      // Update survivor record
      if (Object.keys(payload.updateFields).length > 0) {
        await client.updateRecord(tableName, payload.survivorId, payload.updateFields);
        log(`Updated survivor record with ${Object.keys(payload.updateFields).length} fields`, 'success');
      }

      // Delete merged records
      if (payload.recordsToDelete.length > 0) {
        await client.deleteRecords(tableName, payload.recordsToDelete, (p) => {
          log(`Deleted ${p.deleted}/${p.total} records...`, 'info');
        });
        log(`Deleted ${payload.recordsToDelete.length} duplicate records`, 'success');
      }

      log(`Merge ${payload.mergeId} completed successfully!`, 'success');

      // Remove this group from the list and clear selection
      setDuplicateGroups(prev => prev.filter(g => g.id !== selectedGroup.id));
      setSelectedGroup(null);
      setResolutions({});

    } catch (err) {
      log(`Merge failed: ${err.message}`, 'error');
    } finally {
      setMerging(false);
    }
  };

  // Bulk force merge all duplicates
  const bulkForceMerge = async () => {
    if (duplicateGroups.length === 0 || !schema || !credentials) return;

    const confirmMsg = `This will force merge ${duplicateGroups.length} duplicate groups. Continue?`;
    if (!confirm(confirmMsg)) return;

    setMerging(true);
    let successCount = 0;
    let failCount = 0;

    try {
      const client = new AirtableClient(credentials.apiKey, credentials.baseId);

      for (const group of duplicateGroups) {
        try {
          const groupResolutions = computeForceMergeResolutions(group.survivor, group.toMerge, schema);
          const payload = buildCaseMasterMergePayload(
            group.survivor,
            group.toMerge,
            groupResolutions,
            schema,
            { forceMode: true, performedBy: 'user' }
          );

          if (Object.keys(payload.updateFields).length > 0) {
            await client.updateRecord(tableName, payload.survivorId, payload.updateFields);
          }

          if (payload.recordsToDelete.length > 0) {
            await client.deleteRecords(tableName, payload.recordsToDelete);
          }

          successCount++;
          log(`Merged group ${successCount}/${duplicateGroups.length}`, 'info');

        } catch (err) {
          failCount++;
          log(`Failed to merge group: ${err.message}`, 'error');
        }
      }

      log(`Bulk merge complete: ${successCount} successful, ${failCount} failed`,
          failCount > 0 ? 'warning' : 'success');

      // Clear groups
      setDuplicateGroups([]);
      setSelectedGroup(null);

    } catch (err) {
      log(`Bulk merge failed: ${err.message}`, 'error');
    } finally {
      setMerging(false);
    }
  };

  // Toggle match field selection
  const toggleMatchField = (field) => {
    setMatchFields(prev => {
      if (prev.includes(field)) {
        return prev.filter(f => f !== field);
      }
      return [...prev, field];
    });
  };

  // Get merge summary for display
  const mergeSummary = useMemo(() => {
    if (!resolutions || Object.keys(resolutions).length === 0) return null;
    return getMergeSummary(resolutions);
  }, [resolutions]);

  // Visible groups with pagination
  const visibleGroups = useMemo(() => {
    return duplicateGroups.slice(0, visibleCount);
  }, [duplicateGroups, visibleCount]);

  const hasMore = visibleCount < duplicateGroups.length;

  return (
    <div className="case-master-dedup">
      {/* Header */}
      <div className="dedup-header">
        <div>
          <h2>Case Master Deduplication</h2>
          <p className="subtitle">
            Find and merge duplicate records with intelligent field handling
          </p>
        </div>
      </div>

      {/* Configuration Panel */}
      <div className="dedup-config">
        <div className="config-section">
          <h3>Table Selection</h3>
          <select
            value={tableName}
            onChange={(e) => setTableName(e.target.value)}
            disabled={loading}
          >
            {availableTables.map(t => (
              <option key={t.id} value={t.id}>
                {t.name} {t.id === CASE_MASTER_VIEW_TABLE_ID ? '(default)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="config-section">
          <h3>Date Filter (Created)</h3>
          <div className="date-range">
            <input
              type="date"
              value={dateStart}
              onChange={(e) => setDateStart(e.target.value)}
              placeholder="Start Date"
            />
            <span>to</span>
            <input
              type="date"
              value={dateEnd}
              onChange={(e) => setDateEnd(e.target.value)}
              placeholder="End Date"
            />
          </div>
        </div>

        <div className="config-section">
          <h3>Match Fields</h3>
          <p className="config-hint">Select fields to use for finding duplicates</p>
          <div className="field-checkboxes">
            {editableFields?.textFields.map(field => (
              <label key={field} className="field-checkbox">
                <input
                  type="checkbox"
                  checked={matchFields.includes(field)}
                  onChange={() => toggleMatchField(field)}
                />
                <span>{field}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="config-section">
          <h3>Merge Mode</h3>
          <label className="force-mode-toggle">
            <input
              type="checkbox"
              checked={forceMode}
              onChange={(e) => setForceMode(e.target.checked)}
            />
            <span>Force Merge Mode</span>
          </label>
          <p className="config-hint">
            {forceMode
              ? 'Force merge combines all editable data aggressively (appends Matter_Flatpack)'
              : 'Standard merge preserves survivor values where possible'
            }
          </p>
        </div>

        <div className="config-actions">
          <button
            className="btn btn-primary"
            onClick={runScan}
            disabled={loading || matchFields.length === 0}
          >
            {loading ? 'Scanning...' : 'Scan for Duplicates'}
          </button>
        </div>
      </div>

      {/* Field Summary */}
      {editableFields && (
        <div className="field-summary">
          <h3>Detected Fields</h3>
          <div className="field-stats">
            <div className="field-stat">
              <span className="stat-value">{editableFields.editable.length}</span>
              <span className="stat-label">Editable</span>
            </div>
            <div className="field-stat">
              <span className="stat-value">{editableFields.linkFields.length}</span>
              <span className="stat-label">Link Fields</span>
            </div>
            <div className="field-stat">
              <span className="stat-value">{editableFields.textFields.length}</span>
              <span className="stat-label">Text Fields</span>
            </div>
            <div className="field-stat">
              <span className="stat-value">{editableFields.computed.length}</span>
              <span className="stat-label">Computed</span>
            </div>
            <div className="field-stat append-field">
              <span className="stat-value">{editableFields.appendFields.length}</span>
              <span className="stat-label">Append Fields</span>
            </div>
          </div>
          {editableFields.appendFields.length > 0 && (
            <p className="append-notice">
              Append fields (will be combined, not overwritten): {editableFields.appendFields.join(', ')}
            </p>
          )}
        </div>
      )}

      {/* Results */}
      {duplicateGroups.length > 0 && !selectedGroup && (
        <div className="duplicate-results">
          <div className="results-header">
            <h3>Duplicate Groups ({duplicateGroups.length})</h3>
            <div className="results-actions">
              {forceMode && duplicateGroups.length > 0 && (
                <button
                  className="btn btn-danger"
                  onClick={bulkForceMerge}
                  disabled={merging}
                >
                  {merging ? 'Merging...' : `Force Merge All (${duplicateGroups.length})`}
                </button>
              )}
            </div>
          </div>

          <div className="duplicate-list">
            {visibleGroups.map(group => (
              <div
                key={group.id}
                className="duplicate-group"
                onClick={() => selectGroup(group)}
              >
                <div className="group-info">
                  <span className="group-count">{group.records.length} records</span>
                  <span className="group-match">{group.matchReason}</span>
                </div>
                <div className="group-records">
                  <div className="survivor-record">
                    <span className="record-label">Survivor:</span>
                    <span className="record-id">{group.survivor.id}</span>
                    <span className="record-score">
                      Score: {scoreRecordCompleteness(group.survivor).toFixed(0)}
                    </span>
                  </div>
                  <div className="merge-records">
                    {group.toMerge.map(r => (
                      <div key={r.id} className="merge-record">
                        <span className="record-label">Merge:</span>
                        <span className="record-id">{r.id}</span>
                        <span className="record-score">
                          Score: {scoreRecordCompleteness(r).toFixed(0)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <button className="btn btn-small btn-primary">
                  Review →
                </button>
              </div>
            ))}
          </div>

          {hasMore && (
            <div className="load-more">
              <button
                className="btn btn-secondary"
                onClick={() => setVisibleCount(prev => prev + RECORDS_PER_PAGE)}
              >
                Load More ({duplicateGroups.length - visibleCount} remaining)
              </button>
            </div>
          )}
        </div>
      )}

      {/* Selected Group Review */}
      {selectedGroup && (
        <div className="merge-review">
          <div className="review-header">
            <button className="btn btn-secondary" onClick={() => setSelectedGroup(null)}>
              ← Back to List
            </button>
            <h3>Review Merge</h3>
            <div className="mode-indicator">
              {forceMode ? (
                <span className="mode-badge force">Force Merge</span>
              ) : (
                <span className="mode-badge standard">Standard Merge</span>
              )}
            </div>
          </div>

          {/* Summary */}
          {mergeSummary && (
            <div className="merge-summary">
              <h4>Merge Summary</h4>
              <div className="summary-stats">
                <div className="summary-stat">
                  <span className="stat-value">{mergeSummary.fieldsToUpdate.length}</span>
                  <span className="stat-label">Fields to Update</span>
                </div>
                <div className="summary-stat">
                  <span className="stat-value">{mergeSummary.fieldsAppended.length}</span>
                  <span className="stat-label">Fields Appended</span>
                </div>
                <div className="summary-stat">
                  <span className="stat-value">{mergeSummary.linksAdded}</span>
                  <span className="stat-label">Links Added</span>
                </div>
                <div className="summary-stat">
                  <span className="stat-value">{selectedGroup.toMerge.length}</span>
                  <span className="stat-label">Records to Delete</span>
                </div>
              </div>
              {mergeSummary.fieldsAppended.length > 0 && (
                <p className="append-info">
                  Appending to: {mergeSummary.fieldsAppended.join(', ')}
                </p>
              )}
            </div>
          )}

          {/* Field Details */}
          <div className="field-resolutions">
            <div className="resolutions-header">
              <h4>Field Resolutions</h4>
              <button
                className="btn btn-small"
                onClick={() => setShowPreview(!showPreview)}
              >
                {showPreview ? 'Hide Details' : 'Show Details'}
              </button>
            </div>

            {showPreview && (
              <div className="resolution-list">
                {Object.entries(resolutions)
                  .filter(([, r]) => r.include)
                  .map(([fieldName, resolution]) => (
                    <div key={fieldName} className={`resolution-item ${resolution.strategy}`}>
                      <div className="resolution-header">
                        <span className="field-name">{fieldName}</span>
                        <span className={`strategy-badge ${resolution.strategy}`}>
                          {resolution.strategy}
                        </span>
                      </div>
                      <div className="resolution-value">
                        {resolution.strategy === 'append' ? (
                          <div className="append-preview">
                            <span className="label">Will contain:</span>
                            <pre>{String(resolution.value || '').substring(0, 200)}
                              {String(resolution.value || '').length > 200 && '...'}
                            </pre>
                          </div>
                        ) : resolution.strategy === 'merge_links' ? (
                          <span>{Array.isArray(resolution.value) ? resolution.value.length : 0} linked records</span>
                        ) : (
                          <span>{JSON.stringify(resolution.value).substring(0, 100)}</span>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Records being merged */}
          <div className="records-preview">
            <h4>Records</h4>
            <div className="record-preview survivor">
              <span className="preview-label">Survivor (will be kept):</span>
              <span className="record-id">{selectedGroup.survivor.id}</span>
            </div>
            {selectedGroup.toMerge.map(r => (
              <div key={r.id} className="record-preview to-merge">
                <span className="preview-label">Will be merged & deleted:</span>
                <span className="record-id">{r.id}</span>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="review-actions">
            <button
              className="btn btn-secondary"
              onClick={() => setSelectedGroup(null)}
              disabled={merging}
            >
              Cancel
            </button>
            <button
              className="btn btn-success"
              onClick={executeMerge}
              disabled={merging}
            >
              {merging ? 'Merging...' : 'Execute Merge'}
            </button>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && records.length > 0 && duplicateGroups.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">✓</div>
          <h3>No Duplicates Found</h3>
          <p>No duplicate records found matching the selected criteria.</p>
        </div>
      )}

      {!loading && records.length === 0 && !selectedGroup && (
        <div className="empty-state">
          <div className="empty-icon">🔍</div>
          <h3>Ready to Scan</h3>
          <p>Configure your matching fields and click "Scan for Duplicates" to begin.</p>
        </div>
      )}
    </div>
  );
}
