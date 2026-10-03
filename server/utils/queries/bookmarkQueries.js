const Database = require('../../Database')

module.exports = {
  /**
   * Get the user's bookmarks whose library item still exists and is accessible to the user.
   * Read-time filter only — never mutates user.bookmarks.
   *
   * @param {import('../../models/User')} user
   * @param {Object} [options]
   * @param {'book'} [options.mediaType] - restrict to one media type (search uses 'book')
   * @returns {Promise<{ bookmarks: Object[], libraryItemsById: Map<string, import('../../models/LibraryItem')> }>}
   */
  async getAccessibleBookmarks(user, options = {}) {
    const allBookmarks = user.bookmarks || []
    const itemIds = [...new Set(allBookmarks.map((bm) => bm.libraryItemId))]
    if (!itemIds.length) return { bookmarks: [], libraryItemsById: new Map() }

    const where = { id: itemIds }
    if (options.mediaType) where.mediaType = options.mediaType

    const include = [{ model: Database.bookModel, attributes: ['id', 'title', 'tags', 'explicit'] }]
    if (options.mediaType !== 'book') {
      include.push({ model: Database.podcastModel, attributes: ['id', 'title', 'tags', 'explicit'] })
    }

    const libraryItems = await Database.libraryItemModel.findAll({
      where,
      attributes: ['id', 'libraryId', 'mediaId', 'mediaType', 'title'],
      include
    })

    const libraryItemsById = new Map()
    for (const libraryItem of libraryItems) {
      // afterFind hook (LibraryItem.js) maps book/podcast onto .media; guard anyway
      if (!libraryItem.media) continue
      if (!user.checkCanAccessLibraryItem(libraryItem)) continue
      libraryItemsById.set(libraryItem.id, libraryItem)
    }

    const bookmarks = allBookmarks.filter((bm) => libraryItemsById.has(bm.libraryItemId))
    return { bookmarks, libraryItemsById }
  },

  /**
   * toOldJSONForBrowser() with `bookmarks` replaced by the access-filtered list.
   * Use ONLY where a user is sent their own user object.
   *
   * @param {import('../../models/User')} user
   * @param {boolean} [hideRootToken]
   * @param {boolean} [minimal]
   * @returns {Promise<Object>}
   */
  async toOldJSONForBrowserForSelf(user, hideRootToken = false, minimal = false) {
    const json = user.toOldJSONForBrowser(hideRootToken, minimal)
    if (minimal) return json // minimal already deletes bookmarks
    const { bookmarks } = await module.exports.getAccessibleBookmarks(user)
    json.bookmarks = bookmarks.map((bm) => ({ ...bm }))
    return json
  }
}
