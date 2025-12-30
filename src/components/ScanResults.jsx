import React, { useState, useEffect, useMemo, useRef } from 'react';
import { AirtableClient } from '../lib/airtable.js';
import { findDuplicateCandidates, groupCandidates, MATCH_TIERS } from '../lib/matching.js';
import BulkMergeModal from './BulkMergeModal.jsx';

const RECORDS_PER_PAGE = 300;

/**
 * ScanResults Component
 * Displays duplicate candidates found by the matching engine.
 * Supports progressive loading - shows records as they stream in.
 */
export default function ScanResults({
  credentials,
  schema,
  fieldConfig,
  onSelectCandidate,
  onResyncReady,
  onLog,
}) {
  const [loading, setLoading] = useState(false);
  const [backgroundSyncing, setBackgroundSyncing] = useState(false);
  const [records, setRecords] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [groups, setGroups] = useState([]);
  const [progress, setProgress] = useState({ phase: '', current: 0, total: 0, hasMore: false, delay: 200 });

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showBulkMergeModal, setShowBulkMergeModal] = useState(false);

  // Pagination
  const [visibleCount, setVisibleCount] = useState(RECORDS_PER_PAGE);
  const [loadingMore, setLoadingMore] = useState(false);

  // Filters
  const [tierFilter, setTierFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('confidence'); // confidence, tier, name

  // Ref for stable callback
  const recordsRef = useRef([]);

  // Ref to hold the latest resync function (avoids stale closure issues)
  const resyncFnRef = useRef(null);

  const log = (message, type = 'info') => {
    if (onLog) onLog(message, type);
  };

  const runScan = async () => {
    setLoading(true);
    setVisibleCount(RECORDS_PER_PAGE); // Reset pagination
    setProgress({ phase: 'Fetching records', current: 0, total: 0, hasMore: true, delay: 200 });
    setRecords([]);
    setCandidates([]);
    setGroups([]);
    recordsRef.current = [];

    try {
      const client = new AirtableClient(credentials.apiKey, credentials.baseId);

      // Fetch all records with streaming - records appear as they're fetched
      log('Fetching all records...', 'info');
      const allRecords = await client.getAllRecords(credentials.tableName, {
        onRecords: (newRecords, allSoFar) => {
          // Update records progressively as they stream in
          recordsRef.current = allSoFar;
          setRecords([...allSoFar]);
        },
        onProgress: (p) => {
          setProgress({
            phase: 'Fetching records',
            current: p.total,
            total: p.hasMore ? null : p.total,
            hasMore: p.hasMore,
            delay: p.delay,
          });
        },
      });

      log(`Fetched ${allRecords.length} records`, 'success');

      // Find duplicate candidates
      log('Analyzing for duplicates...', 'info');
      setProgress({ phase: 'Finding duplicates', current: 0, total: allRecords.length, hasMore: false, delay: 200 });

      const duplicateCandidates = findDuplicateCandidates(allRecords, fieldConfig, (p) => {
        setProgress({
          phase: p.phase === 'matching' ? 'Comparing records' : 'Fuzzy matching',
          current: p.current,
          total: p.total,
          hasMore: false,
          delay: 200,
        });
      });

      setCandidates(duplicateCandidates);
      log(`Found ${duplicateCandidates.length} potential duplicate pairs`, 'success');

      // Group related candidates
      const groupedCandidates = groupCandidates(duplicateCandidates);
      setGroups(groupedCandidates);
      log(`Organized into ${groupedCandidates.length} merge groups`, 'info');

      // Summary by tier
      const tierCounts = {
        1: duplicateCandidates.filter(c => c.tier.tier === 1).length,
        2: duplicateCandidates.filter(c => c.tier.tier === 2).length,
        3: duplicateCandidates.filter(c => c.tier.tier === 3).length,
        4: duplicateCandidates.filter(c => c.tier.tier === 4).length,
      };

      log(`Tier 1 (Definitive): ${tierCounts[1]}`, tierCounts[1] > 0 ? 'success' : 'info');
      log(`Tier 2 (Strong): ${tierCounts[2]}`, tierCounts[2] > 0 ? 'warning' : 'info');
      log(`Tier 3 (Possible): ${tierCounts[3]}`, tierCounts[3] > 0 ? 'warning' : 'info');
      log(`Tier 4 (Conflicts): ${tierCounts[4]}`, tierCounts[4] > 0 ? 'error' : 'info');

    } catch (err) {
      log(`Scan failed: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Background resync - runs without blocking the UI
  // Store in ref to always have latest version available
  resyncFnRef.current = async () => {
    // Don't run if already scanning or syncing
    if (loading || backgroundSyncing) {
      log('Resync skipped - scan already in progress', 'info');
      return;
    }

    // Only run if we have previously loaded records
    if (recordsRef.current.length === 0) {
      log('Resync skipped - no records loaded yet', 'info');
      return;
    }

    setBackgroundSyncing(true);

    try {
      const client = new AirtableClient(credentials.apiKey, credentials.baseId);

      log('Background resync: Fetching records...', 'info');
      const allRecords = await client.getAllRecords(credentials.tableName, {
        onRecords: (newRecords, allSoFar) => {
          // Update records progressively as they stream in
          recordsRef.current = allSoFar;
          setRecords([...allSoFar]);
        },
      });

      log(`Background resync: Fetched ${allRecords.length} records`, 'success');

      // Find duplicate candidates
      log('Background resync: Analyzing for duplicates...', 'info');

      const duplicateCandidates = findDuplicateCandidates(allRecords, fieldConfig);
      setCandidates(duplicateCandidates);
      log(`Background resync: Found ${duplicateCandidates.length} potential duplicates`, 'success');

      // Group related candidates
      const groupedCandidates = groupCandidates(duplicateCandidates);
      setGroups(groupedCandidates);

      log('Background resync completed', 'success');

    } catch (err) {
      log(`Background resync failed: ${err.message}`, 'error');
    } finally {
      setBackgroundSyncing(false);
    }
  };

  // Register a stable wrapper function with parent that calls the latest resync
  useEffect(() => {
    if (onResyncReady) {
      onResyncReady(() => {
        if (resyncFnRef.current) {
          resyncFnRef.current();
        }
      });
    }
  }, [onResyncReady]);

  // Reset visible count when filters change
  useEffect(() => {
    setVisibleCount(RECORDS_PER_PAGE);
  }, [tierFilter, searchQuery, sortBy]);

  // Filter and sort candidates
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
        c.survivor.name.toLowerCase().includes(query) ||
        c.merged.name.toLowerCase().includes(query) ||
        c.survivor.record.id.toLowerCase().includes(query) ||
        c.merged.record.id.toLowerCase().includes(query)
      );
    }

    // Sort
    switch (sortBy) {
      case 'confidence':
        result.sort((a, b) => b.confidence - a.confidence);
        break;
      case 'tier':
        result.sort((a, b) => a.tier.tier - b.tier.tier || b.confidence - a.confidence);
        break;
      case 'name':
        result.sort((a, b) => a.survivor.name.localeCompare(b.survivor.name));
        break;
    }

    return result;
  }, [candidates, tierFilter, searchQuery, sortBy]);

  // Paginated candidates for display
  const visibleCandidates = useMemo(() => {
    return filteredCandidates.slice(0, visibleCount);
  }, [filteredCandidates, visibleCount]);

  const hasMore = visibleCount < filteredCandidates.length;

  const loadMore = () => {
    setLoadingMore(true);
    // Small delay for visual feedback
    setTimeout(() => {
      setVisibleCount(prev => prev + RECORDS_PER_PAGE);
      setLoadingMore(false);
    }, 300);
  };

  // Bulk selection handlers
  const toggleSelect = (candidateId, event) => {
    event.stopPropagation();
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(candidateId)) {
        newSet.delete(candidateId);
      } else {
        newSet.add(candidateId);
      }
      return newSet;
    });
  };

  const selectAll = () => {
    const allVisibleIds = new Set(visibleCandidates.map(c => c.id));
    setSelectedIds(allVisibleIds);
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const isAllSelected = visibleCandidates.length > 0 &&
    visibleCandidates.every(c => selectedIds.has(c.id));

  const selectedCandidates = useMemo(() => {
    return candidates.filter(c => selectedIds.has(c.id));
  }, [candidates, selectedIds]);

  // Handle bulk merge completion
  const handleBulkMergeComplete = (results) => {
    log(`Bulk merge completed: ${results.successful} successful, ${results.failed} failed`,
        results.failed > 0 ? 'warning' : 'success');
    setShowBulkMergeModal(false);
    setSelectedIds(new Set());
    // Trigger background resync to refresh the list
    if (resyncFnRef.current) {
      resyncFnRef.current();
    }
  };

  const handleBulkMergeCancel = () => {
    setShowBulkMergeModal(false);
  };

  // Stats
  const stats = useMemo(() => {
    return {
      total: records.length,
      candidates: candidates.length,
      groups: groups.length,
      byTier: {
        1: candidates.filter(c => c.tier.tier === 1).length,
        2: candidates.filter(c => c.tier.tier === 2).length,
        3: candidates.filter(c => c.tier.tier === 3).length,
        4: candidates.filter(c => c.tier.tier === 4).length,
      },
    };
  }, [records, candidates, groups]);

  return (
    <div className="scan-results">
      {/* Header with Scan Button */}
      <div className="scan-header">
        <div>
          <h2>Duplicate Scanner</h2>
          <p className="subtitle">
            {records.length > 0
              ? `Analyzing ${records.length} records`
              : 'Click scan to analyze your records'}
            {backgroundSyncing && (
              <span className="background-sync-indicator">
                <span className="sync-spinner"></span>
                Syncing...
              </span>
            )}
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={runScan}
          disabled={loading || backgroundSyncing}
        >
          {loading ? 'Scanning...' : backgroundSyncing ? 'Syncing...' : records.length > 0 ? 'Re-scan' : 'Start Scan'}
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
                className={`progress-fill ${progress.hasMore ? 'streaming' : ''}`}
                style={{
                  width: progress.total && typeof progress.total === 'number'
                    ? `${(progress.current / progress.total) * 100}%`
                    : '100%'
                }}
              />
            </div>
            <p className="progress-text">
              {progress.current.toLocaleString()}
              {progress.total !== null ? ` / ${progress.total.toLocaleString()}` : ' records loaded'}
              {progress.hasMore && ' (fetching more...)'}
            </p>
            {progress.delay > 200 && (
              <p className="rate-limit-notice">
                Rate limit adjusted: {progress.delay}ms delay
              </p>
            )}
          </div>
        </div>
      )}

      {/* Streaming records preview during load */}
      {loading && records.length > 0 && progress.phase === 'Fetching records' && (
        <div className="streaming-preview">
          <div className="streaming-header">
            <span className="streaming-count">{records.length.toLocaleString()} records loaded</span>
            <span className="streaming-indicator">
              <span className="pulse-dot"></span>
              Loading...
            </span>
          </div>
          <div className="streaming-sample">
            {records.slice(-5).map(record => (
              <div key={record.id} className="streaming-record">
                <span className="record-id">{record.id}</span>
                <span className="record-preview">
                  {Object.values(record.fields).slice(0, 2).map((val, i) => (
                    <span key={i} className="field-value">
                      {typeof val === 'string' ? val.substring(0, 30) : JSON.stringify(val).substring(0, 30)}
                      {(typeof val === 'string' && val.length > 30) ? '...' : ''}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats Grid */}
      {candidates.length > 0 && (
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-number">{stats.total}</div>
            <div className="stat-label">Total Records</div>
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
            <div className="stat-label">Conflicts</div>
          </div>
        </div>
      )}

      {/* Filters */}
      {candidates.length > 0 && (
        <div className="filter-bar">
          <div className="filter-group">
            <label>Tier:</label>
            <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)}>
              <option value="all">All Tiers</option>
              <option value="1">Tier 1 - Definitive</option>
              <option value="2">Tier 2 - Strong</option>
              <option value="3">Tier 3 - Possible</option>
              <option value="4">Tier 4 - Conflicts</option>
            </select>
          </div>
          <div className="filter-group">
            <label>Sort:</label>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="confidence">Confidence (High → Low)</option>
              <option value="tier">Tier (Best → Worst)</option>
              <option value="name">Name (A → Z)</option>
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

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="bulk-action-bar">
          <div className="bulk-info">
            <span className="bulk-count">{selectedIds.size}</span> selected
          </div>
          <div className="bulk-actions">
            <button className="btn btn-secondary btn-small" onClick={deselectAll}>
              Clear Selection
            </button>
            <button
              className="btn btn-success"
              onClick={() => setShowBulkMergeModal(true)}
            >
              Bulk Merge ({selectedIds.size})
            </button>
          </div>
        </div>
      )}

      {/* Candidate List */}
      {filteredCandidates.length > 0 && (
        <div className="candidate-list">
          <div className="list-header">
            <label className="select-all-checkbox" onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={isAllSelected}
                onChange={() => isAllSelected ? deselectAll() : selectAll()}
              />
              <span>Select All</span>
            </label>
            <span>
              Showing {visibleCandidates.length.toLocaleString()} of {filteredCandidates.length.toLocaleString()} matches
              {filteredCandidates.length !== candidates.length && ` (${candidates.length.toLocaleString()} total)`}
            </span>
          </div>

          {visibleCandidates.map(candidate => (
            <div
              key={candidate.id}
              className={`candidate-row tier-${candidate.tier.tier} ${candidate.isConflict ? 'conflict' : ''} ${selectedIds.has(candidate.id) ? 'selected' : ''}`}
              onClick={() => onSelectCandidate && onSelectCandidate(candidate)}
            >
              <div className="candidate-checkbox" onClick={(e) => toggleSelect(candidate.id, e)}>
                <input
                  type="checkbox"
                  checked={selectedIds.has(candidate.id)}
                  onChange={() => {}}
                />
              </div>

              <div className="candidate-tier">
                <span
                  className="tier-badge"
                  style={{ backgroundColor: candidate.tier.color }}
                >
                  {candidate.confidence}%
                </span>
                <span className="tier-name">{candidate.tier.name}</span>
              </div>

              <div className="candidate-records">
                <div className="record-info survivor">
                  <span className="record-label">Keep:</span>
                  <span className="record-name">{candidate.survivor.name}</span>
                  <span className="record-score">Score: {candidate.survivor.score}</span>
                </div>
                <div className="merge-arrow">→</div>
                <div className="record-info merged">
                  <span className="record-label">Merge:</span>
                  <span className="record-name">{candidate.merged.name}</span>
                  <span className="record-score">Score: {candidate.merged.score}</span>
                </div>
              </div>

              <div className="candidate-reasons">
                {candidate.reasons.slice(0, 3).map((reason, idx) => (
                  <span key={idx} className="reason-tag">{reason}</span>
                ))}
                {candidate.reasons.length > 3 && (
                  <span className="reason-more">+{candidate.reasons.length - 3} more</span>
                )}
              </div>

              {candidate.conflicts && candidate.conflicts.length > 0 && (
                <div className="candidate-conflicts">
                  {candidate.conflicts.map((conflict, idx) => (
                    <span key={idx} className="conflict-tag">{conflict}</span>
                  ))}
                </div>
              )}

              <div className="candidate-action">
                <button className="btn btn-small btn-primary">
                  Review →
                </button>
              </div>
            </div>
          ))}

          {/* Load More Button */}
          {hasMore && (
            <div className="load-more-container">
              <button
                className="btn btn-secondary load-more-btn"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <>
                    <span className="btn-spinner"></span>
                    Loading...
                  </>
                ) : (
                  `Load More (${Math.min(RECORDS_PER_PAGE, filteredCandidates.length - visibleCount).toLocaleString()} more)`
                )}
              </button>
              <span className="load-more-info">
                {(filteredCandidates.length - visibleCount).toLocaleString()} remaining
              </span>
            </div>
          )}
        </div>
      )}

      {/* Empty State */}
      {!loading && records.length > 0 && candidates.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">✓</div>
          <h3>No Duplicates Found</h3>
          <p>All {records.length} records appear to be unique.</p>
        </div>
      )}

      {!loading && records.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">🔍</div>
          <h3>Ready to Scan</h3>
          <p>Click "Start Scan" to analyze your records for duplicates.</p>
        </div>
      )}

      {/* Bulk Merge Modal */}
      {showBulkMergeModal && (
        <BulkMergeModal
          candidates={selectedCandidates}
          schema={schema}
          credentials={credentials}
          fieldConfig={fieldConfig}
          onComplete={handleBulkMergeComplete}
          onCancel={handleBulkMergeCancel}
          onLog={log}
        />
      )}
    </div>
  );
}
