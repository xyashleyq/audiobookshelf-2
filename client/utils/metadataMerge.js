/**
 * Merge logic for applying a metadata match to an existing library item.
 *
 * Pure module: no API calls, no Vue. Match.vue calls merge() once and uses the
 * same results for the preview and for the update payload.
 */

export const TEXT = 'text'
export const LIST = 'list'

// Where a field's result goes in the update payload
export const TARGET_METADATA = 'metadata'
export const TARGET_ROOT = 'root'

// Field name -> value type, allowed merge logics, default merge logic, payload target
export const FIELD_CONFIG = {
  title: { type: TEXT, allowed: ['replace', 'fillEmpty'], default: 'replace', target: TARGET_METADATA },
  subtitle: { type: TEXT, allowed: ['replace', 'fillEmpty'], default: 'replace', target: TARGET_METADATA },
  description: { type: TEXT, allowed: ['replace', 'fillEmpty'], default: 'replace', target: TARGET_METADATA },
  publisher: { type: TEXT, allowed: ['replace', 'fillEmpty'], default: 'replace', target: TARGET_METADATA },
  language: { type: TEXT, allowed: ['replace', 'fillEmpty'], default: 'replace', target: TARGET_METADATA },
  genres: { type: LIST, allowed: ['replace', 'appendUnique'], default: 'replace', target: TARGET_METADATA },
  tags: { type: LIST, allowed: ['replace', 'appendUnique'], default: 'replace', target: TARGET_ROOT }
}

/**
 * Text: null, missing, non-string or whitespace only.
 * List: null, missing, non-array, or no non-empty items.
 */
export function isEmpty(type, value) {
  if (type === LIST) return normalizeList(value).length === 0
  return normalizeText(value) === ''
}

/** Trim. Non-string values count as empty. */
export function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** Trim each item and drop empty ones. Non-array values and non-string items count as empty. */
export function normalizeList(value) {
  if (!Array.isArray(value)) return []
  return value.map(normalizeText).filter((item) => item !== '')
}

/** Key used to find duplicates in appendUnique: trimmed and lowercased */
function sameKey(item) {
  return normalizeText(item).toLowerCase()
}

/** Exact comparison, like the server: strict for text, order- and case-sensitive for lists */
function isChanged(type, result, existing) {
  if (type === LIST) return JSON.stringify(result) !== JSON.stringify(existing)
  return result !== existing
}

// Merge logic name -> function(existing, normalizedNew, type) returning the result value.
// Each logic receives an already-normalized, non-empty new value.
export const MERGE_LOGICS = {
  replace(existing, newValue) {
    return newValue
  },
  fillEmpty(existing, newValue, type) {
    return isEmpty(type, existing) ? newValue : existing
  },
  appendUnique(existing, newValue) {
    const existingList = Array.isArray(existing) ? existing : []
    const seen = new Set(existingList.map(sameKey))
    const added = []
    for (const item of newValue) {
      const key = sameKey(item)
      if (seen.has(key)) continue
      seen.add(key)
      added.push(item)
    }
    // Nothing new: keep the item's own value as it is
    if (!added.length) return existing
    return [...existingList, ...added]
  }
}

/**
 * @param {Object} existing - item's own values, keyed by field name
 * @param {Object} incoming - new (matched) values, keyed by field name
 * @param {Object} modes - chosen merge logic for each checked field, keyed by field name
 * @returns {Object} field name -> { value, action, changed } for every checked field in FIELD_CONFIG
 */
export function merge(existing, incoming, modes) {
  existing = existing || {}
  incoming = incoming || {}
  const results = {}

  for (const field of Object.keys(modes || {})) {
    const config = FIELD_CONFIG[field]
    if (!config) continue

    const action = config.allowed.includes(modes[field]) ? modes[field] : config.default
    const oldValue = existing[field]
    const newValue = config.type === LIST ? normalizeList(incoming[field]) : normalizeText(incoming[field])

    // Missing or empty new value keeps the item's own value
    const value = isEmpty(config.type, newValue) ? oldValue : MERGE_LOGICS[action](oldValue, newValue, config.type)

    results[field] = {
      value,
      action,
      changed: isChanged(config.type, value, oldValue)
    }
  }

  return results
}
