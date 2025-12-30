import React, { useState, useEffect } from 'react';
import { AirtableClient } from '../lib/airtable.js';
import { parseDedupeHistory } from '../lib/merge.js';

/**
 * HistoryViewer Component
 * View merge history for any record and initiate unmerge operations.
 */
export default function HistoryViewer({
  credentials,
  schema,
  onUnmerge,
  onLog,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [recordsWithHistory, setRecordsWithHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const log = (message, type = 'info') => {
    if (onLog) onLog(message, type);
  };

  // Auto-load records with merge history on mount
  useEffect(() => {
    const loadRecordsWithHistory = async () => {
      setLoadingHistory(true);
      try {
        const client = new AirtableClient(credentials.apiKey, credentials.baseId);

        // Fetch records that have dedupe_history field populated
        const filterFormula = `AND(dedupe_history != "", dedupe_history != "[]")`;

        const records = await client.getAllRecords(credentials.tableName, {
          filterFormula,
          fields: ['Client Name', 'PPID', 'dedupe_history', 'First Name', 'Family Name'],
        });

        // Parse history and sort by most recent activity
        const recordsWithParsedHistory = records
          .map(record => {
            const historyData = parseDedupeHistory(record.fields.dedupe_history);
            const latestEvent = historyData.length > 0
              ? historyData[historyData.length - 1]
              : null;
            return {
              ...record,
              parsedHistory: historyData,
              latestTimestamp: latestEvent ? new Date(latestEvent.timestamp) : new Date(0),
            };
          })
          .filter(r => r.parsedHistory.length > 0)
          .sort((a, b) => b.latestTimestamp - a.latestTimestamp);

        setRecordsWithHistory(recordsWithParsedHistory);

        if (recordsWithParsedHistory.length > 0) {
          log(`Found ${recordsWithParsedHistory.length} record(s) with merge history`, 'success');
        }
      } catch (err) {
        log(`Failed to load merge history: ${err.message}`, 'error');
      } finally {
        setLoadingHistory(false);
      }
    };

    loadRecordsWithHistory();
  }, [credentials]);

  // Search for records
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setSearching(true);
    setSearchResults([]);

    try {
      const client = new AirtableClient(credentials.apiKey, credentials.baseId);

      // Search by name or ID
      const filterFormula = `OR(
        FIND(LOWER("${searchQuery.toLowerCase()}"), LOWER({Client Name})),
        FIND("${searchQuery}", {PPID}),
        RECORD_ID() = "${searchQuery}"
      )`;

      const results = await client.getAllRecords(credentials.tableName, {
        filterFormula,
        fields: ['Client Name', 'PPID', 'dedupe_history', 'First Name', 'Family Name'],
      });

      setSearchResults(results);

      if (results.length === 0) {
        log('No records found matching your search', 'warning');
      } else {
        log(`Found ${results.length} matching records`, 'success');
      }
    } catch (err) {
      log(`Search failed: ${err.message}`, 'error');
    } finally {
      setSearching(false);
    }
  };

  // Load history for a selected record
  const handleSelectRecord = async (record) => {
    setSelectedRecord(record);

    const historyData = parseDedupeHistory(record.fields.dedupe_history);
    setHistory(historyData);

    if (historyData.length === 0) {
      log('No merge history for this record', 'info');
    } else {
      log(`Found ${historyData.length} merge event(s)`, 'success');
    }
  };

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Enter' && e.target.type === 'text') {
        handleSearch();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchQuery]);

  return (
    <div className="history-viewer">
      <h2>Merge History</h2>
      <p className="subtitle">
        Search for a record to view its merge history and restore previously merged records.
      </p>

      {/* Search */}
      <div className="search-bar">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by name, PPID, or record ID..."
        />
        <button
          className="btn btn-primary"
          onClick={handleSearch}
          disabled={searching || !searchQuery.trim()}
        >
          {searching ? 'Searching...' : 'Search'}
        </button>
      </div>

      {/* Auto-loaded Records with Merge History */}
      {!selectedRecord && (
        <div className="auto-loaded-history">
          <h3>Records with Merge History</h3>
          {loadingHistory ? (
            <div className="loading-history">
              <div className="loading-spinner"></div>
              <span>Loading merge history...</span>
            </div>
          ) : recordsWithHistory.length === 0 ? (
            <div className="no-history">
              <p>No records with merge history found.</p>
              <p className="subtle">Once you merge records, they will appear here for easy access.</p>
            </div>
          ) : (
            <div className="history-record-list">
              {recordsWithHistory.map(record => {
                const latestEvent = record.parsedHistory[record.parsedHistory.length - 1];
                const eventCount = record.parsedHistory.length;
                const mergeCount = record.parsedHistory.filter(e => e.action === 'merge').length;

                return (
                  <div
                    key={record.id}
                    className="history-record-item"
                    onClick={() => handleSelectRecord(record)}
                  >
                    <div className="record-main">
                      <div className="record-name">
                        {record.fields['Client Name'] ||
                          `${record.fields['First Name'] || ''} ${record.fields['Family Name'] || ''}`.trim() ||
                          record.id}
                      </div>
                      <div className="record-stats">
                        <span className="event-count">{eventCount} event{eventCount !== 1 ? 's' : ''}</span>
                        <span className="merge-count">{mergeCount} merge{mergeCount !== 1 ? 's' : ''}</span>
                      </div>
                    </div>
                    <div className="record-meta">
                      {record.fields.PPID && <span>PPID: {record.fields.PPID}</span>}
                      <span className="last-activity">
                        Last: {new Date(latestEvent.timestamp).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Search Results */}
      {searchResults.length > 0 && (
        <div className="search-results">
          <h3>Search Results ({searchResults.length})</h3>
          <div className="result-list">
            {searchResults.map(record => {
              const hasHistory = record.fields.dedupe_history &&
                parseDedupeHistory(record.fields.dedupe_history).length > 0;

              return (
                <div
                  key={record.id}
                  className={`result-item ${selectedRecord?.id === record.id ? 'selected' : ''}`}
                  onClick={() => handleSelectRecord(record)}
                >
                  <div className="result-name">
                    {record.fields['Client Name'] ||
                      `${record.fields['First Name'] || ''} ${record.fields['Family Name'] || ''}`.trim() ||
                      record.id}
                  </div>
                  <div className="result-meta">
                    <span>ID: {record.id}</span>
                    {record.fields.PPID && <span>PPID: {record.fields.PPID}</span>}
                    {hasHistory && <span className="has-history">Has History</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* History Timeline */}
      {selectedRecord && (
        <div className="history-panel">
          <div className="history-panel-header">
            <button
              className="btn btn-secondary btn-small"
              onClick={() => {
                setSelectedRecord(null);
                setHistory([]);
              }}
            >
              ← Back to list
            </button>
            <h3>
              History for: {selectedRecord.fields['Client Name'] || selectedRecord.id}
            </h3>
          </div>

          {history.length === 0 ? (
            <div className="empty-history">
              <p>No merge history found for this record.</p>
              <p className="subtle">This record has not been involved in any merge operations.</p>
            </div>
          ) : (
            <div className="history-timeline">
              {history.map((event, idx) => (
                <HistoryEvent
                  key={event.merge_id || idx}
                  event={event}
                  isLatest={idx === history.length - 1}
                  onUnmerge={() => onUnmerge && onUnmerge(selectedRecord, event)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Individual history event component
 */
function HistoryEvent({ event, isLatest, onUnmerge }) {
  const [expanded, setExpanded] = useState(false);

  const isMerge = event.action === 'merge';
  const isUnmerge = event.action === 'unmerge';
  const timestamp = new Date(event.timestamp).toLocaleString();

  return (
    <div className={`history-event ${event.action}`}>
      <div className="event-header" onClick={() => setExpanded(!expanded)}>
        <div className="event-icon">
          {isMerge ? '🔀' : isUnmerge ? '↩️' : '📝'}
        </div>
        <div className="event-info">
          <div className="event-title">
            {isMerge && `Merged ${event.merged_records?.length || 0} record(s)`}
            {isUnmerge && `Unmerged from ${event.original_merge_id}`}
          </div>
          <div className="event-meta">
            <span>{timestamp}</span>
            {event.confidence && <span>Confidence: {event.confidence}%</span>}
            {event.performed_by && <span>By: {event.performed_by}</span>}
          </div>
        </div>
        <div className="event-expand">
          {expanded ? '▼' : '▶'}
        </div>
      </div>

      {expanded && (
        <div className="event-details">
          {/* Match Reasons */}
          {event.match_reasons && event.match_reasons.length > 0 && (
            <div className="detail-section">
              <h5>Match Reasons</h5>
              <div className="reason-list">
                {event.match_reasons.map((reason, idx) => (
                  <span key={idx} className="reason-badge">{reason}</span>
                ))}
              </div>
            </div>
          )}

          {/* Merged Records */}
          {event.merged_records && event.merged_records.length > 0 && (
            <div className="detail-section">
              <h5>Merged Records</h5>
              {event.merged_records.map((merged, idx) => (
                <div key={idx} className="merged-record">
                  <div className="merged-record-header">
                    <span className="record-id">{merged.original_record_id}</span>
                  </div>
                  {merged.field_snapshot && (
                    <details className="field-snapshot">
                      <summary>Field Snapshot ({Object.keys(merged.field_snapshot).length} fields)</summary>
                      <pre>{JSON.stringify(merged.field_snapshot, null, 2)}</pre>
                    </details>
                  )}
                  {merged.linked_records && Object.keys(merged.linked_records).length > 0 && (
                    <details className="linked-records">
                      <summary>Linked Records</summary>
                      <pre>{JSON.stringify(merged.linked_records, null, 2)}</pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Field Decisions */}
          {event.field_decisions && Object.keys(event.field_decisions).length > 0 && (
            <div className="detail-section">
              <h5>Field Decisions</h5>
              <div className="decision-list">
                {Object.entries(event.field_decisions)
                  .filter(([_, d]) => d.include !== false)
                  .map(([field, decision]) => (
                    <div key={field} className="decision-item">
                      <span className="field-name">{field}</span>
                      <span className="decision-strategy">{decision.strategy}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Notes */}
          {event.notes && (
            <div className="detail-section">
              <h5>Notes</h5>
              <p className="event-notes">{event.notes}</p>
            </div>
          )}

          {/* Unmerge Button */}
          {isMerge && isLatest && (
            <div className="event-actions">
              <button
                className="btn btn-warning"
                onClick={(e) => {
                  e.stopPropagation();
                  onUnmerge && onUnmerge();
                }}
              >
                Unmerge This Operation
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
