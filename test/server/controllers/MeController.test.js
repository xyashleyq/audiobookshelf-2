const { expect } = require('chai')
const { Sequelize } = require('sequelize')
const sinon = require('sinon')
const { v4: uuidv4 } = require('uuid')

// Auth must load before Database (same order as Server.js) so Auth's Database reference is not a partial circular export
const Auth = require('../../../server/Auth')
const Database = require('../../../server/Database')
const ApiRouter = require('../../../server/routers/ApiRouter')
const MeController = require('../../../server/controllers/MeController')
const Logger = require('../../../server/Logger')
const SocketAuthority = require('../../../server/SocketAuthority')

function makeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code
      return this
    },
    json(body) {
      this.body = body
      return this
    },
    send(body) {
      this.body = body
      return this
    },
    sendStatus(code) {
      this.statusCode = code
      return this
    }
  }
}

describe('MeController - bookmarks', () => {
  /** @type {ApiRouter} */
  let apiRouter
  let user
  let libA, libB, podLib
  let itemHailMary, itemMartian, itemRestricted, itemTagged, itemExplicit, itemPodcast
  const deletedItemId = uuidv4()

  async function createBookItem(library, folder, title, extra = {}) {
    const book = await Database.bookModel.create({ title, audioFiles: [], tags: [], narrators: [], genres: [], chapters: [], ...extra })
    return Database.libraryItemModel.create({
      title,
      libraryFiles: [],
      mediaId: book.id,
      mediaType: 'book',
      libraryId: library.id,
      libraryFolderId: folder.id
    })
  }

  async function setBookmarks(bookmarks) {
    user.bookmarks = bookmarks
    user.changed('bookmarks', true)
    await user.save()
  }

  async function search(query = {}) {
    const res = makeRes()
    await MeController.searchBookmarks.call(apiRouter, { user, query, params: {} }, res)
    return res
  }

  function restrictToLibraries(libraryIds) {
    user.permissions = { ...user.permissions, accessAllLibraries: false, librariesAccessible: libraryIds }
  }

  beforeEach(async () => {
    global.ServerSettings = {}
    Database.sequelize = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false })
    Database.sequelize.uppercaseFirst = (str) => (str ? `${str[0].toUpperCase()}${str.substr(1)}` : '')
    await Database.buildModels()

    const mockServer = {
      auth: new Auth(),
      playbackSessionManager: { sessions: [] },
      abMergeManager: {},
      backupManager: {},
      podcastManager: {},
      audioMetadataManager: {},
      cronManager: {},
      emailManager: {},
      apiCacheManager: { middleware: (req, res, next) => next() }
    }
    apiRouter = new ApiRouter(mockServer)

    sinon.stub(Logger, 'info')
    sinon.stub(Logger, 'warn')
    sinon.stub(Logger, 'error')
    sinon.stub(SocketAuthority, 'clientEmitter')

    libA = await Database.libraryModel.create({ name: 'Library A', mediaType: 'book' })
    const folderA = await Database.libraryFolderModel.create({ path: '/a', libraryId: libA.id })
    libB = await Database.libraryModel.create({ name: 'Library B', mediaType: 'book' })
    const folderB = await Database.libraryFolderModel.create({ path: '/b', libraryId: libB.id })
    podLib = await Database.libraryModel.create({ name: 'Podcasts', mediaType: 'podcast' })
    const podFolder = await Database.libraryFolderModel.create({ path: '/p', libraryId: podLib.id })

    itemHailMary = await createBookItem(libA, folderA, 'Project Hail Mary')
    itemMartian = await createBookItem(libA, folderA, 'The Martian')
    itemRestricted = await createBookItem(libB, folderB, 'Restricted Book')
    itemTagged = await createBookItem(libA, folderA, 'Tagged Book', { tags: ['secret'] })
    itemExplicit = await createBookItem(libA, folderA, 'Explicit Book', { explicit: true })

    const podcast = await Database.podcastModel.create({ title: 'Some Podcast', tags: [], genres: [], autoDownloadEpisodes: false })
    itemPodcast = await Database.libraryItemModel.create({
      title: 'Some Podcast',
      libraryFiles: [],
      mediaId: podcast.id,
      mediaType: 'podcast',
      libraryId: podLib.id,
      libraryFolderId: podFolder.id
    })

    user = await Database.userModel.create({
      username: 'reader',
      pash: 'hashed',
      type: 'user',
      isActive: true,
      permissions: Database.userModel.getDefaultPermissionsForUserType('user'),
      bookmarks: []
    })
  })

  afterEach(async () => {
    sinon.restore()
    await Database.sequelize.sync({ force: true })
  })

  describe('searchBookmarks', () => {
    it('S1: returns duplicate note text on two books, each with its own bookTitle and time', async () => {
      await setBookmarks([
        { libraryItemId: itemHailMary.id, time: 100, title: 'great line', createdAt: 1000 },
        { libraryItemId: itemMartian.id, time: 200, title: 'great line', createdAt: 2000 }
      ])
      const res = await search({ q: 'great line' })
      expect(res.statusCode).to.equal(200)
      expect(res.body.total).to.equal(2)
      expect(res.body.results.map((r) => [r.bookTitle, r.time])).to.deep.equal([
        ['The Martian', 200],
        ['Project Hail Mary', 100]
      ])
      expect(res.body.results[0]).to.have.all.keys('libraryItemId', 'time', 'title', 'createdAt', 'libraryId', 'bookTitle')
      expect(res.body.results[0].libraryId).to.equal(libA.id)
    })

    it('S2: no match returns empty results', async () => {
      await setBookmarks([{ libraryItemId: itemHailMary.id, time: 100, title: 'rocky', createdAt: 1000 }])
      const res = await search({ q: 'nothing here' })
      expect(res.body.results).to.deep.equal([])
      expect(res.body.total).to.equal(0)
      expect(res.body.numPages).to.equal(0)
    })

    it('S3: bookmark on a deleted item is omitted without throwing and is not pruned', async () => {
      await setBookmarks([
        { libraryItemId: deletedItemId, time: 5, title: 'ghost note', createdAt: 1000 },
        { libraryItemId: itemHailMary.id, time: 100, title: 'real note', createdAt: 2000 }
      ])
      const res = await search({})
      expect(res.statusCode).to.equal(200)
      expect(res.body.results.map((r) => r.title)).to.deep.equal(['real note'])
      const reloaded = await Database.userModel.findByPk(user.id)
      expect(reloaded.bookmarks.map((b) => b.title)).to.include('ghost note')
    })

    it('S4/S7: library access removed hides that book but still returns accessible ones', async () => {
      await setBookmarks([
        { libraryItemId: itemRestricted.id, time: 10, title: 'forbidden secret note', createdAt: 1000 },
        { libraryItemId: itemHailMary.id, time: 100, title: 'allowed note', createdAt: 2000 }
      ])
      restrictToLibraries([libA.id])
      const res = await search({})
      expect(res.statusCode).to.equal(200)
      expect(JSON.stringify(res.body)).to.not.include('forbidden secret note')
      expect(JSON.stringify(res.body)).to.not.include('Restricted Book')
      expect(res.body.results.map((r) => r.title)).to.deep.equal(['allowed note'])
    })

    it('S5: tag-restricted item is hidden', async () => {
      await setBookmarks([
        { libraryItemId: itemTagged.id, time: 10, title: 'tagged secret note', createdAt: 1000 },
        { libraryItemId: itemHailMary.id, time: 100, title: 'allowed note', createdAt: 2000 }
      ])
      user.permissions = { ...user.permissions, accessAllTags: false, selectedTagsNotAccessible: true, itemTagsSelected: ['secret'] }
      const res = await search({})
      expect(JSON.stringify(res.body)).to.not.include('tagged secret note')
      expect(res.body.results.map((r) => r.title)).to.deep.equal(['allowed note'])
    })

    it('S6: explicit item hidden from user without explicit access', async () => {
      await setBookmarks([
        { libraryItemId: itemExplicit.id, time: 10, title: 'explicit note', createdAt: 1000 },
        { libraryItemId: itemHailMary.id, time: 100, title: 'allowed note', createdAt: 2000 }
      ])
      const res = await search({})
      expect(JSON.stringify(res.body)).to.not.include('explicit note')
      expect(res.body.total).to.equal(1)
    })

    it('S8: podcast bookmarks are omitted from search but kept by getAllBookmarks', async () => {
      await setBookmarks([
        { libraryItemId: itemPodcast.id, time: 10, title: 'podcast note', createdAt: 1000 },
        { libraryItemId: itemHailMary.id, time: 100, title: 'book note', createdAt: 2000 }
      ])
      const res = await search({})
      expect(res.statusCode).to.equal(200)
      expect(res.body.results.map((r) => r.title)).to.deep.equal(['book note'])

      const allRes = makeRes()
      await MeController.getAllBookmarks.call(apiRouter, { user, query: {}, params: {} }, allRes)
      expect(allRes.body.bookmarks.map((b) => b.title)).to.have.members(['podcast note', 'book note'])
    })

    it('S9: paging returns every match exactly once', async () => {
      const bookmarks = []
      for (let i = 0; i < 12; i++) {
        bookmarks.push({ libraryItemId: i % 2 ? itemHailMary.id : itemMartian.id, time: i * 10, title: `note ${i}`, createdAt: 1000 + i })
      }
      await setBookmarks(bookmarks)
      const seen = []
      for (let page = 0; page < 3; page++) {
        const res = await search({ itemsPerPage: '5', page: String(page) })
        expect(res.body.results.length).to.be.at.most(5)
        expect(res.body.numPages).to.equal(3)
        expect(res.body.total).to.equal(12)
        seen.push(...res.body.results.map((r) => r.title))
      }
      expect(seen).to.have.lengthOf(12)
      expect(new Set(seen).size).to.equal(12)
    })

    it('S10: identical createdAt values still page deterministically', async () => {
      await setBookmarks([
        { libraryItemId: itemMartian.id, time: 30, title: 'c', createdAt: 5000 },
        { libraryItemId: itemHailMary.id, time: 20, title: 'b', createdAt: 5000 },
        { libraryItemId: itemHailMary.id, time: 10, title: 'a', createdAt: 5000 },
        { libraryItemId: itemMartian.id, time: 5, title: 'd', createdAt: 5000 }
      ])
      const expected = [
        [itemHailMary.id, itemMartian.id].sort()[0],
        [itemHailMary.id, itemMartian.id].sort()[0],
        [itemHailMary.id, itemMartian.id].sort()[1],
        [itemHailMary.id, itemMartian.id].sort()[1]
      ]
      const pages = []
      for (let page = 0; page < 2; page++) {
        const res = await search({ itemsPerPage: '2', page: String(page) })
        pages.push(...res.body.results)
      }
      expect(pages.map((r) => r.libraryItemId)).to.deep.equal(expected)
      expect(pages[0].time).to.be.lessThan(pages[1].time)
      expect(pages[2].time).to.be.lessThan(pages[3].time)
    })

    it('S11: string time sorts numerically and is returned as a number', async () => {
      await setBookmarks([
        { libraryItemId: itemHailMary.id, time: 1000, title: 'x', createdAt: 1 },
        { libraryItemId: itemHailMary.id, time: '120', title: 'y', createdAt: 1 },
        { libraryItemId: itemHailMary.id, time: 30, title: 'z', createdAt: 1 }
      ])
      const res = await search({})
      expect(res.body.results.map((r) => r.time)).to.deep.equal([30, 120, 1000])
      res.body.results.forEach((r) => expect(r.time).to.be.a('number'))
    })

    it('S12: matching is case-insensitive', async () => {
      await setBookmarks([{ libraryItemId: itemHailMary.id, time: 1, title: 'rocky speaks', createdAt: 1 }])
      const res = await search({ q: 'ROCKY' })
      expect(res.body.total).to.equal(1)
    })

    it('S13: special characters match literally', async () => {
      const chars = ['%', '_', '.', '*', '(']
      await setBookmarks([
        ...chars.map((c, i) => ({ libraryItemId: itemHailMary.id, time: i, title: `has ${c} char`, createdAt: 1 })),
        { libraryItemId: itemHailMary.id, time: 99, title: 'plain words', createdAt: 1 }
      ])
      for (const c of chars) {
        const res = await search({ q: c })
        expect(res.statusCode).to.equal(200)
        expect(res.body.results.map((r) => r.title)).to.deep.equal([`has ${c} char`])
      }
    })

    it('S14: libraryItemId filter for an inaccessible or unknown id returns empty 200', async () => {
      await setBookmarks([
        { libraryItemId: itemRestricted.id, time: 10, title: 'forbidden', createdAt: 1000 },
        { libraryItemId: itemHailMary.id, time: 100, title: 'allowed', createdAt: 2000 }
      ])
      restrictToLibraries([libA.id])
      for (const id of [itemRestricted.id, uuidv4()]) {
        const res = await search({ libraryItemId: id })
        expect(res.statusCode).to.equal(200)
        expect(res.body.results).to.deep.equal([])
        expect(res.body.total).to.equal(0)
      }
    })

    it('S15: books lists only accessible bookmarked books, unaffected by q', async () => {
      await setBookmarks([
        { libraryItemId: itemRestricted.id, time: 10, title: 'forbidden', createdAt: 1000 },
        { libraryItemId: itemMartian.id, time: 100, title: 'potatoes', createdAt: 2000 },
        { libraryItemId: itemHailMary.id, time: 100, title: 'rocky', createdAt: 3000 },
        { libraryItemId: itemHailMary.id, time: 200, title: 'rocky again', createdAt: 4000 }
      ])
      restrictToLibraries([libA.id])
      const res = await search({ q: 'rocky' })
      expect(res.body.books).to.deep.equal([
        { libraryItemId: itemHailMary.id, title: 'Project Hail Mary' },
        { libraryItemId: itemMartian.id, title: 'The Martian' }
      ])
    })

    it('S16: null bookmarks returns empty 200', async () => {
      user.bookmarks = null
      const res = await search({ q: 'x' })
      expect(res.statusCode).to.equal(200)
      expect(res.body.results).to.deep.equal([])
      expect(res.body.books).to.deep.equal([])
    })

    it('S17: itemsPerPage is clamped to 100', async () => {
      await setBookmarks([{ libraryItemId: itemHailMary.id, time: 1, title: 'a', createdAt: 1 }])
      const res = await search({ itemsPerPage: '1000' })
      expect(res.body.itemsPerPage).to.equal(100)
      const resLow = await search({ itemsPerPage: '0', page: '-3' })
      expect(resLow.body.itemsPerPage).to.equal(1)
      expect(resLow.body.page).to.equal(0)
    })

    it('S18: search filtered by book agrees with getBookmarksForLibraryItem', async () => {
      await setBookmarks([
        { libraryItemId: itemHailMary.id, time: 100, title: 'one', createdAt: 1000 },
        { libraryItemId: itemHailMary.id, time: 200, title: 'two', createdAt: 2000 },
        { libraryItemId: itemMartian.id, time: 300, title: 'three', createdAt: 3000 }
      ])
      const res = await search({ libraryItemId: itemHailMary.id })
      const perBookRes = makeRes()
      await MeController.getBookmarksForLibraryItem.call(apiRouter, { user, query: {}, params: { libraryItemId: itemHailMary.id } }, perBookRes)
      const key = (b) => `${b.libraryItemId}:${Number(b.time)}:${b.title}`
      expect(res.body.results.map(key)).to.have.members(perBookRes.body.bookmarks.map(key))
      expect(res.body.results).to.have.lengthOf(perBookRes.body.bookmarks.length)
    })

    it('S19: search does not touch media progress', async () => {
      await Database.mediaProgressModel.create({ userId: user.id, mediaItemId: itemHailMary.mediaId, mediaItemType: 'book', duration: 100, currentTime: 42, isFinished: false })
      await setBookmarks([{ libraryItemId: itemHailMary.id, time: 1, title: 'a', createdAt: 1 }])
      const before = (await Database.mediaProgressModel.findAll()).map((p) => JSON.stringify(p.get({ plain: true })))
      await search({ q: 'a' })
      await search({ libraryItemId: itemHailMary.id, page: '1' })
      const after = (await Database.mediaProgressModel.findAll()).map((p) => JSON.stringify(p.get({ plain: true })))
      expect(after).to.deep.equal(before)
    })
  })

  describe('getAllBookmarks', () => {
    it('S20: drops deleted and inaccessible items and keeps shape', async () => {
      await setBookmarks([
        { libraryItemId: deletedItemId, time: 5, title: 'ghost', createdAt: 1 },
        { libraryItemId: itemRestricted.id, time: 10, title: 'forbidden', createdAt: 2 },
        { libraryItemId: itemHailMary.id, time: 100, title: 'allowed', createdAt: 3 }
      ])
      restrictToLibraries([libA.id, podLib.id])
      const res = makeRes()
      await MeController.getAllBookmarks.call(apiRouter, { user, query: {}, params: {} }, res)
      expect(res.body).to.have.all.keys('bookmarks')
      expect(res.body.bookmarks).to.deep.equal([{ libraryItemId: itemHailMary.id, time: 100, title: 'allowed', createdAt: 3 }])
    })
  })

  describe('per-book bookmark endpoints (regression)', () => {
    it('S21: getBookmarksForLibraryItem 404/403/200 and create/update/remove status codes', async () => {
      await setBookmarks([{ libraryItemId: itemHailMary.id, time: 100, title: 'one', createdAt: 1 }])
      restrictToLibraries([libA.id])

      let res = makeRes()
      await MeController.getBookmarksForLibraryItem.call(apiRouter, { user, params: { libraryItemId: uuidv4() } }, res)
      expect(res.statusCode).to.equal(404)

      res = makeRes()
      await MeController.getBookmarksForLibraryItem.call(apiRouter, { user, params: { libraryItemId: itemRestricted.id } }, res)
      expect(res.statusCode).to.equal(403)

      res = makeRes()
      await MeController.getBookmarksForLibraryItem.call(apiRouter, { user, params: { libraryItemId: itemHailMary.id } }, res)
      expect(res.statusCode).to.equal(200)
      expect(res.body).to.deep.equal({ bookmarks: [{ libraryItemId: itemHailMary.id, time: 100, title: 'one', createdAt: 1 }] })

      res = makeRes()
      await MeController.createBookmark.call(apiRouter, { user, params: { id: itemRestricted.id }, body: { time: 1, title: 'x' } }, res)
      expect(res.statusCode).to.equal(403)

      res = makeRes()
      await MeController.createBookmark.call(apiRouter, { user, params: { id: itemHailMary.id }, body: { time: 200, title: 'two' } }, res)
      expect(res.statusCode).to.equal(200)
      expect(res.body).to.include({ libraryItemId: itemHailMary.id, time: 200, title: 'two' })

      res = makeRes()
      await MeController.updateBookmark.call(apiRouter, { user, params: { id: itemHailMary.id }, body: { time: 200, title: 'two edited' } }, res)
      expect(res.statusCode).to.equal(200)

      res = makeRes()
      await MeController.updateBookmark.call(apiRouter, { user, params: { id: itemHailMary.id }, body: { time: 999, title: 'nope' } }, res)
      expect(res.statusCode).to.equal(404)

      res = makeRes()
      await MeController.removeBookmark.call(apiRouter, { user, params: { id: itemHailMary.id, time: '200' } }, res)
      expect(res.statusCode).to.equal(200)

      res = makeRes()
      await MeController.removeBookmark.call(apiRouter, { user, params: { id: itemHailMary.id, time: '200' } }, res)
      expect(res.statusCode).to.equal(404)
    })
  })

  describe('self-facing user payloads', () => {
    beforeEach(async () => {
      await setBookmarks([
        { libraryItemId: itemRestricted.id, time: 10, title: 'forbidden secret note', createdAt: 1 },
        { libraryItemId: itemHailMary.id, time: 100, title: 'allowed note', createdAt: 2 }
      ])
      restrictToLibraries([libA.id])
    })

    it('S22: login payload excludes inaccessible bookmarks', async () => {
      Database.serverSettings = { toJSONForBrowser: () => ({}) }
      Database.emailSettings = { getEReaderDevices: () => [] }
      // Load a fresh Auth: when another test file loaded Database first, the cached Auth module holds a partial circular Database export
      const authPath = require.resolve('../../../server/Auth')
      delete require.cache[authPath]
      const FreshAuth = require(authPath)
      const payload = await new FreshAuth().getUserLoginResponsePayload(user)
      const titles = payload.user.bookmarks.map((b) => b.title)
      expect(titles).to.deep.equal(['allowed note'])
      Database.serverSettings = null
      Database.emailSettings = null
    })

    it('GET /api/me excludes inaccessible bookmarks', async () => {
      const res = makeRes()
      await MeController.getCurrentUser.call(apiRouter, { user, query: {}, params: {} }, res)
      expect(res.body.bookmarks.map((b) => b.title)).to.deep.equal(['allowed note'])
      expect(res.body.id).to.equal(user.id)
    })

    it('S23: user_updated after createBookmark includes the new bookmark and excludes inaccessible ones', async () => {
      const res = makeRes()
      await MeController.createBookmark.call(apiRouter, { user, params: { id: itemMartian.id }, body: { time: 300, title: 'brand new' } }, res)
      expect(res.statusCode).to.equal(200)
      const call = SocketAuthority.clientEmitter.getCalls().find((c) => c.args[1] === 'user_updated')
      expect(call, 'user_updated emitted').to.exist
      const titles = call.args[2].bookmarks.map((b) => b.title)
      expect(titles).to.have.members(['allowed note', 'brand new'])
      expect(JSON.stringify(call.args[2])).to.not.include('forbidden secret note')
      // stored data is never pruned
      expect(user.bookmarks.map((b) => b.title)).to.include('forbidden secret note')
    })
  })
})
