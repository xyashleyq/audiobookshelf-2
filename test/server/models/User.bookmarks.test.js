const { expect } = require('chai')
const sinon = require('sinon')
const Logger = require('../../../server/Logger')
const User = require('../../../server/models/User')
const { applyBookmarkImport } = require('../../../server/utils/bookmarkImport')

function fakeUser(bookmarks) {
  return { bookmarks, changed: sinon.spy(), save: sinon.stub().resolves(), findBookmark: User.prototype.findBookmark }
}

describe('User bookmarks', () => {
  let clock
  beforeEach(() => {
    clock = sinon.useFakeTimers(5000)
    sinon.stub(Logger, 'warn')
  })
  afterEach(() => {
    clock.restore()
    sinon.restore()
  })

  const start = () => [
    { libraryItemId: 'a', time: 10, title: 'A', createdAt: 1 },
    { libraryItemId: 'b', time: 10, title: 'other book', createdAt: 2 }
  ]

  describe('matching', () => {
    it('findBookmark and removeBookmark agree on what "the same bookmark" is', async () => {
      const user = fakeUser([
        { libraryItemId: 'a', time: '12', title: 'string time' },
        { libraryItemId: 'a', time: 30, title: 'keep' }
      ])
      expect(user.findBookmark('a', 12)).to.not.equal(null)
      expect(await User.prototype.removeBookmark.call(user, 'a', 12)).to.be.true
      expect(user.bookmarks.map((b) => b.title)).to.deep.equal(['keep'])
    })

    it('removeBookmark returns false and saves nothing when not found', async () => {
      const user = fakeUser([{ libraryItemId: 'a', time: 1, title: 'x' }])
      expect(await User.prototype.removeBookmark.call(user, 'a', 2)).to.be.false
      expect(user.save.called).to.be.false
    })
  })

  describe('createBookmark keeps its existing behavior', () => {
    it('appends a new bookmark with createdAt = now and saves once', async () => {
      const user = fakeUser(start())
      const bm = await User.prototype.createBookmark.call(user, 'a', 20, 'New')
      expect(bm).to.deep.equal({ libraryItemId: 'a', time: 20, title: 'New', createdAt: 5000 })
      expect(user.bookmarks).to.have.lengthOf(3)
      expect(user.save.calledOnce).to.be.true
    })

    it('updates the title when one exists at that time, keeping createdAt', async () => {
      const user = fakeUser(start())
      const bm = await User.prototype.createBookmark.call(user, 'a', 10, 'Changed')
      expect(bm).to.deep.equal({ libraryItemId: 'a', time: 10, title: 'Changed', createdAt: 1 })
      expect(user.bookmarks).to.have.lengthOf(2)
      expect(user.save.calledOnce).to.be.true
    })

    it('does not save when the same title already exists', async () => {
      const user = fakeUser(start())
      const bm = await User.prototype.createBookmark.call(user, 'a', 10, 'A')
      expect(bm.title).to.equal('A')
      expect(user.save.called).to.be.false
    })

    it('never touches another book at the same time', async () => {
      const user = fakeUser(start())
      await User.prototype.createBookmark.call(user, 'a', 10, 'Changed')
      expect(user.bookmarks.find((b) => b.libraryItemId === 'b').title).to.equal('other book')
    })
  })

  describe('create and import agree', () => {
    const cases = [
      ['a new time', 20, 'New'],
      ['an existing time, different title', 10, 'Changed'],
      ['an existing time, same title', 10, 'A'],
      ['a numeric-string time', '10', 'Changed']
    ]
    for (const [name, time, title] of cases) {
      it(`gives the same stored result for ${name}`, async () => {
        const viaCreate = fakeUser(start())
        await User.prototype.createBookmark.call(viaCreate, 'a', time, title)

        const viaImport = fakeUser(start())
        applyBookmarkImport(viaImport, 'a', [{ time, title, createdAt: null }], 'replace')

        expect(viaCreate.bookmarks).to.deep.equal(viaImport.bookmarks)
        expect(viaCreate.save.called).to.equal(viaImport.changed.called)
      })
    }
  })
})