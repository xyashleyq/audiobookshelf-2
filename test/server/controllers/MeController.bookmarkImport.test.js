const { expect } = require('chai')
const sinon = require('sinon')
const Database = require('../../../server/Database')
const Logger = require('../../../server/Logger')
const bookmarkQueries = require('../../../server/utils/queries/bookmarkQueries')
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
    id: 'user_1',
    bookmarks,
    persisted: clone(bookmarks),
    changed: sinon.spy(),
    toOldJSONForBrowser: sinon.stub().returns({ id: 'user_1' }),
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
    sinon.stub(bookmarkQueries, 'toOldJSONForBrowserForSelf').resolves({ id: 'user_1' })
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

  describe('access rule is shared by every bookmark endpoint', () => {
    const calls = () => [
      ['getBookmarksForLibraryItem', { libraryItemId: 'li_1' }, {}],
      ['createBookmark', { id: 'li_1' }, { time: 1, title: 'x' }],
      ['updateBookmark', { id: 'li_1' }, { time: 1, title: 'x' }],
      ['removeBookmark', { id: 'li_1', time: '1' }, {}],
      ['previewBookmarkImport', { libraryItemId: 'li_1' }, { file: fileOf([]) }],
      ['importBookmarks', { libraryItemId: 'li_1' }, { file: fileOf([]), mode: 'keep' }]
    ]

    it('all return 404 for a missing item', async () => {
      getExpandedById.resolves(null)
      for (const [name, params, body] of calls()) {
        const res = makeRes()
        await MeController[name]({ params, body, user: makeUser([]) }, res)
        expect(res.statusCode, name).to.equal(404)
      }
    })

    it('all return 403 without access', async () => {
      for (const [name, params, body] of calls()) {
        const res = makeRes()
        await MeController[name]({ params, body, user: makeUser([], { canAccess: false }) }, res)
        expect(res.statusCode, name).to.equal(403)
      }
    })
  })

  describe('importBookmarks', () => {
    const importFile = () => fileOf([{ time: 5, title: 'fresh', createdAt: 50 }, { time: 10, title: 'A' }, { time: 20, title: 'Changed' }])

    async function runImport(user, body) {
      const res = makeRes()
      await MeController.importBookmarks(makeReq(user, body), res)
      return res
    }

    it('keep: adds new entries, leaves conflicts, saves once and emits user_updated', async () => {
      const user = makeUser(baseBookmarks())
      const res = await runImport(user, { file: importFile(), mode: 'keep' })
      expect(res.statusCode).to.equal(200)
      expect(res.body.summary).to.deep.include({ added: 1, replaced: 0, keptExisting: 1, identical: 1, changed: true })
      expect(user.bookmarks.find((b) => b.libraryItemId === 'li_1' && b.time === 20).title).to.equal('B')
      expect(user.save.calledOnce).to.be.true
      expect(emitStub.calledOnce).to.be.true
      expect(res.body.bookmarks.every((b) => b.libraryItemId === 'li_1')).to.be.true
    })

    it('replace: overwrites only the flagged conflicts', async () => {
      const user = makeUser(baseBookmarks())
      const res = await runImport(user, { file: importFile(), mode: 'replace' })
      expect(res.body.summary).to.deep.include({ added: 1, replaced: 1, keptExisting: 0 })
      expect(user.bookmarks.find((b) => b.libraryItemId === 'li_1' && b.time === 20).title).to.equal('Changed')
      expect(user.bookmarks.find((b) => b.time === 99).title).to.equal('Not in file')
    })

    it("does not touch other books' bookmarks", async () => {
      const original = baseBookmarks()
      const otherBook = original[3]
      const user = makeUser(original)
      await runImport(user, { file: fileOf([{ time: 10, title: 'Overwrite attempt' }]), mode: 'replace' })
      expect(user.bookmarks).to.include(otherBook)
      expect(otherBook.title).to.equal('Other book')
    })

    it('imports into the URL book even if the file claims another book', async () => {
      const user = makeUser([])
      await runImport(user, { file: fileOf([{ time: 1, title: 'x' }], { libraryItemId: 'li_2' }), mode: 'keep' })
      expect(user.bookmarks[0].libraryItemId).to.equal('li_1')
    })

    it('skips the save and the emit when nothing changes', async () => {
      const user = makeUser(baseBookmarks())
      const res = await runImport(user, { file: fileOf([{ time: 10, title: 'A' }]), mode: 'replace' })
      expect(res.statusCode).to.equal(200)
      expect(res.body.summary.changed).to.be.false
      expect(user.save.called).to.be.false
      expect(emitStub.called).to.be.false
    })

    it('preview and import agree on the same input', async () => {
      const file = fileOf([
        { time: 5, title: 'fresh' },
        { time: 5, title: 'fresh, later' },
        { time: 10, title: 'A' },
        { time: 20, title: 'Changed' }
      ])
      const previewRes = makeRes()
      await MeController.previewBookmarkImport(makeReq(makeUser(baseBookmarks()), { file }), previewRes)
      const { counts, entries } = previewRes.body

      for (const mode of ['keep', 'replace']) {
        const user = makeUser(baseBookmarks())
        const res = await runImport(user, { file, mode })
        expect(res.body.summary.added, mode).to.equal(counts.new)
        expect(res.body.summary.identical, mode).to.equal(counts.identical)
        expect(res.body.summary.supersededInFile, mode).to.equal(counts.supersededInFile)
        expect(res.body.summary.replaced, mode).to.equal(mode === 'replace' ? counts.conflict : 0)
        expect(res.body.summary.keptExisting, mode).to.equal(mode === 'keep' ? counts.conflict : 0)

        for (const e of entries) {
          const stored = user.bookmarks.find((b) => b.libraryItemId === 'li_1' && b.time === e.time)
          const expectedTitle = e.status === 'conflict' && mode === 'keep' ? e.existingTitle : e.title
          expect(stored.title, `${mode} @${e.time}`).to.equal(expectedTitle)
        }
      }
    })

    it('rejects bad input without writing anything', async () => {
      const badBodies = [
        { file: fileOf([{ time: 1, title: '' }]), mode: 'keep' }, // empty title
        { file: fileOf([{ time: NaN, title: 'x' }]), mode: 'keep' }, // non-finite time (null after JSON, still invalid)
        { file: fileOf([{ time: Infinity, title: 'x' }]), mode: 'keep' },
        { file: fileOf([{ time: 1, title: 'x' }], { absBookmarksVersion: 2 }), mode: 'keep' }, // wrong version
        { file: fileOf([{ time: 1, title: 'x' }]) }, // missing mode
        { file: fileOf([{ time: 1, title: 'x' }]), mode: 'merge' }, // bad mode
        { mode: 'keep' } // missing file
      ]
      for (const body of badBodies) {
        const bookmarks = baseBookmarks()
        const user = makeUser(bookmarks)
        const res = await runImport(user, body)
        expect(res.statusCode, JSON.stringify(body).slice(0, 60)).to.equal(400)
        expect(user.bookmarks).to.equal(bookmarks)
        expect(user.save.called).to.be.false
        expect(user.changed.called).to.be.false
        expect(emitStub.called).to.be.false
      }
    })

    it('on save failure: reloads, leaves no half-applied state, returns 500 and does not emit', async () => {
      const bookmarks = baseBookmarks()
      const snapshot = clone(bookmarks)
      const user = makeUser(bookmarks, { failSave: true })
      const res = await runImport(user, { file: importFile(), mode: 'replace' })
      expect(res.statusCode).to.equal(500)
      expect(user.reload.calledOnce).to.be.true
      expect(user.bookmarks).to.deep.equal(snapshot)
      expect(emitStub.called).to.be.false
    })

    it('on save failure with a failing reload: restores the previous bookmarks', async () => {
      const bookmarks = baseBookmarks()
      const user = makeUser(bookmarks, { failSave: true })
      user.reload = sinon.stub().rejects(new Error('db gone'))
      const res = await runImport(user, { file: importFile(), mode: 'keep' })
      expect(res.statusCode).to.equal(500)
      expect(user.bookmarks).to.equal(bookmarks)
    })

    it('returns 404 / 403 / 400 before touching anything', async () => {
      getExpandedById.resolves(null)
      let user = makeUser(baseBookmarks())
      expect((await runImport(user, { file: importFile(), mode: 'keep' })).statusCode).to.equal(404)

      getExpandedById.resolves({ id: 'li_1', isPodcast: false })
      user = makeUser(baseBookmarks(), { canAccess: false })
      expect((await runImport(user, { file: importFile(), mode: 'keep' })).statusCode).to.equal(403)
      expect(user.save.called).to.be.false

      getExpandedById.resolves({ id: 'li_1', isPodcast: true })
      user = makeUser(baseBookmarks())
      expect((await runImport(user, { file: importFile(), mode: 'keep' })).statusCode).to.equal(400)
      expect(user.save.called).to.be.false
    })
  })
})