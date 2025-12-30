/**
 * Airtable API Client
 * Handles all communication with the Airtable API including schema introspection.
 */

export class AirtableClient {
  constructor(apiKey, baseId) {
    this.apiKey = apiKey;
    this.baseId = baseId;
    this.baseUrl = `https://api.airtable.com/v0/${baseId}`;
    this.metaUrl = `https://api.airtable.com/v0/meta/bases/${baseId}/tables`;
    this.schema = null;
  }

  async request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `API error: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Fetch table schema to determine writable vs computed fields
   */
  async getTableSchema(tableName) {
    const result = await this.request(this.metaUrl);
    const table = result.tables.find(t => t.name === tableName);

    if (!table) {
      throw new Error(`Table "${tableName}" not found`);
    }

    // Computed field types that cannot be written to
    const computedTypes = [
      'formula',
      'rollup',
      'count',
      'lookup',
      'multipleLookupValues',
      'autoNumber',
      'createdTime',
      'lastModifiedTime',
      'createdBy',
      'lastModifiedBy',
      'button'
    ];

    const schema = {
      tableName,
      tableId: table.id,
      allFields: {},
      writableFields: [],
      computedFields: [],
      linkFields: [],
      textFields: [],
      uniqueIdFields: [], // Fields that should be treated as unique identifiers
    };

    table.fields.forEach(field => {
      const isComputed = computedTypes.includes(field.type) || field.name.includes('(from');

      schema.allFields[field.name] = {
        id: field.id,
        type: field.type,
        isComputed,
        options: field.options || {},
      };

      if (isComputed) {
        schema.computedFields.push(field.name);
      } else {
        schema.writableFields.push(field.name);

        if (field.type === 'multipleRecordLinks') {
          schema.linkFields.push(field.name);
        } else {
          schema.textFields.push(field.name);
        }
      }
    });

    this.schema = schema;
    return schema;
  }

  /**
   * Fetch all records from a table with pagination
   */
  async getAllRecords(tableName, options = {}) {
    const { fields = [], filterFormula = '', onProgress = null } = options;
    const allRecords = [];
    let offset = null;
    let pageNum = 0;

    do {
      const params = new URLSearchParams();

      if (fields.length > 0) {
        fields.forEach(f => params.append('fields[]', f));
      }
      if (filterFormula) {
        params.append('filterByFormula', filterFormula);
      }
      if (offset) {
        params.append('offset', offset);
      }
      params.append('pageSize', '100');

      const url = `${this.baseUrl}/${encodeURIComponent(tableName)}?${params}`;
      const result = await this.request(url);

      allRecords.push(...result.records);
      offset = result.offset;
      pageNum++;

      if (onProgress) {
        onProgress({
          page: pageNum,
          fetched: result.records.length,
          total: allRecords.length,
          hasMore: !!offset,
        });
      }

      // Rate limiting - 5 requests/second max
      if (offset) {
        await new Promise(r => setTimeout(r, 200));
      }
    } while (offset);

    return allRecords;
  }

  /**
   * Get a single record by ID
   */
  async getRecord(tableName, recordId) {
    const url = `${this.baseUrl}/${encodeURIComponent(tableName)}/${recordId}`;
    return this.request(url);
  }

  /**
   * Update a single record
   */
  async updateRecord(tableName, recordId, fields) {
    const url = `${this.baseUrl}/${encodeURIComponent(tableName)}/${recordId}`;
    return this.request(url, {
      method: 'PATCH',
      body: JSON.stringify({ fields }),
    });
  }

  /**
   * Create a new record
   */
  async createRecord(tableName, fields) {
    const url = `${this.baseUrl}/${encodeURIComponent(tableName)}`;
    return this.request(url, {
      method: 'POST',
      body: JSON.stringify({ fields }),
    });
  }

  /**
   * Delete a single record
   */
  async deleteRecord(tableName, recordId) {
    const url = `${this.baseUrl}/${encodeURIComponent(tableName)}/${recordId}`;
    return this.request(url, {
      method: 'DELETE',
    });
  }

  /**
   * Delete multiple records (max 10 per request per Airtable API)
   */
  async deleteRecords(tableName, recordIds, onProgress = null) {
    const results = [];
    const chunks = [];

    // Split into chunks of 10
    for (let i = 0; i < recordIds.length; i += 10) {
      chunks.push(recordIds.slice(i, i + 10));
    }

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const params = chunk.map(id => `records[]=${id}`).join('&');
      const url = `${this.baseUrl}/${encodeURIComponent(tableName)}?${params}`;

      const result = await this.request(url, { method: 'DELETE' });
      results.push(...result.records);

      if (onProgress) {
        onProgress({
          deleted: results.length,
          total: recordIds.length,
          chunk: i + 1,
          totalChunks: chunks.length,
        });
      }

      // Rate limiting
      if (i < chunks.length - 1) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    return results;
  }

  /**
   * Update multiple records (max 10 per request per Airtable API)
   */
  async updateRecords(tableName, records, onProgress = null) {
    const results = [];
    const chunks = [];

    // Split into chunks of 10
    for (let i = 0; i < records.length; i += 10) {
      chunks.push(records.slice(i, i + 10));
    }

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const url = `${this.baseUrl}/${encodeURIComponent(tableName)}`;

      const result = await this.request(url, {
        method: 'PATCH',
        body: JSON.stringify({ records: chunk }),
      });
      results.push(...result.records);

      if (onProgress) {
        onProgress({
          updated: results.length,
          total: records.length,
          chunk: i + 1,
          totalChunks: chunks.length,
        });
      }

      // Rate limiting
      if (i < chunks.length - 1) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    return results;
  }
}

/**
 * Get stored credentials from localStorage
 */
export function getStoredCredentials() {
  try {
    const stored = localStorage.getItem('airtable_dedupe_config');
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to load stored credentials:', e);
  }
  return null;
}

/**
 * Store credentials to localStorage
 */
export function storeCredentials(config) {
  try {
    localStorage.setItem('airtable_dedupe_config', JSON.stringify(config));
  } catch (e) {
    console.error('Failed to store credentials:', e);
  }
}

/**
 * Clear stored credentials
 */
export function clearCredentials() {
  localStorage.removeItem('airtable_dedupe_config');
}
