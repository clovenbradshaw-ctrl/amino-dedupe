import React, { useState, useMemo } from 'react'

const API_URL = 'https://api.airtable.com/v0'

export default function MergeReview({ candidate, credentials, schema, onComplete, onBack, onLog }) {
  const [selections, setSelections] = useState({})
  const [merging, setMerging] = useState(false)

  const { recordA, recordB, nameA, nameB } = candidate

  // Get all fields from both records
  const allFields = useMemo(() => {
    const fields = new Set([
      ...Object.keys(recordA.fields),
      ...Object.keys(recordB.fields)
    ])
    return Array.from(fields).sort()
  }, [recordA, recordB])

  // Check if field is computed (read-only)
  const isComputed = (fieldName) => {
    const field = schema?.fields?.find(f => f.name === fieldName)
    return field?.isComputed || false
  }

  // Get selected value for a field
  const getSelected = (fieldName) => {
    if (selections[fieldName] !== undefined) {
      return selections[fieldName]
    }
    // Default: prefer non-empty value from A, else B
    const valA = recordA.fields[fieldName]
    const valB = recordB.fields[fieldName]
    if (valA !== undefined && valA !== null && valA !== '') return 'A'
    if (valB !== undefined && valB !== null && valB !== '') return 'B'
    return 'A'
  }

  // Handle selection change
  const handleSelect = (fieldName, choice) => {
    setSelections(prev => ({ ...prev, [fieldName]: choice }))
  }

  // Build merged fields
  const buildMergedFields = () => {
    const merged = {}
    for (const fieldName of allFields) {
      if (isComputed(fieldName)) continue
      const choice = getSelected(fieldName)
      const value = choice === 'A' ? recordA.fields[fieldName] : recordB.fields[fieldName]
      if (value !== undefined && value !== null) {
        merged[fieldName] = value
      }
    }
    return merged
  }

  // Execute merge
  const handleMerge = async () => {
    setMerging(true)
    onLog('Starting merge...', 'info')

    try {
      const mergedFields = buildMergedFields()

      // Update survivor record (A)
      onLog('Updating survivor record...', 'info')
      const updateRes = await fetch(
        `${API_URL}/${credentials.baseId}/${encodeURIComponent(credentials.tableName)}/${recordA.id}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${credentials.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ fields: mergedFields })
        }
      )

      if (!updateRes.ok) {
        const err = await updateRes.json().catch(() => ({}))
        throw new Error(err.error?.message || 'Failed to update record')
      }

      // Delete merged record (B)
      onLog('Deleting duplicate record...', 'info')
      const deleteRes = await fetch(
        `${API_URL}/${credentials.baseId}/${encodeURIComponent(credentials.tableName)}/${recordB.id}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${credentials.apiKey}`
          }
        }
      )

      if (!deleteRes.ok) {
        const err = await deleteRes.json().catch(() => ({}))
        throw new Error(err.error?.message || 'Failed to delete record')
      }

      onLog('Merge completed successfully!', 'success')
      onComplete()
    } catch (err) {
      onLog(`Merge failed: ${err.message}`, 'error')
    } finally {
      setMerging(false)
    }
  }

  const formatValue = (val) => {
    if (val === undefined || val === null) return '(empty)'
    if (Array.isArray(val)) return val.join(', ')
    if (typeof val === 'object') return JSON.stringify(val)
    return String(val)
  }

  return (
    <div className="review">
      <div className="review-header">
        <h2>Review Merge</h2>
        <div className="confidence-badge">{candidate.confidence}% match</div>
      </div>

      <div className="review-records">
        <div className="record-header">
          <div className="col-a">
            <span className="label keep">KEEP</span>
            <span className="name">{nameA}</span>
          </div>
          <div className="col-b">
            <span className="label merge">MERGE</span>
            <span className="name">{nameB}</span>
          </div>
        </div>

        <div className="field-list">
          {allFields.map(fieldName => {
            const valA = recordA.fields[fieldName]
            const valB = recordB.fields[fieldName]
            const computed = isComputed(fieldName)
            const selected = getSelected(fieldName)
            const same = JSON.stringify(valA) === JSON.stringify(valB)

            return (
              <div key={fieldName} className={`field-row ${computed ? 'computed' : ''} ${same ? 'same' : 'different'}`}>
                <div className="field-name">
                  {fieldName}
                  {computed && <span className="tag computed">read-only</span>}
                </div>
                <div
                  className={`field-value col-a ${!computed && selected === 'A' ? 'selected' : ''}`}
                  onClick={() => !computed && handleSelect(fieldName, 'A')}
                >
                  {formatValue(valA)}
                </div>
                <div
                  className={`field-value col-b ${!computed && selected === 'B' ? 'selected' : ''}`}
                  onClick={() => !computed && handleSelect(fieldName, 'B')}
                >
                  {formatValue(valB)}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="review-actions">
        <button className="btn" onClick={onBack} disabled={merging}>
          Back
        </button>
        <button className="btn primary" onClick={handleMerge} disabled={merging}>
          {merging ? 'Merging...' : 'Merge Records'}
        </button>
      </div>
    </div>
  )
}
