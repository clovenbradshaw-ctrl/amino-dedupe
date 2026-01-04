import React, { useState, useCallback } from 'react'
import Setup from './components/Setup'
import ScanResults from './components/ScanResults'
import MergeReview from './components/MergeReview'

export default function App() {
  const [view, setView] = useState('setup')
  const [credentials, setCredentials] = useState(null)
  const [schema, setSchema] = useState(null)
  const [records, setRecords] = useState([])
  const [candidates, setCandidates] = useState([])
  const [selectedCandidate, setSelectedCandidate] = useState(null)
  const [logs, setLogs] = useState([])

  const addLog = useCallback((message, type = 'info') => {
    const time = new Date().toLocaleTimeString()
    setLogs(prev => [...prev.slice(-99), { message, type, time }])
  }, [])

  const handleSetupComplete = useCallback((data) => {
    setCredentials({ apiKey: data.apiKey, baseId: data.baseId, tableName: data.tableName })
    setSchema(data.schema)
    setRecords(data.records || [])
    addLog('Connected to Airtable', 'success')
    setView('scan')
  }, [addLog])

  const handleSelectCandidate = useCallback((candidate) => {
    setSelectedCandidate(candidate)
    setView('review')
  }, [])

  const handleMergeComplete = useCallback(() => {
    setSelectedCandidate(null)
    setView('scan')
    addLog('Merge completed', 'success')
  }, [addLog])

  const handleBack = useCallback(() => {
    setSelectedCandidate(null)
    setView('scan')
  }, [])

  const handleDisconnect = useCallback(() => {
    setCredentials(null)
    setSchema(null)
    setRecords([])
    setCandidates([])
    setView('setup')
  }, [])

  return (
    <div className="app">
      <header className="header">
        <h1>Airtable Dedupe</h1>
        {view !== 'setup' && (
          <nav className="nav">
            <button
              className={view === 'scan' ? 'active' : ''}
              onClick={() => setView('scan')}
            >
              Scan
            </button>
            <button onClick={handleDisconnect}>Disconnect</button>
          </nav>
        )}
      </header>

      <main className="main">
        {view === 'setup' && (
          <Setup onComplete={handleSetupComplete} onLog={addLog} />
        )}
        {view === 'scan' && (
          <ScanResults
            credentials={credentials}
            schema={schema}
            records={records}
            candidates={candidates}
            setCandidates={setCandidates}
            onSelect={handleSelectCandidate}
            onLog={addLog}
          />
        )}
        {view === 'review' && selectedCandidate && (
          <MergeReview
            candidate={selectedCandidate}
            credentials={credentials}
            schema={schema}
            onComplete={handleMergeComplete}
            onBack={handleBack}
            onLog={addLog}
          />
        )}
      </main>

      <aside className="log-panel">
        <div className="log-header">
          <span>Activity Log</span>
          <button onClick={() => setLogs([])}>Clear</button>
        </div>
        <div className="log-list">
          {logs.length === 0 ? (
            <div className="log-entry">Ready</div>
          ) : (
            logs.map((log, i) => (
              <div key={i} className={`log-entry ${log.type}`}>
                <span className="log-time">[{log.time}]</span> {log.message}
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  )
}
