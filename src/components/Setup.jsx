import React, { useState, useEffect } from 'react';
import { AirtableClient, getStoredCredentials, storeCredentials } from '../lib/airtable.js';

/**
 * Setup Component
 * Handles API key, base ID, and table configuration.
 * Credentials are stored in localStorage (never leave the browser).
 */
export default function Setup({ onComplete, onLog }) {
  const [apiKey, setApiKey] = useState('');
  const [baseId, setBaseId] = useState('');
  const [tableName, setTableName] = useState('Client Info');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [validated, setValidated] = useState(false);
  const [recordCount, setRecordCount] = useState(null);
  const [schema, setSchema] = useState(null);

  // Load stored credentials on mount
  useEffect(() => {
    const stored = getStoredCredentials();
    if (stored) {
      setApiKey(stored.apiKey || '');
      setBaseId(stored.baseId || '');
      setTableName(stored.tableName || 'Client Info');
    }
  }, []);

  const log = (message, type = 'info') => {
    if (onLog) onLog(message, type);
  };

  const handleValidate = async () => {
    if (!apiKey || !baseId || !tableName) {
      setError('Please fill in all fields');
      return;
    }

    setLoading(true);
    setError(null);
    setValidated(false);

    try {
      log('Connecting to Airtable...', 'info');
      const client = new AirtableClient(apiKey, baseId);

      // Fetch schema to validate connection and learn field types
      log('Fetching table schema...', 'info');
      const tableSchema = await client.getTableSchema(tableName);

      setSchema(tableSchema);
      log(`Schema loaded: ${tableSchema.writableFields.length} writable fields, ${tableSchema.computedFields.length} computed fields`, 'success');

      // Fetch a small sample to verify read access
      log('Verifying read access...', 'info');
      const sample = await client.getAllRecords(tableName, {
        fields: ['Client Name'],
        onProgress: (p) => {
          if (p.page === 1) {
            log(`Found records, continuing count...`, 'info');
          }
        },
      });

      setRecordCount(sample.length);
      setValidated(true);
      log(`Successfully connected! Found ${sample.length} records.`, 'success');

      // Store credentials
      storeCredentials({ apiKey, baseId, tableName });
    } catch (err) {
      setError(err.message);
      log(`Connection failed: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = () => {
    if (onComplete) {
      onComplete({
        apiKey,
        baseId,
        tableName,
        schema,
        recordCount,
      });
    }
  };

  return (
    <div className="setup-container">
      <div className="setup-card">
        <h2>Connect to Airtable</h2>
        <p className="setup-subtitle">
          Enter your Airtable credentials. They're stored locally in your browser and never sent to any server.
        </p>

        <div className="form-group">
          <label htmlFor="apiKey">Personal Access Token</label>
          <input
            id="apiKey"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="pat_xxxxxxxxxxxx"
            disabled={loading}
          />
          <small>
            Get your token from{' '}
            <a href="https://airtable.com/create/tokens" target="_blank" rel="noopener noreferrer">
              airtable.com/create/tokens
            </a>
          </small>
        </div>

        <div className="form-group">
          <label htmlFor="baseId">Base ID</label>
          <input
            id="baseId"
            type="text"
            value={baseId}
            onChange={(e) => setBaseId(e.target.value)}
            placeholder="appXXXXXXXXXXXXXX"
            disabled={loading}
          />
          <small>Found in your base URL: airtable.com/[baseId]/...</small>
        </div>

        <div className="form-group">
          <label htmlFor="tableName">Table Name</label>
          <input
            id="tableName"
            type="text"
            value={tableName}
            onChange={(e) => setTableName(e.target.value)}
            placeholder="Client Info"
            disabled={loading}
          />
        </div>

        {error && (
          <div className="error-message">
            {error}
          </div>
        )}

        {validated && (
          <div className="success-message">
            <div className="success-icon">✓</div>
            <div>
              <strong>Connected successfully!</strong>
              <p>{recordCount.toLocaleString()} records found in {tableName}</p>
              <p>{schema?.writableFields.length} writable fields, {schema?.computedFields.length} computed (read-only)</p>
            </div>
          </div>
        )}

        <div className="button-group">
          <button
            className="btn btn-primary"
            onClick={handleValidate}
            disabled={loading || !apiKey || !baseId || !tableName}
          >
            {loading ? 'Connecting...' : validated ? 'Re-validate' : 'Connect'}
          </button>

          {validated && (
            <button
              className="btn btn-success"
              onClick={handleContinue}
            >
              Continue to Configuration →
            </button>
          )}
        </div>

        {schema && (
          <details className="schema-details">
            <summary>View Schema Details</summary>
            <div className="schema-content">
              <h4>Writable Fields ({schema.writableFields.length})</h4>
              <ul className="field-list">
                {schema.writableFields.map(f => (
                  <li key={f} className={schema.linkFields.includes(f) ? 'link-field' : ''}>
                    {f}
                    {schema.linkFields.includes(f) && <span className="field-tag">link</span>}
                  </li>
                ))}
              </ul>

              <h4>Computed Fields ({schema.computedFields.length})</h4>
              <ul className="field-list computed">
                {schema.computedFields.map(f => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
