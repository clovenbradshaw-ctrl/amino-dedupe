import React, { useState, useMemo } from 'react';
import { AirtableClient } from '../lib/airtable.js';
import { buildUnmergePayload, parseDedupeHistory } from '../lib/merge.js';

/**
 * UnmergeModal Component
 * Confirm and execute an unmerge operation to restore previously merged records.
 */
export default function UnmergeModal({
  record,
  mergeEvent,
  schema,
  credentials,
  onComplete,
  onCancel,
  onLog,
}) {
  const [processing, setProcessing] = useState(false);
  const [markAsNotDuplicate, setMarkAsNotDuplicate] = useState(true);
  const [notes, setNotes] = useState('');

  const log = (message, type = 'info') => {
    if (onLog) onLog(message, type);
  };

  // Calculate what will be restored
  const restorePreview = useMemo(() => {
    if (!mergeEvent || !mergeEvent.merged_records) return null;

    return {
      recordCount: mergeEvent.merged_records.length,
      records: mergeEvent.merged_records.map(m => ({
        id: m.original_record_id,
        fieldCount: Object.keys(m.field_snapshot || {}).length,
        linkedRecordCount: Object.values(m.linked_records || {})
          .reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0),
      })),
    };
  }, [mergeEvent]);

  const handleUnmerge = async () => {
    setProcessing(true);

    try {
      const client = new AirtableClient(credentials.apiKey, credentials.baseId);

      // Build unmerge payload
      log(`Building unmerge payload for ${mergeEvent.merge_id}...`, 'info');
      const payload = buildUnmergePayload(record, mergeEvent.merge_id, schema);

      // Create the restored records
      log(`Recreating ${payload.recordsToCreate.length} record(s)...`, 'info');
      const createdRecords = [];

      for (const toCreate of payload.recordsToCreate) {
        // Preserve any original history from the record and append the unmerge event
        const originalHistory = parseDedupeHistory(toCreate.fields.dedupe_history);
        const unmergeEntry = {
          ...payload.unmergeHistoryEntry,
          notes: notes || payload.unmergeHistoryEntry.notes,
        };
        const updatedHistory = [...originalHistory, unmergeEntry];

        const created = await client.createRecord(
          credentials.tableName,
          {
            ...toCreate.fields,
            dedupe_history: JSON.stringify(updatedHistory, null, 2),
          }
        );
        createdRecords.push(created);
        log(`Created record ${created.id}`, 'success');
      }

      // Update survivor record's history
      log('Updating survivor record history...', 'info');
      await client.updateRecord(
        credentials.tableName,
        record.id,
        payload.survivorUpdates
      );
      log('Survivor record updated', 'success');

      // Optionally mark as not duplicate
      if (markAsNotDuplicate) {
        log('Marking records as confirmed not duplicate...', 'info');
        // Store in a "not duplicate" list in localStorage
        try {
          const notDuplicates = JSON.parse(localStorage.getItem('confirmed_not_duplicates') || '[]');
          const pair = [record.id, ...createdRecords.map(r => r.id)].sort().join('|');
          if (!notDuplicates.includes(pair)) {
            notDuplicates.push(pair);
            localStorage.setItem('confirmed_not_duplicates', JSON.stringify(notDuplicates));
          }
        } catch (e) {
          // Ignore localStorage errors
        }
      }

      log(`Unmerge ${payload.unmergeId} completed successfully!`, 'success');

      if (onComplete) {
        onComplete({
          unmergeId: payload.unmergeId,
          restoredRecords: createdRecords,
          survivorId: record.id,
        });
      }
    } catch (err) {
      log(`Unmerge failed: ${err.message}`, 'error');
    } finally {
      setProcessing(false);
    }
  };

  if (!record || !mergeEvent) {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content unmerge-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Confirm Unmerge</h2>
          <button className="modal-close" onClick={onCancel}>×</button>
        </div>

        <div className="modal-body">
          <div className="unmerge-warning">
            <strong>⚠️ This operation will:</strong>
          </div>

          <ul className="unmerge-actions-list">
            <li>
              Recreate <strong>{restorePreview?.recordCount || 0}</strong> previously merged record(s)
            </li>
            <li>
              Restore all field values from the time of the original merge
            </li>
            <li>
              Re-link any associated records (cases, events, etc.)
            </li>
            <li>
              Add an unmerge event to the history of all affected records
            </li>
          </ul>

          {/* Records to restore */}
          <div className="restore-preview">
            <h4>Records to Restore</h4>
            {restorePreview?.records.map((r, idx) => (
              <div key={idx} className="restore-record">
                <span className="record-id">{r.id}</span>
                <span className="record-stats">
                  {r.fieldCount} fields, {r.linkedRecordCount} linked records
                </span>
              </div>
            ))}
          </div>

          {/* Merge event info */}
          <div className="merge-event-info">
            <h4>Original Merge</h4>
            <div className="info-grid">
              <div className="info-item">
                <span className="label">Merge ID:</span>
                <span className="value">{mergeEvent.merge_id}</span>
              </div>
              <div className="info-item">
                <span className="label">Date:</span>
                <span className="value">{new Date(mergeEvent.timestamp).toLocaleString()}</span>
              </div>
              <div className="info-item">
                <span className="label">Confidence:</span>
                <span className="value">{mergeEvent.confidence || 'N/A'}%</span>
              </div>
            </div>
            {mergeEvent.match_reasons && mergeEvent.match_reasons.length > 0 && (
              <div className="match-reasons">
                <span className="label">Match Reasons:</span>
                <div className="reason-list">
                  {mergeEvent.match_reasons.map((reason, idx) => (
                    <span key={idx} className="reason-badge">{reason}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Options */}
          <div className="unmerge-options">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={markAsNotDuplicate}
                onChange={(e) => setMarkAsNotDuplicate(e.target.checked)}
              />
              Mark these records as "confirmed not duplicate" (prevents re-matching)
            </label>
          </div>

          {/* Notes */}
          <div className="unmerge-notes">
            <label htmlFor="unmerge-notes">Notes (optional):</label>
            <textarea
              id="unmerge-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Why are you unmerging these records?"
              rows={2}
            />
          </div>
        </div>

        <div className="modal-footer">
          <button
            className="btn btn-secondary"
            onClick={onCancel}
            disabled={processing}
          >
            Cancel
          </button>
          <button
            className="btn btn-warning"
            onClick={handleUnmerge}
            disabled={processing}
          >
            {processing ? 'Unmerging...' : 'Confirm Unmerge'}
          </button>
        </div>
      </div>
    </div>
  );
}
