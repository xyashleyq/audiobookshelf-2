const { Request, Response } = require('express')
const { Op } = require('sequelize')
const Logger = require('../Logger')
const SocketAuthority = require('../SocketAuthority')
const Database = require('../Database')
const { sort } = require('../libs/fastSort')
const { toNumber, isNullOrNaN, isUUID } = require('../utils/index')
const userStats = require('../utils/queries/userStats')
const bookmarkQueries = require('../utils/queries/bookmarkQueries')
const parseUserAgent = require('../utils/parsers/parseUserAgent')
const { parseBookmarkFile, diffBookmarks, applyBookmarkImport, selectBookmarksForItem } = require('../utils/bookmarkImport')

/**
 * @typedef RequestUserObject
 * @property {import('../models/User')} user
 *
 * @typedef {Request & RequestUserObject} RequestWithUser
 */

class MeController {
  constructor() {}

  /**
   * GET: /api/me
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async getCurrentUser(req, res) {
    res.json(await bookmarkQueries.toOldJSONForBrowserForSelf(req.user))
  }

  /**
   * GET: /api/me/sessions
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async getSessions(req, res) {
    const page = Math.max(0, toNumber(req.query.page, 0))
    const itemsPerPage = Math.max(1, toNumber(req.query.itemsPerPage, 10))

    if (req.user.isGuest) {
      return res.json({ sessions: [], total: 0, numPages: 0, page, itemsPerPage })
    }

    const refreshToken = req.cookies.refresh_token || req.headers['x-refresh-token']
    const { rows, count } = await Database.sessionModel.findAndCountAll({
      where: {
        userId: req.user.id,
        expiresAt: { [Op.gt]: new Date() }
      },
      order: [['updatedAt', 'DESC']],
      limit: itemsPerPage,
      offset: itemsPerPage * page
    })

    res.json({
      total: count,
      numPages: Math.ceil(count / itemsPerPage),
      page,
      itemsPerPage,
      sessions: rows.map((session) => ({
        id: session.id,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        // For display convenience
        deviceInfo: parseUserAgent(session.userAgent),
        createdAt: session.createdAt?.valueOf() ?? null,
        updatedAt: session.updatedAt?.valueOf() ?? null,
        current: !!refreshToken && (session.refreshToken === refreshToken || session.lastRefreshToken === refreshToken)
      }))
    })
  }

  /**
   * DELETE: /api/me/sessions/:id
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async deleteSession(req, res) {
    if (req.user.isGuest) {
      return res.sendStatus(403)
    }

    if (!isUUID(req.params.id)) {
      return res.sendStatus(400)
    }

    const session = await Database.sessionModel.findOne({
      where: {
        id: req.params.id,
        userId: req.user.id
      }
    })

    if (!session) {
      return res.sendStatus(404)
    }

    await Database.sessionModel.destroy({ where: { id: session.id } })
    Logger.info(`[MeController] User ${req.user.username} deleted auth session ${session.id}`)

    res.sendStatus(200)
  }

  /**
   * GET: /api/me/progress
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  getAllMediaProgress(req, res) {
    const mediaProgress = req.user.mediaProgresses?.map((mp) => mp.getOldMediaProgress()) || []
    res.json({ mediaProgress })
  }

  /**
   * GET: /api/me/bookmarks
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async getAllBookmarks(req, res) {
    // Only bookmarks for items that still exist and the user can access (books and podcasts)
    const { bookmarks } = await bookmarkQueries.getAccessibleBookmarks(req.user)
    res.json({ bookmarks: bookmarks.map((bookmark) => ({ ...bookmark })) })
  }

  /**
   * The single lookup + access check for every per-book bookmark endpoint
   * (get, create, update, remove, import preview, import).
   * Sends the 404/403 itself and returns null when the request can't proceed.
   *
   * Static because route handlers are bound to the ApiRouter instance, so `this`
   * is not the controller. Call it as MeController.getAccessibleLibraryItem(...).
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   * @param {string} libraryItemId
   * @param {string} action - used in the log line, e.g. "create bookmark"
   * @returns {Promise<import('../models/LibraryItem')|null>}
   */
  static async getAccessibleLibraryItem(req, res, libraryItemId, action) {
    const libraryItem = await Database.libraryItemModel.getExpandedById(libraryItemId)
    if (!libraryItem) {
      res.sendStatus(404)
      return null
    }

    // Check if user has access to this library item
    if (!req.user.checkCanAccessLibraryItem(libraryItem)) {
      Logger.error(`[MeController] User "${req.user.username}" attempted to ${action} for library item "${libraryItemId}" without access`)
      res.sendStatus(403)
      return null
    }

    return libraryItem
  }

