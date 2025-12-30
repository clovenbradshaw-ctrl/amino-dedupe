import React, { useState, useEffect, useMemo } from 'react';
import { AirtableClient } from '../lib/airtable.js';
import { findDuplicateCandidates, groupCandidates, MATCH_TIERS } from '../lib/matching.js';

/**
 * ScanResults Component
 * Displays duplicate candidates found by the matching engine.
 */
export default function ScanResults({
  credentials,
  schema,
  fieldConfig,
  onSelectCandidate,
  onLog,
}) {
  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [groups, setGroups] = useState([]);
  const [progress, setProgress] = useState({ phase: '', current: 0, total: 0 });

  // Filters
  const [tierFilter, setTierFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('confidence'); // confidence, tier, name

  const log = (message, type = 'info') => {
    if (onLog) onLog(message, type);
  };

  const runScan = async () => {
    setLoading(true);
    setProgress({ phase: 'Fetching records', current: 0, total: 0 });

    try {
      const client = new AirtableClient(credentials.apiKey, credentials.baseId);

      // Fetch all records
      log('Fetching all records...', 'info');
      const allRecords = await client.getAllRecords(credentials.tableName, {
        onProgress: (p) => {
          setProgress({
            phase: 'Fetching records',
            current: p.total,
            total: p.hasMore ? '...' : p.total,
          });
        },
      });

      setRecords(allRecords);
      log(`Fetched ${allRecords.length} records`, 'success');

      // Find duplicate candidates
      log('Analyzing for duplicates...', 'info');
      setProgress({ phase: 'Finding duplicates', current: 0, total: allRecords.length });

      const duplicateCandidates = findDuplicateCandidates(allRecords, fieldConfig, (p) => {
        setProgress({
          phase: p.phase === 'matching' ? 'Comparing records' : 'Fuzzy matching',
          current: p.current,
          total: p.total,
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
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={runScan}
          disabled={loading}
        >
          {loading ? 'Scanning...' : records.length > 0 ? 'Re-scan' : 'Start Scan'}
        </button>
      </div>

      {/* Progress */}
      {loading && (
        <div className="progress-container">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{
                width: progress.total && typeof progress.total === 'number'
                  ? `${(progress.current / progress.total) * 100}%`
                  : '50%'
              }}
            />
          </div>
          <p className="progress-text">{progress.phase}: {progress.current} / {progress.total}</p>
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

      {/* Candidate List */}
      {filteredCandidates.length > 0 && (
        <div className="candidate-list">
          <div className="list-header">
            <span>Showing {filteredCandidates.length} of {candidates.length} matches</span>
          </div>

          {filteredCandidates.map(candidate => (
            <div
              key={candidate.id}
              className={`candidate-row tier-${candidate.tier.tier} ${candidate.isConflict ? 'conflict' : ''}`}
              onClick={() => onSelectCandidate && onSelectCandidate(candidate)}
            >
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
    </div>
  );
}
