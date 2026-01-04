import React, { useState, useMemo } from 'react'

// Simple string similarity (Levenshtein-based)
function similarity(a, b) {
  if (!a || !b) return 0
  a = String(a).toLowerCase().trim()
  b = String(b).toLowerCase().trim()
  if (a === b) return 1

  const longer = a.length > b.length ? a : b
  const shorter = a.length > b.length ? b : a

  if (longer.length === 0) return 1

  const costs = []
  for (let i = 0; i <= shorter.length; i++) {
    let lastValue = i
    for (let j = 0; j <= longer.length; j++) {
      if (i === 0) costs[j] = j
      else if (j > 0) {
        let newValue = costs[j - 1]
        if (shorter[i - 1] !== longer[j - 1]) {
          newValue = Math.min(newValue, lastValue, costs[j]) + 1
        }
        costs[j - 1] = lastValue
        lastValue = newValue
      }
    }
    if (i > 0) costs[longer.length] = lastValue
  }

  return (longer.length - costs[longer.length]) / longer.length
}

// Get display name from record
function getName(record) {
  const fields = record.fields
  const nameField = fields['Client Name'] || fields['Name'] || fields['Full Name'] ||
    fields['Company'] || fields['Title'] || Object.values(fields)[0]
  return nameField || record.id
}

// Find duplicates in records
function findDuplicates(records) {
  const candidates = []

  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      const a = records[i]
      const b = records[j]
      const nameA = getName(a)
      const nameB = getName(b)

      const nameSim = similarity(nameA, nameB)

      // Check for exact matches on key fields
      const emailA = a.fields['Email'] || a.fields['email'] || ''
      const emailB = b.fields['Email'] || b.fields['email'] || ''
      const phoneA = String(a.fields['Phone'] || a.fields['phone'] || '').replace(/\D/g, '')
      const phoneB = String(b.fields['Phone'] || b.fields['phone'] || '').replace(/\D/g, '')

      let confidence = 0
      const reasons = []

      // Exact email match
      if (emailA && emailB && emailA.toLowerCase() === emailB.toLowerCase()) {
        confidence = Math.max(confidence, 95)
        reasons.push('Same email')
      }

      // Exact phone match
      if (phoneA && phoneB && phoneA === phoneB && phoneA.length >= 7) {
        confidence = Math.max(confidence, 90)
        reasons.push('Same phone')
      }

      // High name similarity
      if (nameSim >= 0.9) {
        confidence = Math.max(confidence, 85)
        reasons.push('Very similar name')
      } else if (nameSim >= 0.8) {
        confidence = Math.max(confidence, 75)
        reasons.push('Similar name')
      } else if (nameSim >= 0.7) {
        confidence = Math.max(confidence, 65)
        reasons.push('Possibly similar name')
      }

      if (confidence >= 65) {
        candidates.push({
          id: `${a.id}-${b.id}`,
          recordA: a,
          recordB: b,
          nameA,
          nameB,
          confidence,
          reasons
        })
      }
    }
  }

  return candidates.sort((a, b) => b.confidence - a.confidence)
}

export default function ScanResults({ records, candidates, setCandidates, onSelect, onLog }) {
  const [scanning, setScanning] = useState(false)
  const [filter, setFilter] = useState('')

  const handleScan = () => {
    setScanning(true)
    onLog('Scanning for duplicates...', 'info')

    // Use setTimeout to avoid blocking UI
    setTimeout(() => {
      const found = findDuplicates(records)
      setCandidates(found)
      onLog(`Found ${found.length} potential duplicates`, 'success')
      setScanning(false)
    }, 100)
  }

  const filtered = useMemo(() => {
    if (!filter.trim()) return candidates
    const q = filter.toLowerCase()
    return candidates.filter(c =>
      c.nameA.toLowerCase().includes(q) ||
      c.nameB.toLowerCase().includes(q)
    )
  }, [candidates, filter])

  return (
    <div className="scan">
      <div className="scan-header">
        <div>
          <h2>Duplicate Scanner</h2>
          <p className="text-muted">{records.length} records loaded</p>
        </div>
        <button
          className="btn primary"
          onClick={handleScan}
          disabled={scanning || records.length === 0}
        >
          {scanning ? 'Scanning...' : candidates.length > 0 ? 'Re-scan' : 'Scan for Duplicates'}
        </button>
      </div>

      {candidates.length > 0 && (
        <>
          <div className="scan-filters">
            <input
              type="text"
              placeholder="Filter by name..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <span className="text-muted">{filtered.length} of {candidates.length} matches</span>
          </div>

          <div className="candidate-list">
            {filtered.slice(0, 100).map(c => (
              <div
                key={c.id}
                className={`candidate-row ${c.confidence >= 90 ? 'high' : c.confidence >= 75 ? 'medium' : 'low'}`}
                onClick={() => onSelect(c)}
              >
                <div className="confidence">
                  <span className="badge">{c.confidence}%</span>
                </div>
                <div className="names">
                  <div className="name">{c.nameA}</div>
                  <div className="arrow">+</div>
                  <div className="name">{c.nameB}</div>
                </div>
                <div className="reasons">
                  {c.reasons.map((r, i) => (
                    <span key={i} className="tag">{r}</span>
                  ))}
                </div>
                <button className="btn small">Review</button>
              </div>
            ))}
            {filtered.length > 100 && (
              <div className="text-muted" style={{ padding: '1rem', textAlign: 'center' }}>
                Showing first 100 of {filtered.length} matches
              </div>
            )}
          </div>
        </>
      )}

      {!scanning && records.length > 0 && candidates.length === 0 && (
        <div className="empty">
          <p>Click "Scan for Duplicates" to analyze your records.</p>
        </div>
      )}
    </div>
  )
}
