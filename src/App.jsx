import React, { useState, useCallback, useRef, useEffect } from 'react';
import Setup from './components/Setup.jsx';
import ConfigPanel from './components/ConfigPanel.jsx';
import ScanResults from './components/ScanResults.jsx';
import MergeReview from './components/MergeReview.jsx';
import HistoryViewer from './components/HistoryViewer.jsx';
import UnmergeModal from './components/UnmergeModal.jsx';

/**
 * Main App Component
 * Manages navigation between setup, configuration, scanning, and review flows.
 */
export default function App() {
  // App state
  const [currentView, setCurrentView] = useState('setup'); // setup, config, scan, review, history
  const [credentials, setCredentials] = useState(null);
  const [schema, setSchema] = useState(null);
  const [fieldConfig, setFieldConfig] = useState(null);
  const [selectedCandidate, setSelectedCandidate] = useState(null);

  // Unmerge modal state
  const [unmergeTarget, setUnmergeTarget] = useState(null);

  // Log state
  const [logs, setLogs] = useState([]);
  const logRef = useRef(null);

  // Add log entry
  const addLog = useCallback((message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { message, type, timestamp }]);
  }, []);

  // Auto-scroll logs
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  // Handle setup completion
  const handleSetupComplete = useCallback((data) => {
    setCredentials({
      apiKey: data.apiKey,
      baseId: data.baseId,
      tableName: data.tableName,
    });
    setSchema(data.schema);
    addLog('Setup complete, proceeding to configuration...', 'success');
    setCurrentView('config');
  }, [addLog]);

  // Handle config completion
  const handleConfigComplete = useCallback((config) => {
    setFieldConfig(config);
    addLog('Configuration saved, ready to scan', 'success');
    setCurrentView('scan');
  }, [addLog]);

  // Handle candidate selection for review
  const handleSelectCandidate = useCallback((candidate) => {
    setSelectedCandidate(candidate);
    setCurrentView('review');
  }, []);

  // Handle merge completion
  const handleMergeComplete = useCallback((result) => {
    addLog(`Merge completed: ${result.mergeId}`, 'success');
    setSelectedCandidate(null);
    setCurrentView('scan');
  }, [addLog]);

  // Handle skip during review
  const handleSkip = useCallback(() => {
    setSelectedCandidate(null);
    setCurrentView('scan');
  }, []);

  // Handle "not a duplicate" marking
  const handleMarkNotDuplicate = useCallback(() => {
    if (!selectedCandidate) return;

    // Store in localStorage - support both single and multi-record formats
    try {
      const notDuplicates = JSON.parse(localStorage.getItem('confirmed_not_duplicates') || '[]');

      // Get all record IDs involved
      const recordIds = [
        selectedCandidate.survivor.record.id,
        ...(selectedCandidate.toMerge || [selectedCandidate.merged]).map(r => r.record.id)
      ].sort();

      // Create a unique key for this group
      const groupKey = recordIds.join('|');

      if (!notDuplicates.includes(groupKey)) {
        notDuplicates.push(groupKey);
        localStorage.setItem('confirmed_not_duplicates', JSON.stringify(notDuplicates));
        const count = recordIds.length;
        addLog(`Marked ${count} records as not duplicates`, 'success');
      }
    } catch (e) {
      addLog('Failed to save not-duplicate marker', 'error');
    }

    setSelectedCandidate(null);
    setCurrentView('scan');
  }, [selectedCandidate, addLog]);

  // Handle unmerge initiation
  const handleUnmergeRequest = useCallback((record, mergeEvent) => {
    setUnmergeTarget({ record, mergeEvent });
  }, []);

  // Handle unmerge completion
  const handleUnmergeComplete = useCallback((result) => {
    addLog(`Unmerge completed: ${result.unmergeId}`, 'success');
    setUnmergeTarget(null);
  }, [addLog]);

  // Handle unmerge cancel
  const handleUnmergeCancel = useCallback(() => {
    setUnmergeTarget(null);
  }, []);

  // Navigation
  const renderNavigation = () => {
    if (currentView === 'setup') return null;

    return (
      <nav className="app-nav">
        <button
          className={`nav-button ${currentView === 'scan' ? 'active' : ''}`}
          onClick={() => setCurrentView('scan')}
        >
          Scan
        </button>
        <button
          className={`nav-button ${currentView === 'history' ? 'active' : ''}`}
          onClick={() => setCurrentView('history')}
        >
          History
        </button>
        <button
          className={`nav-button ${currentView === 'config' ? 'active' : ''}`}
          onClick={() => setCurrentView('config')}
        >
          Config
        </button>
        <button
          className="nav-button"
          onClick={() => {
            setCredentials(null);
            setSchema(null);
            setCurrentView('setup');
          }}
        >
          Disconnect
        </button>
      </nav>
    );
  };

  // Render current view
  const renderView = () => {
    switch (currentView) {
      case 'setup':
        return (
          <Setup
            onComplete={handleSetupComplete}
            onLog={addLog}
          />
        );

      case 'config':
        return (
          <ConfigPanel
            schema={schema}
            initialConfig={fieldConfig}
            onComplete={handleConfigComplete}
            onLog={addLog}
          />
        );

      case 'scan':
        return (
          <ScanResults
            credentials={credentials}
            schema={schema}
            fieldConfig={fieldConfig}
            onSelectCandidate={handleSelectCandidate}
            onLog={addLog}
          />
        );

      case 'review':
        return (
          <MergeReview
            candidate={selectedCandidate}
            schema={schema}
            credentials={credentials}
            fieldConfig={fieldConfig}
            onComplete={handleMergeComplete}
            onSkip={handleSkip}
            onMarkNotDuplicate={handleMarkNotDuplicate}
            onLog={addLog}
          />
        );

      case 'history':
        return (
          <HistoryViewer
            credentials={credentials}
            schema={schema}
            onUnmerge={handleUnmergeRequest}
            onLog={addLog}
          />
        );

      default:
        return <div>Unknown view: {currentView}</div>;
    }
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <h1>Airtable Dedupe</h1>
        <p className="subtitle">Client Deduplication Tool</p>
        {renderNavigation()}
      </header>

      {/* Main Content */}
      <main className="app-main">
        {renderView()}
      </main>

      {/* Activity Log */}
      <aside className="activity-log">
        <div className="log-header">
          <h3>Activity Log</h3>
          <button
            className="btn-clear"
            onClick={() => setLogs([])}
          >
            Clear
          </button>
        </div>
        <div className="log-container" ref={logRef}>
          {logs.length === 0 ? (
            <div className="log-entry info">Ready</div>
          ) : (
            logs.map((log, idx) => (
              <div key={idx} className={`log-entry ${log.type}`}>
                <span className="log-time">[{log.timestamp}]</span>
                <span className="log-message">{log.message}</span>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Unmerge Modal */}
      {unmergeTarget && (
        <UnmergeModal
          record={unmergeTarget.record}
          mergeEvent={unmergeTarget.mergeEvent}
          schema={schema}
          credentials={credentials}
          onComplete={handleUnmergeComplete}
          onCancel={handleUnmergeCancel}
          onLog={addLog}
        />
      )}
    </div>
  );
}
