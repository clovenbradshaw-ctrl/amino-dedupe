/**
 * Airtable API Client
 * Handles all communication with the Airtable API including schema introspection.
 * Implements intelligent rate limiting with exponential backoff.
 */

// Rate limiting constants
const INITIAL_DELAY_MS = 200; // Base delay between requests (5 req/sec)
const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 32000;

export class AirtableClient {
  constructor(apiKey, baseId) {
    this.apiKey = apiKey;
    this.baseId = baseId;
    this.baseUrl = `https://api.airtable.com/v0/${baseId}`;
    this.metaUrl = `https://api.airtable.com/v0/meta/bases/${baseId}/tables`;
    this.schema = null;
    this.currentDelay = INITIAL_DELAY_MS;
  }

  /**
   * Sleep helper with promise
   */
  sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  /**
   * Make a request with intelligent rate limiting and exponential backoff
   */
  async request(url, options = {}) {
    let lastError;
    let backoffMs = INITIAL_BACKOFF_MS;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(url, {
          ...options,
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            ...options.headers,
          },
        });

        // Handle rate limiting (429 Too Many Requests)
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : backoffMs;

          // Increase delay for future requests
          this.currentDelay = Math.min(this.currentDelay * 1.5, 1000);

          if (attempt < MAX_RETRIES) {
            console.log(`Rate limited. Waiting ${waitTime}ms before retry ${attempt + 1}/${MAX_RETRIES}`);
            await this.sleep(waitTime);
            backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
            continue;
          }
          throw new Error('Rate limit exceeded after maximum retries');
        }

        // Success - gradually reduce delay back to normal
        if (this.currentDelay > INITIAL_DELAY_MS) {
          this.currentDelay = Math.max(this.currentDelay * 0.9, INITIAL_DELAY_MS);
        }

        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.error?.message || `API error: ${response.status}`);
        }

        return response.json();
      } catch (error) {
        lastError = error;

        // Don't retry on non-network errors (except rate limiting handled above)
        if (error.message && !error.message.includes('fetch')) {
          throw error;
        }

        // Network error - retry with backoff
        if (attempt < MAX_RETRIES) {
          console.log(`Network error. Waiting ${backoffMs}ms before retry ${attempt + 1}/${MAX_RETRIES}`);
          await this.sleep(backoffMs);
          backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
          continue;
        }
      }
    }

    throw lastError || new Error('Request failed after maximum retries');
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
   * Fetch all records from a table with pagination and streaming support
   *
   * @param {string} tableName - Name of the table to fetch from
   * @param {Object} options - Fetch options
   * @param {string[]} options.fields - Fields to fetch (empty = all fields)
   * @param {string} options.filterFormula - Airtable filter formula
   * @param {Function} options.onProgress - Progress callback with {page, fetched, total, hasMore}
   * @param {Function} options.onRecords - Streaming callback, called with new records as they arrive
   * @returns {Promise<Array>} All fetched records
   */
  async getAllRecords(tableName, options = {}) {
    const { fields = [], filterFormula = '', onProgress = null, onRecords = null } = options;
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

      // Stream new records to callback immediately
      if (onRecords) {
        onRecords(result.records, allRecords);
      }

      if (onProgress) {
        onProgress({
          page: pageNum,
          fetched: result.records.length,
          total: allRecords.length,
          hasMore: !!offset,
          delay: this.currentDelay,
        });
      }

      // Adaptive rate limiting - uses current delay which adjusts based on rate limit responses
      if (offset) {
        await this.sleep(this.currentDelay);
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
