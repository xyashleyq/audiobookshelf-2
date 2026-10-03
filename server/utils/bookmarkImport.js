const SUPPORTED_VERSION = 1
const MAX_REPORTED_ERRORS = 20

/**
 * @typedef ParsedBookmark
 * @property {number} time
 * @property {string} title
 * @property {number|null} createdAt - null when missing/invalid in the file
 *
 * @typedef ParseResult
 * @property {boolean} ok
 * @property {string[]} errors - empty when ok
 * @property {ParsedBookmark[]} entries - empty when not ok
 * @property {{ libraryItemId: string|null, bookTitle: string|null }|null} hints - never used for routing
 */

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/**
 * @param {string[]} errors
 * @returns {ParseResult}
 */
function fail(errors) {
  const reported = errors.slice(0, MAX_REPORTED_ERRORS)
  if (errors.length > MAX_REPORTED_ERRORS) {
    reported.push(`...and ${errors.length - MAX_REPORTED_ERRORS} more errors`)
  }
  return { ok: false, errors: reported, entries: [], hints: null }
}

/**
 * Validate and normalize an already-JSON-parsed bookmarks file.
 * Unknown keys (top-level or per entry) are ignored.
 *
 * @param {*} input - parsed JSON value
 * @returns {ParseResult}
 */
function parseBookmarkFile(input) {
  if (!isPlainObject(input)) {
    return fail(['File must be a JSON object'])
  }

  if (input.absBookmarksVersion === undefined) {
    return fail(['Missing "absBookmarksVersion"'])
  }
  if (input.absBookmarksVersion !== SUPPORTED_VERSION) {
    return fail([`Unsupported "absBookmarksVersion" ${JSON.stringify(input.absBookmarksVersion)} (expected ${SUPPORTED_VERSION})`])
  }

  if (!Array.isArray(input.bookmarks)) {
    return fail(['"bookmarks" must be an array'])
  }

  const errors = []
  const entries = []

  input.bookmarks.forEach((bookmark, index) => {
    const label = `bookmarks[${index}]`
    if (!isPlainObject(bookmark)) {
      errors.push(`${label} must be an object`)
      return
    }

    let valid = true
    if (!isFiniteNonNegative(bookmark.time)) {
      errors.push(`${label}.time must be a finite, non-negative number`)
      valid = false
    }
    if (typeof bookmark.title !== 'string' || !bookmark.title.trim()) {
      errors.push(`${label}.title must be a non-empty string`)
      valid = false
    }
    if (!valid) return

    entries.push({
      time: bookmark.time,
      title: bookmark.title,
      createdAt: isFiniteNonNegative(bookmark.createdAt) ? bookmark.createdAt : null
    })
  })

  if (errors.length) {
    return fail(errors)
  }

  return {
    ok: true,
    errors: [],
    entries,
    hints: {
      libraryItemId: typeof input.libraryItemId === 'string' ? input.libraryItemId : null,
      bookTitle: typeof input.bookTitle === 'string' ? input.bookTitle : null
    }
  }
}

/**
 * Bookmarks belonging to one book. Shared by the preview and apply paths so
 * both always look at exactly the same set.
 *
 * @param {{libraryItemId: string}[]|null|undefined} bookmarks - all of a user's bookmarks
 * @param {string} libraryItemId
 */
function selectBookmarksForItem(bookmarks, libraryItemId) {
  return (bookmarks || []).filter((bm) => bm.libraryItemId === libraryItemId)
}

/**
 * @typedef DiffEntry
 * @property {number} time
 * @property {string} title
 * @property {number|null} createdAt
 * @property {'new'|'identical'|'conflict'} status
 * @property {string|null} existingTitle - title already stored at this time (null when new)
 *
 * @typedef DiffResult
 * @property {DiffEntry[]} entries - effective incoming entries (after in-file de-duplication)
 * @property {ParsedBookmark[]} supersededInFile - earlier entries dropped because a later entry has the same time
 * @property {{total:number,new:number,identical:number,conflict:number,supersededInFile:number}} counts
 */

/**
 * Compare incoming entries against the destination book's existing bookmarks.
 * Identity is exact numeric equality of `time`.
 * If two incoming entries share a time, the last wins and the earlier is reported in supersededInFile.
 *
 * @param {{time:number,title:string}[]} existing - bookmarks of the destination book only
 * @param {ParsedBookmark[]} incoming
 * @returns {DiffResult}
 */
function diffBookmarks(existing, incoming) {
  const existingByTime = new Map()
  for (const bm of existing || []) {
    const key = Number(bm.time)
    if (!existingByTime.has(key)) existingByTime.set(key, bm) // first match, like User.findBookmark
  }

  const lastIndexByTime = new Map()
  incoming.forEach((entry, index) => lastIndexByTime.set(entry.time, index))

  const entries = []
  const supersededInFile = []
  incoming.forEach((entry, index) => {
    if (lastIndexByTime.get(entry.time) !== index) {
      supersededInFile.push({ ...entry })
      return
    }
    const match = existingByTime.get(entry.time)
    let status = 'new'
    if (match) status = match.title === entry.title ? 'identical' : 'conflict'
    entries.push({
      time: entry.time,
      title: entry.title,
      createdAt: entry.createdAt,
      status,
      existingTitle: match ? match.title : null
    })
  })

  const count = (status) => entries.filter((e) => e.status === status).length
  return {
    entries,
    supersededInFile,
    counts: {
      total: entries.length,
      new: count('new'),
      identical: count('identical'),
      conflict: count('conflict'),
      supersededInFile: supersededInFile.length
    }
  }
}

module.exports = {
  SUPPORTED_VERSION,
  parseBookmarkFile,
  selectBookmarksForItem,
  diffBookmarks
}