import React, { useState } from 'react'

const API_URL = 'https://api.airtable.com/v0'

export default function Setup({ onComplete, onLog }) {
  const [apiKey, setApiKey] = useState('')
  const [baseId, setBaseId] = useState('')
  const [tableName, setTableName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleConnect = async (e) => {
    e.preventDefault()
    if (!apiKey || !baseId || !tableName) {
      setError('Please fill in all fields')
      return
    }

    setError(null)
    setLoading(true)
    onLog('Connecting to Airtable...', 'info')

    try {
      // Fetch schema
      const metaRes = await fetch(`${API_URL}/meta/bases/${baseId}/tables`, {
        headers: { Authorization: `Bearer ${apiKey}` }
      })

      if (!metaRes.ok) {
        const err = await metaRes.json().catch(() => ({}))
        throw new Error(err.error?.message || `Failed to connect: ${metaRes.status}`)
      }

      const metaData = await metaRes.json()
      const table = metaData.tables.find(t => t.name === tableName || t.id === tableName)

      if (!table) {
        throw new Error(`Table "${tableName}" not found`)
      }

      // Build schema
      const computedTypes = ['formula', 'rollup', 'count', 'lookup', 'autoNumber', 'createdTime', 'lastModifiedTime', 'createdBy', 'lastModifiedBy']
      const schema = {
        tableName: table.name,
        tableId: table.id,
        fields: table.fields.map(f => ({
          name: f.name,
          type: f.type,
          isComputed: computedTypes.includes(f.type),
          isLink: f.type === 'multipleRecordLinks'
        }))
      }

      onLog(`Found ${schema.fields.length} fields`, 'success')

      // Fetch records
      onLog('Fetching records...', 'info')
      const records = []
      let offset = null

      do {
        const params = new URLSearchParams({ pageSize: '100' })
        if (offset) params.append('offset', offset)

        const url = `${API_URL}/${baseId}/${encodeURIComponent(tableName)}?${params}`
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${apiKey}` }
        })

        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error?.message || `Failed to fetch records: ${res.status}`)
        }

        const data = await res.json()
        records.push(...data.records)
        offset = data.offset
        onLog(`Loaded ${records.length} records...`, 'info')

        if (offset) await new Promise(r => setTimeout(r, 100))
      } while (offset)

      onLog(`Fetched ${records.length} total records`, 'success')

      onComplete({
        apiKey,
        baseId,
        tableName,
        schema,
        records
      })
    } catch (err) {
      setError(err.message)
      onLog(err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="setup">
      <div className="card">
        <h2>Connect to Airtable</h2>
        <p className="text-muted">Enter your Airtable credentials. They stay in your browser.</p>

        <form onSubmit={handleConnect}>
          <div className="form-group">
            <label>Personal Access Token</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="pat_..."
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label>Base ID</label>
            <input
              type="text"
              value={baseId}
              onChange={(e) => setBaseId(e.target.value)}
              placeholder="app..."
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label>Table Name</label>
            <input
              type="text"
              value={tableName}
              onChange={(e) => setTableName(e.target.value)}
              placeholder="Clients"
              disabled={loading}
            />
          </div>

          {error && <div className="error">{error}</div>}

          <button type="submit" className="btn primary" disabled={loading}>
            {loading ? 'Connecting...' : 'Connect'}
          </button>
        </form>
      </div>
    </div>
  )
}
