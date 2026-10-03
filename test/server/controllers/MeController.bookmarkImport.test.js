const { expect } = require('chai')
const sinon = require('sinon')
const Database = require('../../../server/Database')
const Logger = require('../../../server/Logger')
const SocketAuthority = require('../../../server/SocketAuthority')
const MeController = require('../../../server/controllers/MeController')

const clone = (value) => JSON.parse(JSON.stringify(value))

function makeRes() {
  const res = { statusCode: 200, body: undefined, sent: false }
  res.status = (code) => {
    res.statusCode = code
    return res
  }
  res.json = (body) => {
    res.body = body
    res.sent = true
    return res
  }
  res.send = (body) => {
    res.body = body
    res.sent = true
    return res
  }
  res.sendStatus = (code) => {
    res.statusCode = code
    res.sent = true
    return res
  }
  return res
}

/**
 * Fake user that behaves like a persisted model: `persisted` is what's "in the database".
 * save() copies bookmarks into persisted (or throws if failSave is set); reload() restores from it.
 */
function makeUser(bookmarks, { canAccess = true, failSave = false } = {}) {
  const user = {
    username: 'tester',
    bookmarks,
    persisted: clone(bookmarks),
    changed: sinon.spy(),
    checkCanAccessLibraryItem: sinon.stub().returns(canAccess),
    save: sinon.spy(async function () {
      if (failSave) throw new Error('disk full')
      user.persisted = clone(user.bookmarks)
    }),
    reload: sinon.spy(async function () {
      user.bookmarks = clone(user.persisted)
    })
  }
  return user
}

function fileOf(bookmarks, overrides = {}) {
  return { absBookmarksVersion: 1, libraryItemId: 'li_1', bookTitle: 'Book', exportedAt: 1, bookmarks, ...overrides }
}

function baseBookmarks() {
  return [
    { libraryItemId: 'li_1', time: 10, title: 'A', createdAt: 1 },
    { libraryItemId: 'li_1', time: 20, title: 'B', createdAt: 2 },
    { libraryItemId: 'li_1', time: 99, title: 'Not in file', createdAt: 3 },
    { libraryItemId: 'li_2', time: 10, title: 'Other book', createdAt: 4 }
  ]
}

describe('MeController bookmark import', () => {
  let getExpandedById
  let originalDescriptor
  let emitStub
  const loggerStubs = []

  beforeEach(() => {
    getExpandedById = sinon.stub().resolves({ id: 'li_1', isPodcast: false })
    // libraryItemModel may be a prototype getter; shadow it with an own property for the test
    originalDescriptor = Object.getOwnPropertyDescriptor(Database, 'libraryItemModel')
    Object.defineProperty(Database, 'libraryItemModel', { value: { getExpandedById }, configurable: true, writable: true })
    emitStub = sinon.stub(SocketAuthority, 'clientEmitter')
    for (const method of ['debug', 'info', 'warn', 'error']) {
      if (typeof Logger[method] === 'function') loggerStubs.push(sinon.stub(Logger, method))
    }
  })

  afterEach(() => {
    if (originalDescriptor) Object.defineProperty(Database, 'libraryItemModel', originalDescriptor)
    else delete Database.libraryItemModel
    sinon.restore()
    loggerStubs.length = 0
  })

  function makeReq(user, body) {
    return { params: { libraryItemId: 'li_1' }, body, user }
  }

  describe('previewBookmarkImport', () => {
    it('returns hints, entries and counts', async () => {
      const user = makeUser(baseBookmarks())
      const res = makeRes()
      await MeController.previewBookmarkImport(
        makeReq(user, {
          file: fileOf([
            { time: 5, title: 'fresh', createdAt: 1 },
            { time: 10, title: 'A' },
            { time: 20, title: 'Changed' }
          ])
        }),
        res
      )
      expect(res.statusCode).to.equal(200)
      expect(res.body.hints).to.deep.equal({ libraryItemId: 'li_1', bookTitle: 'Book' })
      expect(res.body.counts).to.deep.equal({ total: 3, new: 1, identical: 1, conflict: 1, supersededInFile: 0 })
      expect(res.body.entries.map((e) => e.status)).to.deep.equal(['new', 'identical', 'conflict'])
    })

    it('writes nothing', async () => {
      const bookmarks = baseBookmarks()
      const snapshot = clone(bookmarks)
      const user = makeUser(bookmarks)
      const res = makeRes()
      await MeController.previewBookmarkImport(makeReq(user, { file: fileOf([{ time: 5, title: 'fresh' }, { time: 20, title: 'Changed' }]) }), res)
      expect(res.statusCode).to.equal(200)
      expect(user.bookmarks).to.equal(bookmarks)
      expect(user.bookmarks).to.deep.equal(snapshot)
      expect(user.save.called).to.be.false
      expect(user.changed.called).to.be.false
      expect(emitStub.called).to.be.false
    })

    it('ignores mode and any libraryItemId inside the file (hints only)', async () => {
      const user = makeUser(baseBookmarks())
      const res = makeRes()
      await MeController.previewBookmarkImport(makeReq(user, { mode: 'replace', file: fileOf([{ time: 10, title: 'A' }], { libraryItemId: 'li_2' }) }), res)
      expect(getExpandedById.calledOnceWithExactly('li_1')).to.be.true
      expect(res.body.entries[0].status).to.equal('identical') // diffed against li_1, not li_2
    })

    it('returns 404 when the library item does not exist', async () => {
      getExpandedById.resolves(null)
      const res = makeRes()
      await MeController.previewBookmarkImport(makeReq(makeUser([]), { file: fileOf([]) }), res)
      expect(res.statusCode).to.equal(404)
    })

    it('returns 403 when the user cannot access the item', async () => {
      const res = makeRes()
      await MeController.previewBookmarkImport(makeReq(makeUser([], { canAccess: false }), { file: fileOf([]) }), res)
      expect(res.statusCode).to.equal(403)
    })

    it('returns 400 for podcasts', async () => {
      getExpandedById.resolves({ id: 'li_1', isPodcast: true })
      const res = makeRes()
      await MeController.previewBookmarkImport(makeReq(makeUser([]), { file: fileOf([]) }), res)
      expect(res.statusCode).to.equal(400)
    })

    it('returns 400 with errors for an invalid file', async () => {
      const res = makeRes()
      await MeController.previewBookmarkImport(makeReq(makeUser([]), { file: fileOf([{ time: -1, title: '' }]) }), res)
      expect(res.statusCode).to.equal(400)
      expect(res.body.errors).to.be.an('array').that.is.not.empty
    })

    it('returns 400 when the file is missing or the wrong version', async () => {
      for (const body of [{}, { file: fileOf([], { absBookmarksVersion: 2 }) }]) {
        const res = makeRes()
        await MeController.previewBookmarkImport(makeReq(makeUser([]), body), res)
        expect(res.statusCode).to.equal(400)
      }
    })
  })
})