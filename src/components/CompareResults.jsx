import React, { useState, useEffect, useMemo } from 'react';
import { AirtableClient } from '../lib/airtable.js';
import { findCrossTableDuplicates, findCommonFields, getMatchStats, MATCH_TIERS } from '../lib/crossTableMatch.js';

/**
 * CompareResults Component
 * Displays the results of comparing two tables for duplicates.
 */
export default function CompareResults({ connection, onDisconnect, onLog }) {
  const [loading, setLoading] = useState(false);
  const [records1, setRecords1] = useState([]);
  const [records2, setRecords2] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [commonFields, setCommonFields] = useState([]);
  const [progress, setProgress] = useState({ phase: '', current: 0, total: 0 });

  // Filters
  const [tierFilter, setTierFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Selected match for detail view
  const [selectedMatch, setSelectedMatch] = useState(null);

  const log = (message, type = 'info') => {
    if (onLog) onLog(message, type);
  };

  // Run comparison
  const runComparison = async () => {
    setLoading(true);
    setProgress({ phase: 'Initializing', current: 0, total: 0 });
    setCandidates([]);
    setSelectedMatch(null);

    try {
      const client = new AirtableClient(connection.apiKey, connection.baseId);

      // Fetch records from table 1
      log(`Fetching records from "${connection.table1.name}"...`, 'info');
      setProgress({ phase: `Fetching ${connection.table1.name}`, current: 0, total: 0 });

      const table1Records = await client.getAllRecords(connection.table1.name, {
        onProgress: (p) => {
          setProgress({
            phase: `Fetching ${connection.table1.name}`,
            current: p.total,
            total: null,
          });
        },
      });
      setRecords1(table1Records);
      log(`Fetched ${table1Records.length} records from ${connection.table1.name}`, 'success');

      // Fetch records from table 2
      log(`Fetching records from "${connection.table2.name}"...`, 'info');
      setProgress({ phase: `Fetching ${connection.table2.name}`, current: 0, total: 0 });

      const table2Records = await client.getAllRecords(connection.table2.name, {
        onProgress: (p) => {
          setProgress({
            phase: `Fetching ${connection.table2.name}`,
            current: p.total,
            total: null,
          });
        },
      });
      setRecords2(table2Records);
      log(`Fetched ${table2Records.length} records from ${connection.table2.name}`, 'success');

      // Find common fields
      const common = findCommonFields(connection.table1.schema, connection.table2.schema);
      setCommonFields(common);
      log(`Found ${common.length} common fields between tables`, 'info');

      if (common.length === 0) {
        log('Warning: No common fields found. Comparison may be limited.', 'warning');
      }

      // Find duplicates
      log('Comparing records for duplicates...', 'info');
      setProgress({ phase: 'Comparing records', current: 0, total: table1Records.length });

      const duplicates = findCrossTableDuplicates(
        table1Records,
        table2Records,
        connection.table1.schema,
        connection.table2.schema,
        (p) => {
          setProgress({
            phase: 'Comparing records',
            current: p.current,
            total: p.total,
          });
        }
      );

      setCandidates(duplicates);
      log(`Found ${duplicates.length} potential matches`, 'success');

      // Log summary by tier
      const stats = getMatchStats(duplicates);
      log(`Definitive (95%+): ${stats.byTier[1]}`, stats.byTier[1] > 0 ? 'success' : 'info');
      log(`Strong (80-94%): ${stats.byTier[2]}`, stats.byTier[2] > 0 ? 'success' : 'info');
      log(`Possible (60-79%): ${stats.byTier[3]}`, stats.byTier[3] > 0 ? 'warning' : 'info');
      log(`Weak (40-59%): ${stats.byTier[4]}`, stats.byTier[4] > 0 ? 'warning' : 'info');

    } catch (err) {
      log(`Comparison failed: ${err.message}`, 'error');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Filter candidates
  const filteredCandidates = useMemo(() => {
    let result = [...candidates];

    // Filter by tier
    if (tierFilter !== 'all') {
      const tier = parseInt(tierFilter);
      result = result.filter(c => c.tier.tier === tier);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(c =>
        c.record1.name.toLowerCase().includes(query) ||
        c.record2.name.toLowerCase().includes(query) ||
        c.record1.id.toLowerCase().includes(query) ||
        c.record2.id.toLowerCase().includes(query)
      );
    }

    return result;
  }, [candidates, tierFilter, searchQuery]);

  // Stats
  const stats = useMemo(() => getMatchStats(candidates), [candidates]);

  return (
    <div className="compare-results">
      {/* Header */}
      <div className="compare-header">
        <div className="compare-info">
          <h2>Table Comparison</h2>
          <div className="table-names">
            <span className="table-name table1">{connection.table1.name}</span>
            <span className="vs">⟷</span>
            <span className="table-name table2">{connection.table2.name}</span>
          </div>
        </div>
        <button
          className="btn btn-primary"
          onClick={runComparison}
          disabled={loading}
        >
          {loading ? 'Comparing...' : candidates.length > 0 ? 'Re-compare' : 'Start Comparison'}
        </button>
      </div>

      {/* Progress */}
      {loading && (
        <div className="loading-container">
          <div className="loading-spinner">
            <div className="spinner"></div>
          </div>
          <div className="loading-details">
            <p className="loading-phase">{progress.phase}</p>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{
                  width: progress.total
                    ? `${(progress.current / progress.total) * 100}%`
                    : '100%'
                }}
              />
            </div>
            <p className="progress-text">
              {progress.current.toLocaleString()}
              {progress.total ? ` / ${progress.total.toLocaleString()}` : ' records'}
            </p>
          </div>
        </div>
      )}

      {/* Common Fields Info */}
      {commonFields.length > 0 && !loading && (
        <div className="common-fields-info">
          <details>
            <summary>
              {commonFields.length} common fields used for matching
            </summary>
            <div className="common-fields-list">
              {commonFields.map(field => (
                <span key={field} className="field-tag">{field}</span>
              ))}
            </div>
          </details>
        </div>
      )}

      {/* Stats Grid */}
      {candidates.length > 0 && !loading && (
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-number">{records1.length}</div>
            <div className="stat-label">{connection.table1.name}</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{records2.length}</div>
            <div className="stat-label">{connection.table2.name}</div>
          </div>
          <div className="stat-card tier-1">
            <div className="stat-number">{stats.byTier[1]}</div>
            <div className="stat-label">Definitive</div>
          </div>
          <div className="stat-card tier-2">
            <div className="stat-number">{stats.byTier[2]}</div>
            <div className="stat-label">Strong</div>
          </div>
          <div className="stat-card tier-3">
            <div className="stat-number">{stats.byTier[3]}</div>
            <div className="stat-label">Possible</div>
          </div>
          <div className="stat-card tier-4">
            <div className="stat-number">{stats.byTier[4]}</div>
            <div className="stat-label">Weak</div>
          </div>
        </div>
      )}

      {/* Filters */}
      {candidates.length > 0 && !loading && (
        <div className="filter-bar">
          <div className="filter-group">
            <label>Confidence:</label>
            <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)}>
              <option value="all">All Matches ({candidates.length})</option>
              <option value="1">Definitive 95%+ ({stats.byTier[1]})</option>
              <option value="2">Strong 80-94% ({stats.byTier[2]})</option>
              <option value="3">Possible 60-79% ({stats.byTier[3]})</option>
              <option value="4">Weak 40-59% ({stats.byTier[4]})</option>
            </select>
          </div>
          <div className="filter-group search">
            <input
              type="text"
              placeholder="Search by name or ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Results List */}
      {filteredCandidates.length > 0 && !loading && (
        <div className="candidate-list">
          <div className="list-header">
            <span>
              Showing {filteredCandidates.length.toLocaleString()} matches
              {filteredCandidates.length !== candidates.length && ` (of ${candidates.length} total)`}
            </span>
          </div>

          {filteredCandidates.slice(0, 100).map(match => (
            <div
              key={match.id}
              className={`candidate-row tier-${match.tier.tier} ${selectedMatch?.id === match.id ? 'selected' : ''}`}
              onClick={() => setSelectedMatch(selectedMatch?.id === match.id ? null : match)}
            >
              <div className="candidate-tier">
                <span
                  className="tier-badge"
                  style={{ backgroundColor: match.tier.color }}
                >
                  {match.confidence}%
                </span>
                <span className="tier-name">{match.tier.name}</span>
              </div>

              <div className="candidate-records cross-table">
                <div className="record-info table1">
                  <span className="record-label">{connection.table1.name}:</span>
                  <span className="record-name">{match.record1.name}</span>
                </div>
                <div className="match-arrow">↔</div>
                <div className="record-info table2">
                  <span className="record-label">{connection.table2.name}:</span>
                  <span className="record-name">{match.record2.name}</span>
                </div>
              </div>

              <div className="candidate-reasons">
                {match.reasons.slice(0, 3).map((reason, idx) => (
                  <span key={idx} className="reason-tag">{reason}</span>
                ))}
                {match.reasons.length > 3 && (
                  <span className="reason-more">+{match.reasons.length - 3} more</span>
                )}
              </div>
            </div>
          ))}

          {filteredCandidates.length > 100 && (
            <div className="load-more-info">
              Showing first 100 matches. Use filters to narrow results.
            </div>
          )}
        </div>
      )}

      {/* Selected Match Detail */}
      {selectedMatch && (
        <div className="match-detail-panel">
          <div className="match-detail-header">
            <h3>Match Details</h3>
            <button className="btn-close" onClick={() => setSelectedMatch(null)}>×</button>
          </div>

          <div className="match-detail-content">
            <div className="match-confidence">
              <span
                className="confidence-badge"
                style={{ backgroundColor: selectedMatch.tier.color }}
              >
                {selectedMatch.confidence}% {selectedMatch.tier.name}
              </span>
              <span className="matched-fields">
                {selectedMatch.matchedFields} fields matched
              </span>
            </div>

            <div className="records-comparison">
              {/* Record 1 */}
              <div className="record-detail">
                <h4>{connection.table1.name}</h4>
                <div className="record-id">ID: {selectedMatch.record1.id}</div>
                <div className="fields-list">
                  {Object.entries(selectedMatch.record1.fields).map(([key, val]) => (
                    <div key={key} className="field-row">
                      <span className="field-name">{key}:</span>
                      <span className="field-value">
                        {Array.isArray(val)
                          ? `[${val.length} items]`
                          : typeof val === 'object'
                            ? JSON.stringify(val)
                            : String(val)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Record 2 */}
              <div className="record-detail">
                <h4>{connection.table2.name}</h4>
                <div className="record-id">ID: {selectedMatch.record2.id}</div>
                <div className="fields-list">
                  {Object.entries(selectedMatch.record2.fields).map(([key, val]) => (
                    <div key={key} className="field-row">
                      <span className="field-name">{key}:</span>
                      <span className="field-value">
                        {Array.isArray(val)
                          ? `[${val.length} items]`
                          : typeof val === 'object'
                            ? JSON.stringify(val)
                            : String(val)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="match-reasons-detail">
              <h4>Match Reasons</h4>
              <ul>
                {selectedMatch.reasons.map((reason, idx) => (
                  <li key={idx}>{reason}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && candidates.length === 0 && records1.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">🔍</div>
          <h3>Ready to Compare</h3>
          <p>Click "Start Comparison" to find duplicates between the two tables.</p>
        </div>
      )}

      {!loading && candidates.length === 0 && records1.length > 0 && (
        <div className="empty-state">
          <div className="empty-icon">✓</div>
          <h3>No Duplicates Found</h3>
          <p>
            No matching records found between {connection.table1.name} ({records1.length} records)
            and {connection.table2.name} ({records2.length} records).
          </p>
        </div>
      )}
    </div>
  );
}