  /**
   * Import endpoints: the same access check, plus books only.
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   * @param {string} action - used in the log line
   * @returns {Promise<import('../models/LibraryItem')|null>}
   */
  static async getLibraryItemForBookmarkImport(req, res, action) {
    const libraryItem = await MeController.getAccessibleLibraryItem(req, res, req.params.libraryItemId, action)
    if (!libraryItem) return null

    if (libraryItem.isPodcast) {
      res.status(400).send('Bookmarks can only be imported into books')
      return null
    }

    return libraryItem
  }

  /**
   * GET: /api/me/bookmarks/:libraryItemId
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async getBookmarksForLibraryItem(req, res) {
    const libraryItem = await MeController.getAccessibleLibraryItem(req, res, req.params.libraryItemId, 'access bookmarks')
    if (!libraryItem) return

    const bookmarks = req.user.bookmarks?.filter((bookmark) => bookmark.libraryItemId === libraryItem.id).map((bookmark) => ({ ...bookmark })) || []
    res.json({ bookmarks })
  }

  /*
   * GET: /api/me/bookmarks/search
   * Search the user's book bookmarks across all accessible books
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async searchBookmarks(req, res) {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : ''
    const filterLibraryItemId = typeof req.query.libraryItemId === 'string' && req.query.libraryItemId ? req.query.libraryItemId : null
    const page = Math.max(0, toNumber(req.query.page, 0))
    const itemsPerPage = Math.min(100, Math.max(1, toNumber(req.query.itemsPerPage, 25)))

    const { bookmarks, libraryItemsById } = await bookmarkQueries.getAccessibleBookmarks(req.user, { mediaType: 'book' })

    const getBookTitle = (libraryItem) => libraryItem.media.title ?? libraryItem.title
    const bookIds = new Set(bookmarks.map((bm) => bm.libraryItemId))
    const books = [...bookIds]
      .map((libraryItemId) => ({ libraryItemId, title: getBookTitle(libraryItemsById.get(libraryItemId)) }))
      .sort((a, b) => String(a.title ?? '').localeCompare(String(b.title ?? ''), undefined, { sensitivity: 'base' }) || a.libraryItemId.localeCompare(b.libraryItemId))

    let matches = bookmarks
    if (filterLibraryItemId) {
      matches = matches.filter((bm) => bm.libraryItemId === filterLibraryItemId)
    }
    if (q) {
      // Literal match only, never build a RegExp or SQL LIKE from user input
      matches = matches.filter((bm) => String(bm.title ?? '').toLowerCase().includes(q))
    }

    const total = matches.length
    matches = [...matches].sort((a, b) => {
      if (a.createdAt !== b.createdAt) return (b.createdAt || 0) - (a.createdAt || 0)
      if (a.libraryItemId !== b.libraryItemId) return a.libraryItemId < b.libraryItemId ? -1 : 1
      return Number(a.time) - Number(b.time)
    })

    const results = matches.slice(page * itemsPerPage, (page + 1) * itemsPerPage).map((bm) => {
      const libraryItem = libraryItemsById.get(bm.libraryItemId)
      return {
        libraryItemId: bm.libraryItemId,
        time: Number(bm.time),
        title: bm.title,
        createdAt: bm.createdAt,
        libraryId: libraryItem.libraryId,
        bookTitle: getBookTitle(libraryItem)
      }
    })

    res.json({
      results,
      books,
      total,
      numPages: Math.ceil(total / itemsPerPage),
      page,
      itemsPerPage
    })
  }

  /**
   * GET: /api/me/listening-sessions
   *
   * @this import('../routers/ApiRouter')
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async getListeningSessions(req, res) {
    const listeningSessions = await this.getUserListeningSessionsHelper(req.user.id)

    const itemsPerPage = toNumber(req.query.itemsPerPage, 10) || 10
    const page = toNumber(req.query.page, 0)

    const start = page * itemsPerPage
    const sessions = listeningSessions.slice(start, start + itemsPerPage)

    const payload = {
      total: listeningSessions.length,
      numPages: Math.ceil(listeningSessions.length / itemsPerPage),
      page,
      itemsPerPage,
      sessions
    }

    res.json(payload)
  }

  /**
   * GET: /api/me/item/listening-sessions/:libraryItemId/:episodeId
   *
   * @this import('../routers/ApiRouter')
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async getItemListeningSessions(req, res) {
    const libraryItem = await Database.libraryItemModel.getExpandedById(req.params.libraryItemId)
    const episode = await Database.podcastEpisodeModel.findByPk(req.params.episodeId)

    if (!libraryItem || (libraryItem.isPodcast && !episode)) {
      Logger.error(`[MeController] Media item not found for library item id "${req.params.libraryItemId}"`)
      return res.sendStatus(404)
    }

    // Check if user has access to this library item
    if (!req.user.checkCanAccessLibraryItem(libraryItem)) {
      Logger.error(`[MeController] User "${req.user.username}" attempted to access listening sessions for library item "${req.params.libraryItemId}" without access`)
      return res.sendStatus(403)
    }

    const mediaItemId = episode?.id || libraryItem.mediaId
    let listeningSessions = await this.getUserItemListeningSessionsHelper(req.user.id, mediaItemId)

    const itemsPerPage = toNumber(req.query.itemsPerPage, 10) || 10
    const page = toNumber(req.query.page, 0)

    const start = page * itemsPerPage
    const sessions = listeningSessions.slice(start, start + itemsPerPage)

    const payload = {
      total: listeningSessions.length,
      numPages: Math.ceil(listeningSessions.length / itemsPerPage),
      page,
      itemsPerPage,
      sessions
    }

    res.json(payload)
  }

  /**
   * GET: /api/me/listening-stats
   *
   * @this import('../routers/ApiRouter')
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async getListeningStats(req, res) {
    const listeningStats = await this.getUserListeningStatsHelpers(req.user.id)
    res.json(listeningStats)
  }

  /**
   * GET: /api/me/progress/:id/:episodeId?
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async getMediaProgress(req, res) {
    const mediaProgress = req.user.getOldMediaProgress(req.params.id, req.params.episodeId || null)
    if (!mediaProgress) {
      return res.sendStatus(404)
    }
    res.json(mediaProgress)
  }

  /**
   * DELETE: /api/me/progress/:id
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async removeMediaProgress(req, res) {
    // Verify the media progress belongs to the current user
    const mediaProgress = req.user.mediaProgresses.find((mp) => mp.id === req.params.id)
    if (!mediaProgress) {
      Logger.error(`[MeController] Media progress not found or does not belong to user "${req.user.username}"`)
      return res.sendStatus(404)
    }

    await Database.mediaProgressModel.removeById(req.params.id)
    req.user.mediaProgresses = req.user.mediaProgresses.filter((mp) => mp.id !== req.params.id)

    SocketAuthority.clientEmitter(req.user.id, 'user_updated', await bookmarkQueries.toOldJSONForBrowserForSelf(req.user))
    res.sendStatus(200)
  }

  /**
   * PATCH: /api/me/progress/:libraryItemId/:episodeId?
   * TODO: Update to use mediaItemId and mediaItemType
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async createUpdateMediaProgress(req, res) {
    const progressUpdatePayload = {
      ...req.body,
      libraryItemId: req.params.libraryItemId,
      episodeId: req.params.episodeId
    }
    const mediaProgressResponse = await req.user.createUpdateMediaProgressFromPayload(progressUpdatePayload)
    if (mediaProgressResponse.error) {
      return res.status(mediaProgressResponse.statusCode || 400).send(mediaProgressResponse.error)
    }

    SocketAuthority.clientEmitter(req.user.id, 'user_updated', await bookmarkQueries.toOldJSONForBrowserForSelf(req.user))
    res.sendStatus(200)
  }

  /**
   * PATCH: /api/me/progress/batch/update
   * TODO: Update to use mediaItemId and mediaItemType
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async batchUpdateMediaProgress(req, res) {
    const itemProgressPayloads = req.body
    if (!itemProgressPayloads?.length) {
      return res.status(400).send('Missing request payload')
    }

    let hasUpdated = false
    for (const itemProgress of itemProgressPayloads) {
      const mediaProgressResponse = await req.user.createUpdateMediaProgressFromPayload(itemProgress)
      if (mediaProgressResponse.error) {
        Logger.error(`[MeController] batchUpdateMediaProgress: ${mediaProgressResponse.error}`)
        continue
      } else {
        hasUpdated = true
      }
    }

    if (hasUpdated) {
      SocketAuthority.clientEmitter(req.user.id, 'user_updated', await bookmarkQueries.toOldJSONForBrowserForSelf(req.user))
    }

    res.sendStatus(200)
  }

  /**
   * POST: /api/me/item/:id/bookmark
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async createBookmark(req, res) {
    const libraryItem = await MeController.getAccessibleLibraryItem(req, res, req.params.id, 'create bookmark')
    if (!libraryItem) return

    const { time, title } = req.body
    if (isNullOrNaN(time)) {
      Logger.error(`[MeController] createBookmark invalid time`, time)
      return res.status(400).send('Invalid time')
    }
    if (!title || typeof title !== 'string') {
      Logger.error(`[MeController] createBookmark invalid title`, title)
      return res.status(400).send('Invalid title')
    }

    const bookmark = await req.user.createBookmark(req.params.id, time, title)
    SocketAuthority.clientEmitter(req.user.id, 'user_updated', await bookmarkQueries.toOldJSONForBrowserForSelf(req.user))
    res.json(bookmark)
  }

  /**
   * PATCH: /api/me/item/:id/bookmark
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async updateBookmark(req, res) {
    const libraryItem = await MeController.getAccessibleLibraryItem(req, res, req.params.id, 'update bookmark')
    if (!libraryItem) return

    const { time, title } = req.body
    if (isNullOrNaN(time)) {
      Logger.error(`[MeController] updateBookmark invalid time`, time)
      return res.status(400).send('Invalid time')
    }
    if (!title || typeof title !== 'string') {
      Logger.error(`[MeController] updateBookmark invalid title`, title)
      return res.status(400).send('Invalid title')
    }

    const bookmark = await req.user.updateBookmark(req.params.id, time, title)
    if (!bookmark) {
      Logger.error(`[MeController] updateBookmark not found for library item id "${req.params.id}" and time "${time}"`)
      return res.sendStatus(404)
    }

    SocketAuthority.clientEmitter(req.user.id, 'user_updated', await bookmarkQueries.toOldJSONForBrowserForSelf(req.user))
    res.json(bookmark)
  }

  /**
   * DELETE: /api/me/item/:id/bookmark/:time
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async removeBookmark(req, res) {
    const libraryItem = await MeController.getAccessibleLibraryItem(req, res, req.params.id, 'remove bookmark')
    if (!libraryItem) return

    const time = Number(req.params.time)
    if (isNaN(time)) {
      return res.status(400).send('Invalid time')
    }

    if (!req.user.findBookmark(req.params.id, time)) {
      Logger.error(`[MeController] removeBookmark not found`)
      return res.sendStatus(404)
    }

    await req.user.removeBookmark(req.params.id, time)

    SocketAuthority.clientEmitter(req.user.id, 'user_updated', await bookmarkQueries.toOldJSONForBrowserForSelf(req.user))
    res.sendStatus(200)
  }

  /**
   * POST: /api/me/item/:libraryItemId/bookmarks/import/preview
   * Writes nothing.
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async previewBookmarkImport(req, res) {
    const libraryItem = await MeController.getLibraryItemForBookmarkImport(req, res, 'preview import of bookmarks')
    if (!libraryItem) return

    const parsed = parseBookmarkFile(req.body?.file)
    if (!parsed.ok) {
      return res.status(400).json({ errors: parsed.errors })
    }

    const diff = diffBookmarks(selectBookmarksForItem(req.user.bookmarks, libraryItem.id), parsed.entries)
    res.json({ hints: parsed.hints, ...diff })
  }

  /**
   * POST: /api/me/item/:libraryItemId/bookmarks/import
   * Body: { file: <parsed bookmarks file>, mode: 'keep' | 'replace' }
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async importBookmarks(req, res) {
    const libraryItem = await MeController.getLibraryItemForBookmarkImport(req, res, 'import bookmarks')
    if (!libraryItem) return

    const mode = req.body?.mode
    if (mode !== 'keep' && mode !== 'replace') {
      return res.status(400).json({ errors: ['"mode" must be "keep" or "replace"'] })
    }

    const parsed = parseBookmarkFile(req.body?.file)
    if (!parsed.ok) {
      return res.status(400).json({ errors: parsed.errors })
    }

    const previousBookmarks = req.user.bookmarks
    let summary
    try {
      summary = applyBookmarkImport(req.user, libraryItem.id, parsed.entries, mode)
      if (summary.changed) {
        await req.user.save()
      }
    } catch (error) {
      Logger.error(`[MeController] importBookmarks failed for library item "${libraryItem.id}"`, error)
      // Don't leave a half-applied import in memory
      try {
        await req.user.reload()
      } catch (reloadError) {
        Logger.error(`[MeController] importBookmarks failed to reload user, restoring previous bookmarks`, reloadError)
        req.user.bookmarks = previousBookmarks
      }
      return res.status(500).send('Failed to import bookmarks')
    }

    if (summary.changed) {
      SocketAuthority.clientEmitter(req.user.id, 'user_updated', await bookmarkQueries.toOldJSONForBrowserForSelf(req.user))
    }
    res.json({
      summary,
      bookmarks: selectBookmarksForItem(req.user.bookmarks, libraryItem.id).map((bm) => ({ ...bm }))
    })
  }

  /**
   * PATCH: /api/me/password
   * User change password. Requires current password.
   * Guest users cannot change password.
   *
   * Invalidates all other JWT sessions for the user. If using x-refresh-token, returns new tokens for the current session.
   *
   * @this import('../routers/ApiRouter')
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async updatePassword(req, res) {
    if (req.user.isGuest) {
      Logger.error(`[MeController] Guest user "${req.user.username}" attempted to change password`)
      return res.sendStatus(403)
    }

    const { password, newPassword } = req.body
    if ((typeof password !== 'string' && password !== null) || (typeof newPassword !== 'string' && newPassword !== null)) {
      return res.status(400).send('Missing or invalid password or new password')
    }

    const result = await this.auth.localAuthStrategy.changePassword(req.user, password, newPassword)

    if (result.error) {
      return res.status(400).send(result.error)
    }

    const shouldReturnTokens = !!req.headers['x-refresh-token']
    const newTokens = await this.auth.invalidateJwtSessionsForUser(req.user, req, res)

    if (newTokens?.accessToken) {
      Logger.info(`[MeController] Invalidated other JWT sessions for user ${req.user.username} after password change`)
      if (shouldReturnTokens) {
        return res.json({
          success: true,
          user: {
            accessToken: newTokens.accessToken,
            refreshToken: newTokens.refreshToken
          }
        })
      }
    } else {
      Logger.info(`[MeController] Invalidated all JWT sessions for user ${req.user.username} after password change`)
    }

    res.sendStatus(200)
  }

  /**
   * GET: /api/me/items-in-progress
   * Pull items in progress for all libraries
   * Used in Android Auto in progress list since there is no easy library selection
   * TODO: Update to use mediaItemId and mediaItemType. Use sort & limit in query
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async getAllLibraryItemsInProgress(req, res) {
    const limit = !isNaN(req.query.limit) ? Number(req.query.limit) || 25 : 25

    const mediaProgressesInProgress = req.user.mediaProgresses.filter((mp) => !mp.isFinished && (mp.currentTime > 0 || mp.ebookProgress > 0))

    const libraryItemsIds = [...new Set(mediaProgressesInProgress.map((mp) => mp.extraData?.libraryItemId).filter((id) => id))]
    const libraryItems = await Database.libraryItemModel.findAllExpandedWhere({ id: libraryItemsIds })

    let itemsInProgress = []

    for (const mediaProgress of mediaProgressesInProgress) {
      const oldMediaProgress = mediaProgress.getOldMediaProgress()
      const libraryItem = libraryItems.find((li) => li.id === oldMediaProgress.libraryItemId)
      if (libraryItem) {
        if (oldMediaProgress.episodeId && libraryItem.isPodcast) {
          const episode = libraryItem.media.podcastEpisodes.find((ep) => ep.id === oldMediaProgress.episodeId)
          if (episode) {
            const libraryItemWithEpisode = {
              ...libraryItem.toOldJSONMinified(),
              recentEpisode: episode.toOldJSON(libraryItem.id),
              progressLastUpdate: oldMediaProgress.lastUpdate
            }
            itemsInProgress.push(libraryItemWithEpisode)
          }
        } else if (!oldMediaProgress.episodeId) {
          itemsInProgress.push({
            ...libraryItem.toOldJSONMinified(),
            progressLastUpdate: oldMediaProgress.lastUpdate
          })
        }
      }
    }

    itemsInProgress = sort(itemsInProgress)
      .desc((li) => li.progressLastUpdate)
      .slice(0, limit)
    res.json({
      libraryItems: itemsInProgress
    })
  }

  /**
   * GET: /api/me/series/:id/remove-from-continue-listening
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async removeSeriesFromContinueListening(req, res) {
    if (!(await Database.seriesModel.checkExistsById(req.params.id))) {
      Logger.error(`[MeController] removeSeriesFromContinueListening: Series ${req.params.id} not found`)
      return res.sendStatus(404)
    }

    const hasUpdated = await req.user.addSeriesToHideFromContinueListening(req.params.id)
    if (hasUpdated) {
      SocketAuthority.clientEmitter(req.user.id, 'user_updated', await bookmarkQueries.toOldJSONForBrowserForSelf(req.user))
    }
    res.json(await bookmarkQueries.toOldJSONForBrowserForSelf(req.user))
  }

  /**
   * GET: api/me/series/:id/readd-to-continue-listening
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async readdSeriesFromContinueListening(req, res) {
    if (!(await Database.seriesModel.checkExistsById(req.params.id))) {
      Logger.error(`[MeController] readdSeriesFromContinueListening: Series ${req.params.id} not found`)
      return res.sendStatus(404)
    }

    const hasUpdated = await req.user.removeSeriesFromHideFromContinueListening(req.params.id)
    if (hasUpdated) {
      SocketAuthority.clientEmitter(req.user.id, 'user_updated', await bookmarkQueries.toOldJSONForBrowserForSelf(req.user))
    }
    res.json(await bookmarkQueries.toOldJSONForBrowserForSelf(req.user))
  }

  /**
   * GET: api/me/progress/:id/remove-from-continue-listening
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async removeItemFromContinueListening(req, res) {
    const mediaProgress = req.user.mediaProgresses.find((mp) => mp.id === req.params.id)
    if (!mediaProgress) {
      return res.sendStatus(404)
    }

    // Already hidden
    if (mediaProgress.hideFromContinueListening) {
      return res.json(await bookmarkQueries.toOldJSONForBrowserForSelf(req.user))
    }

    mediaProgress.hideFromContinueListening = true
    await mediaProgress.save()

    SocketAuthority.clientEmitter(req.user.id, 'user_updated', await bookmarkQueries.toOldJSONForBrowserForSelf(req.user))

    res.json(await bookmarkQueries.toOldJSONForBrowserForSelf(req.user))
  }

  /**
   * POST: /api/me/ereader-devices
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async updateUserEReaderDevices(req, res) {
    if (!req.body.ereaderDevices || !Array.isArray(req.body.ereaderDevices)) {
      return res.status(400).send('Invalid payload. ereaderDevices array required')
    }

    const userEReaderDevices = req.body.ereaderDevices
    for (const device of userEReaderDevices) {
      if (!device.name || !device.email) {
        return res.status(400).send('Invalid payload. ereaderDevices array items must have name and email')
      } else if (device.availabilityOption !== 'specificUsers' || device.users?.length !== 1 || device.users[0] !== req.user.id) {
        return res.status(400).send('Invalid payload. ereaderDevices array items must have availabilityOption "specificUsers" and only the current user')
      }
    }

    const otherDevices = Database.emailSettings.ereaderDevices.filter((device) => {
      return !Database.emailSettings.checkUserCanAccessDevice(device, req.user) || device.users?.length !== 1
    })

    const ereaderDevices = otherDevices.concat(userEReaderDevices)

    // Check for duplicate names
    const nameSet = new Set()
    const hasDupes = ereaderDevices.some((device) => {
      if (nameSet.has(device.name)) {
        return true // Duplicate found
      }
      nameSet.add(device.name)
      return false
    })

    if (hasDupes) {
      return res.status(400).send('Invalid payload. Duplicate "name" field found.')
    }

    const updated = Database.emailSettings.update({ ereaderDevices })
    if (updated) {
      await Database.updateSetting(Database.emailSettings)
      SocketAuthority.clientEmitter(req.user.id, 'ereader-devices-updated', {
        ereaderDevices: Database.emailSettings.getEReaderDevices(req.user)
      })
    }
    res.json({
      ereaderDevices: Database.emailSettings.getEReaderDevices(req.user)
    })
  }

  /**
   * GET: /api/me/stats/year/:year
   *
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   */
  async getStatsForYear(req, res) {
    const year = Number(req.params.year)
    if (isNaN(year) || year < 2000 || year > 9999) {
      Logger.error(`[MeController] Invalid year "${year}"`)
      return res.status(400).send('Invalid year')
    }
    const data = await userStats.getStatsForYear(req.user.id, year)
    res.json(data)
  }
}
module.exports = new MeController()