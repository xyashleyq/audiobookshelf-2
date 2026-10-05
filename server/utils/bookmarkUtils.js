/**
 * The single definition of how bookmarks are identified, compared and written.
 * Used by User (create / find / remove), the import preview and the import itself.
 * Pure: no database, no user model, no network.
 */

/**
 * Normalize a time so 12, "12" and 12.0 are the same bookmark.
 * @param {*} time
 * @returns {number|null} null when the value is not a usable number
 */
function timeKey(time) {
  if (time === null || time === undefined || time === '') return null
  const n = Number(time)
  return Number.isFinite(n) ? n : null
}

/**
 * @param {{libraryItemId:string,time:*}} bm
 * @param {string} libraryItemId
 * @param {*} time
 * @returns {boolean}
 */
function isSameBookmark(bm, libraryItemId, time) {
  const a = timeKey(bm.time)
  return bm.libraryItemId === libraryItemId && a !== null && a === timeKey(time)
}

/**
 * @param {object[]|null|undefined} bookmarks
 * @param {string} libraryItemId
 * @param {*} time
 * @returns {object|null}
 */
function findBookmark(bookmarks, libraryItemId, time) {
  return (bookmarks || []).find((bm) => isSameBookmark(bm, libraryItemId, time)) || null
}

/**
 * @param {{title:string}|null|undefined} existing - bookmark already stored at this time
 * @param {string} title - incoming title
 * @returns {'new'|'identical'|'conflict'}
 */
function classify(existing, title) {
  if (!existing) return 'new'
  return existing.title === title ? 'identical' : 'conflict'
}

/**
 * Bookmarks belonging to one book.
 * @param {{libraryItemId:string}[]|null|undefined} bookmarks - all of a user's bookmarks
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
 * @property {object[]} supersededInFile - earlier entries dropped because a later entry has the same time
 * @property {{total:number,new:number,identical:number,conflict:number,supersededInFile:number}} counts
 */

/**
 * Compare incoming entries against one book's existing bookmarks.
 * Identity is timeKey equality. If the incoming list repeats a time, the last wins
 * and the earlier one is reported in supersededInFile.
 *
 * @param {{time:*,title:string}[]} existing - bookmarks of the destination book only
 * @param {{time:*,title:string,createdAt:number|null}[]} incoming
 * @returns {DiffResult}
 */
function diffBookmarks(existing, incoming) {
  const existingByTime = new Map()
  for (const bm of existing || []) {
    const key = timeKey(bm.time)
    if (key !== null && !existingByTime.has(key)) existingByTime.set(key, bm) // first match, like findBookmark
  }

  const lastIndexByTime = new Map()
  incoming.forEach((entry, index) => lastIndexByTime.set(timeKey(entry.time), index))

  const entries = []
  const supersededInFile = []
  incoming.forEach((entry, index) => {
    if (lastIndexByTime.get(timeKey(entry.time)) !== index) {
      supersededInFile.push({ ...entry })
      return
    }
    const match = existingByTime.get(timeKey(entry.time))
    entries.push({
      time: entry.time,
      title: entry.title,
      createdAt: entry.createdAt,
      status: classify(match, entry.title),
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

/**
 * The one write rule. Used by bookmark import AND by User.createBookmark.
 * Returns a new bookmarks array and a summary. Never mutates its input.
 * If nothing would change, the SAME array is returned and summary.changed is false.
 *
 * - keep:    adds new entries only
 * - replace: adds new entries and overwrites the title of conflicts (keeps their createdAt)
 * Bookmarks not mentioned, and other books' bookmarks, are never altered.
 * The destination book always comes from libraryItemId.
 *
 * @param {object[]|null} bookmarks - all of a user's bookmarks
 * @param {string} libraryItemId
 * @param {{time:*,title:string,createdAt:number|null}[]} incoming
 * @param {'keep'|'replace'} mode
 * @param {number} [now] - createdAt for entries that have none
 * @returns {{bookmarks: object[], summary: {added:number,replaced:number,keptExisting:number,identical:number,supersededInFile:number,changed:boolean}}}
 */
function applyBookmarkChanges(bookmarks, libraryItemId, incoming, mode, now = Date.now()) {
  if (mode !== 'keep' && mode !== 'replace') {
    throw new Error(`Invalid import mode "${mode}"`)
  }

  const all = bookmarks || []
  const diff = diffBookmarks(selectBookmarksForItem(all, libraryItemId), incoming)
  const newEntries = diff.entries.filter((e) => e.status === 'new')
  const conflicts = diff.entries.filter((e) => e.status === 'conflict')

  const titleByTime = new Map()
  if (mode === 'replace') conflicts.forEach((e) => titleByTime.set(timeKey(e.time), e.title))

  const summary = {
    added: newEntries.length,
    replaced: titleByTime.size,
    keptExisting: mode === 'keep' ? conflicts.length : 0,
    identical: diff.counts.identical,
    supersededInFile: diff.counts.supersededInFile,
    changed: newEntries.length > 0 || titleByTime.size > 0
  }
  if (!summary.changed) return { bookmarks: all, summary }

  const next = all.map((bm) => {
    const key = timeKey(bm.time)
    if (bm.libraryItemId === libraryItemId && key !== null && titleByTime.has(key)) {
      return { ...bm, title: titleByTime.get(key) }
    }
    return bm
  })
  for (const entry of newEntries) {
    next.push({ libraryItemId, time: entry.time, title: entry.title, createdAt: entry.createdAt ?? now })
  }
  return { bookmarks: next, summary }
}

module.exports = {
  timeKey,
  isSameBookmark,
  findBookmark,
  classify,
  selectBookmarksForItem,
  diffBookmarks,
  applyBookmarkChanges
}