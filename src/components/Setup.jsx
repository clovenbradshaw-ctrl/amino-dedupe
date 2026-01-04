import React, { useState, useEffect } from 'react';
import { AirtableClient, getStoredCredentials, storeCredentials } from '../lib/airtable.js';

/**
 * Setup Component
 * Configure API key, base ID, and select TWO tables to compare.
 */
export default function Setup({ onComplete, onLog }) {
  const [apiKey, setApiKey] = useState('');
  const [baseId, setBaseId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Available tables from the base
  const [availableTables, setAvailableTables] = useState([]);
  const [tablesLoaded, setTablesLoaded] = useState(false);

  // Selected tables
  const [table1Name, setTable1Name] = useState('');
  const [table2Name, setTable2Name] = useState('');

  // Table info after validation
  const [table1Info, setTable1Info] = useState(null);
  const [table2Info, setTable2Info] = useState(null);
  const [validated, setValidated] = useState(false);

  // Load stored credentials on mount
  useEffect(() => {
    const stored = getStoredCredentials();
    if (stored) {
      setApiKey(stored.apiKey || '');
      setBaseId(stored.baseId || '');
      if (stored.table1Name) setTable1Name(stored.table1Name);
      if (stored.table2Name) setTable2Name(stored.table2Name);
    }
  }, []);

  const log = (message, type = 'info') => {
    if (onLog) onLog(message, type);
  };

  // Fetch available tables when API key and base ID are provided
  const handleFetchTables = async () => {
    if (!apiKey || !baseId) {
      setError('Please enter API key and Base ID first');
      return;
    }

    setLoading(true);
    setError(null);
    setTablesLoaded(false);
    setAvailableTables([]);

    try {
      log('Connecting to Airtable...', 'info');
      const client = new AirtableClient(apiKey, baseId);

      // Fetch base metadata to get list of tables
      const response = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `API error: ${response.status}`);
      }

      const data = await response.json();
      const tables = data.tables.map(t => ({
        id: t.id,
        name: t.name,
        fieldCount: t.fields?.length || 0,
      }));

      setAvailableTables(tables);
      setTablesLoaded(true);
      log(`Found ${tables.length} tables in base`, 'success');

      // Store credentials
      storeCredentials({ apiKey, baseId, table1Name, table2Name });
    } catch (err) {
      setError(err.message);
      log(`Failed to fetch tables: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Validate selected tables
  const handleValidate = async () => {
    if (!table1Name || !table2Name) {
      setError('Please select both tables');
      return;
    }

    if (table1Name === table2Name) {
      setError('Please select two different tables');
      return;
    }

    setLoading(true);
    setError(null);
    setValidated(false);

    try {
      const client = new AirtableClient(apiKey, baseId);

      // Fetch schema for table 1
      log(`Fetching schema for "${table1Name}"...`, 'info');
      const schema1 = await client.getTableSchema(table1Name);

      // Count records in table 1
      const records1 = await client.getAllRecords(table1Name, {
        fields: [schema1.writableFields[0] || schema1.computedFields[0]],
      });

      setTable1Info({
        name: table1Name,
        schema: schema1,
        recordCount: records1.length,
      });
      log(`Table 1: ${records1.length} records, ${schema1.writableFields.length} fields`, 'success');

      // Fetch schema for table 2
      log(`Fetching schema for "${table2Name}"...`, 'info');
      const schema2 = await client.getTableSchema(table2Name);

      // Count records in table 2
      const records2 = await client.getAllRecords(table2Name, {
        fields: [schema2.writableFields[0] || schema2.computedFields[0]],
      });

      setTable2Info({
        name: table2Name,
        schema: schema2,
        recordCount: records2.length,
      });
      log(`Table 2: ${records2.length} records, ${schema2.writableFields.length} fields`, 'success');

      setValidated(true);
      log('Both tables validated successfully!', 'success');

      // Store credentials
      storeCredentials({ apiKey, baseId, table1Name, table2Name });
    } catch (err) {
      setError(err.message);
      log(`Validation failed: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = () => {
    if (onComplete) {
      onComplete({
        apiKey,
        baseId,
        table1: table1Info,
        table2: table2Info,
      });
    }
  };

  return (
    <div className="setup-container">
      <div className="setup-card">
        <h2>Connect to Airtable</h2>
        <p className="setup-subtitle">
          Enter your credentials and select two tables to compare for duplicates.
        </p>

        {/* Step 1: API Credentials */}
        <div className="setup-section">
          <h3>Step 1: API Credentials</h3>

          <div className="form-group">
            <label htmlFor="apiKey">Personal Access Token</label>
            <input
              id="apiKey"
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setTablesLoaded(false);
                setValidated(false);
              }}
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
              onChange={(e) => {
                setBaseId(e.target.value);
                setTablesLoaded(false);
                setValidated(false);
              }}
              placeholder="appXXXXXXXXXXXXXX"
              disabled={loading}
            />
            <small>Found in your base URL: airtable.com/[baseId]/...</small>
          </div>

          <button
            className="btn btn-primary"
            onClick={handleFetchTables}
            disabled={loading || !apiKey || !baseId}
          >
            {loading && !tablesLoaded ? 'Connecting...' : tablesLoaded ? 'Refresh Tables' : 'Connect & Load Tables'}
          </button>
        </div>

        {/* Step 2: Select Tables */}
        {tablesLoaded && (
          <div className="setup-section">
            <h3>Step 2: Select Tables to Compare</h3>

            <div className="table-selection">
              <div className="form-group">
                <label htmlFor="table1">Table 1 (Source)</label>
                <select
                  id="table1"
                  value={table1Name}
                  onChange={(e) => {
                    setTable1Name(e.target.value);
                    setValidated(false);
                  }}
                  disabled={loading}
                >
                  <option value="">-- Select Table --</option>
                  {availableTables.map(t => (
                    <option key={t.id} value={t.name} disabled={t.name === table2Name}>
                      {t.name} ({t.fieldCount} fields)
                    </option>
                  ))}
                </select>
              </div>

              <div className="compare-arrow">⟷</div>

              <div className="form-group">
                <label htmlFor="table2">Table 2 (Target)</label>
                <select
                  id="table2"
                  value={table2Name}
                  onChange={(e) => {
                    setTable2Name(e.target.value);
                    setValidated(false);
                  }}
                  disabled={loading}
                >
                  <option value="">-- Select Table --</option>
                  {availableTables.map(t => (
                    <option key={t.id} value={t.name} disabled={t.name === table1Name}>
                      {t.name} ({t.fieldCount} fields)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              className="btn btn-primary"
              onClick={handleValidate}
              disabled={loading || !table1Name || !table2Name || table1Name === table2Name}
            >
              {loading ? 'Validating...' : 'Validate Tables'}
            </button>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="error-message">
            {error}
          </div>
        )}

        {/* Validation Success */}
        {validated && table1Info && table2Info && (
          <div className="validation-success">
            <div className="success-message">
              <div className="success-icon">✓</div>
              <div>
                <strong>Tables validated successfully!</strong>
              </div>
            </div>

            <div className="tables-summary">
              <div className="table-summary">
                <h4>{table1Info.name}</h4>
                <p>{table1Info.recordCount.toLocaleString()} records</p>
                <p>{table1Info.schema.writableFields.length} writable fields</p>
              </div>
              <div className="compare-icon">⟷</div>
              <div className="table-summary">
                <h4>{table2Info.name}</h4>
                <p>{table2Info.recordCount.toLocaleString()} records</p>
                <p>{table2Info.schema.writableFields.length} writable fields</p>
              </div>
            </div>

            <button
              className="btn btn-success btn-large"
              onClick={handleContinue}
            >
              Start Comparison →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
