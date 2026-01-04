import React, { useState, useCallback, useRef, useEffect } from 'react';
import Setup from './components/Setup.jsx';
import CompareResults from './components/CompareResults.jsx';

/**
 * Two-Table Dedupe App
 * Compare records across two Airtable tables to find duplicates.
 */
export default function App() {
  const [currentView, setCurrentView] = useState('setup'); // setup, compare
  const [connection, setConnection] = useState(null); // { apiKey, baseId, table1, table2 }

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
    setConnection(data);
    addLog(`Connected! Comparing "${data.table1.name}" with "${data.table2.name}"`, 'success');
    setCurrentView('compare');
  }, [addLog]);

  // Handle disconnect
  const handleDisconnect = useCallback(() => {
    setConnection(null);
    setCurrentView('setup');
    addLog('Disconnected', 'info');
  }, [addLog]);

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

      case 'compare':
        return (
          <CompareResults
            connection={connection}
            onDisconnect={handleDisconnect}
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
        <h1>Table Dedupe</h1>
        <p className="subtitle">Compare Two Tables for Duplicates</p>
        {currentView !== 'setup' && (
          <nav className="app-nav">
            <button className="nav-button" onClick={handleDisconnect}>
              ← Back to Setup
            </button>
          </nav>
        )}
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
    </div>
  );
}
