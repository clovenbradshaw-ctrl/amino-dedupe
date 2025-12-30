import React, { useState, useEffect } from 'react';
import { DEFAULT_FIELD_CONFIG } from '../lib/matching.js';
import { DEFAULT_RESOLUTION_CONFIG } from '../lib/merge.js';

/**
 * ConfigPanel Component
 * Allows user to configure which fields are used for matching and how they're merged.
 */
export default function ConfigPanel({ schema, onComplete, initialConfig, onLog }) {
  const [config, setConfig] = useState(() => {
    // Start with defaults, merge with any initial config
    return {
      // Matching configuration
      uniqueIdFields: initialConfig?.uniqueIdFields || DEFAULT_FIELD_CONFIG.uniqueIdFields,
      nameFields: initialConfig?.nameFields || DEFAULT_FIELD_CONFIG.nameFields,
      corroboratingFields: initialConfig?.corroboratingFields || DEFAULT_FIELD_CONFIG.corroboratingFields,

      // Merge configuration
      excludeFromMerge: initialConfig?.excludeFromMerge || DEFAULT_RESOLUTION_CONFIG.excludeFields,
      concatenateFields: initialConfig?.concatenateFields || DEFAULT_RESOLUTION_CONFIG.concatenateFields,
      linkFields: initialConfig?.linkFields || schema?.linkFields || [],

      // History field
      historyField: initialConfig?.historyField || 'dedupe_history',
    };
  });

  // Filter available fields based on schema
  const availableFields = schema?.writableFields || [];
  const allFields = schema?.allFields ? Object.keys(schema.allFields) : [];

  const updateConfig = (key, value) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const toggleArrayItem = (key, item) => {
    setConfig(prev => {
      const current = prev[key] || [];
      if (current.includes(item)) {
        return { ...prev, [key]: current.filter(i => i !== item) };
      } else {
        return { ...prev, [key]: [...current, item] };
      }
    });
  };

  const handleSave = () => {
    // Save config to localStorage
    try {
      localStorage.setItem('dedupe_field_config', JSON.stringify(config));
      if (onLog) onLog('Configuration saved', 'success');
    } catch (e) {
      if (onLog) onLog('Failed to save configuration', 'error');
    }

    if (onComplete) {
      onComplete(config);
    }
  };

  // Load saved config on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('dedupe_field_config');
      if (saved) {
        const parsed = JSON.parse(saved);
        setConfig(prev => ({ ...prev, ...parsed }));
      }
    } catch (e) {
      // Ignore
    }
  }, []);

  return (
    <div className="config-panel">
      <div className="config-card">
        <h2>Field Configuration</h2>
        <p className="config-subtitle">
          Configure how fields are used for duplicate detection and merging.
        </p>

        {/* Unique ID Fields */}
        <section className="config-section">
          <h3>Unique ID Fields (Tier 1 Match)</h3>
          <p className="section-description">
            Exact matches on these fields result in 100% confidence. Select fields that should uniquely identify a person.
          </p>
          <div className="field-checkbox-grid">
            {allFields.filter(f => !schema?.linkFields?.includes(f)).map(field => (
              <label key={field} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={config.uniqueIdFields.includes(field)}
                  onChange={() => toggleArrayItem('uniqueIdFields', field)}
                />
                <span className={schema?.computedFields?.includes(field) ? 'computed' : ''}>
                  {field}
                </span>
              </label>
            ))}
          </div>
        </section>

        {/* Name Fields */}
        <section className="config-section">
          <h3>Name Fields (Fuzzy Match)</h3>
          <p className="section-description">
            These fields are used for fuzzy name matching with nickname recognition.
          </p>
          <div className="field-checkbox-grid">
            {allFields.filter(f =>
              f.toLowerCase().includes('name') &&
              !schema?.linkFields?.includes(f)
            ).map(field => (
              <label key={field} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={config.nameFields.includes(field)}
                  onChange={() => toggleArrayItem('nameFields', field)}
                />
                <span className={schema?.computedFields?.includes(field) ? 'computed' : ''}>
                  {field}
                </span>
              </label>
            ))}
          </div>
        </section>

        {/* Corroborating Fields */}
        <section className="config-section">
          <h3>Corroborating Fields</h3>
          <p className="section-description">
            Matches on these fields increase confidence when combined with name matches.
          </p>
          <div className="field-checkbox-grid">
            {allFields.filter(f =>
              !schema?.linkFields?.includes(f) &&
              !config.uniqueIdFields.includes(f) &&
              !config.nameFields.includes(f)
            ).map(field => (
              <label key={field} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={config.corroboratingFields.includes(field)}
                  onChange={() => toggleArrayItem('corroboratingFields', field)}
                />
                <span className={schema?.computedFields?.includes(field) ? 'computed' : ''}>
                  {field}
                </span>
              </label>
            ))}
          </div>
        </section>

        {/* Exclude from Merge */}
        <section className="config-section">
          <h3>Exclude from Merge</h3>
          <p className="section-description">
            These fields will NOT be merged. Use for fields that need manual handling (like Box folders).
          </p>
          <div className="field-checkbox-grid">
            {availableFields.map(field => (
              <label key={field} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={config.excludeFromMerge.includes(field)}
                  onChange={() => toggleArrayItem('excludeFromMerge', field)}
                />
                <span>{field}</span>
              </label>
            ))}
          </div>
        </section>

        {/* Concatenate Fields */}
        <section className="config-section">
          <h3>Concatenate on Merge</h3>
          <p className="section-description">
            These fields will have their values concatenated with a delimiter instead of picking one.
          </p>
          <div className="field-checkbox-grid">
            {availableFields.filter(f => !schema?.linkFields?.includes(f)).map(field => (
              <label key={field} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={config.concatenateFields.includes(field)}
                  onChange={() => toggleArrayItem('concatenateFields', field)}
                />
                <span>{field}</span>
              </label>
            ))}
          </div>
        </section>

        {/* History Field */}
        <section className="config-section">
          <h3>History Field</h3>
          <p className="section-description">
            The field where merge history JSON will be stored. Must be a long text field.
          </p>
          <select
            value={config.historyField}
            onChange={(e) => updateConfig('historyField', e.target.value)}
            className="field-select"
          >
            <option value="">-- Select Field --</option>
            {availableFields.filter(f => !schema?.linkFields?.includes(f)).map(field => (
              <option key={field} value={field}>{field}</option>
            ))}
          </select>
          {!config.historyField && (
            <p className="warning-text">
              Warning: Without a history field, you won't be able to unmerge records.
            </p>
          )}
        </section>

        {/* Link Fields Info */}
        <section className="config-section">
          <h3>Link Fields (Auto-detected)</h3>
          <p className="section-description">
            These fields link to other tables and will be merged by combining all linked records.
          </p>
          <div className="field-tag-list">
            {schema?.linkFields?.map(field => (
              <span key={field} className="field-tag link">{field}</span>
            ))}
            {(!schema?.linkFields || schema.linkFields.length === 0) && (
              <span className="no-fields">No link fields detected</span>
            )}
          </div>
        </section>

        <div className="button-group">
          <button className="btn btn-success" onClick={handleSave}>
            Save Configuration & Start Scanning
          </button>
        </div>
      </div>
    </div>
  );
}
