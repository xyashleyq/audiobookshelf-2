const { expect } = require('chai')
const { parseBookmarkFile, SUPPORTED_VERSION } = require('../../../server/utils/bookmarkImport')

function validFile(overrides = {}) {
  return {
    absBookmarksVersion: 1,
    libraryItemId: 'li_1',
    bookTitle: 'Some Book',
    exportedAt: 1700000000000,
    bookmarks: [
      { time: 120, title: 'Chapter 2', createdAt: 1700000000000 },
      { time: 0, title: 'Start', createdAt: 1700000001000 }
    ],
    ...overrides
  }
}

describe('bookmarkImport.parseBookmarkFile', () => {
  describe('valid input', () => {
    it('returns normalized entries and hints', () => {
      const result = parseBookmarkFile(validFile())
      expect(result.ok).to.be.true
      expect(result.errors).to.deep.equal([])
      expect(result.entries).to.deep.equal([
        { time: 120, title: 'Chapter 2', createdAt: 1700000000000 },
        { time: 0, title: 'Start', createdAt: 1700000001000 }
      ])
      expect(result.hints).to.deep.equal({ libraryItemId: 'li_1', bookTitle: 'Some Book' })
    })

    it('accepts an empty bookmarks array', () => {
      const result = parseBookmarkFile(validFile({ bookmarks: [] }))
      expect(result.ok).to.be.true
      expect(result.entries).to.deep.equal([])
    })

    it('accepts fractional times and preserves titles exactly (no trimming)', () => {
      const result = parseBookmarkFile(validFile({ bookmarks: [{ time: 12.5, title: '  padded  ' }] }))
      expect(result.ok).to.be.true
      expect(result.entries[0].time).to.equal(12.5)
      expect(result.entries[0].title).to.equal('  padded  ')
    })

    it('ignores unknown keys at top level and per entry', () => {
      const file = validFile({ futureField: { a: 1 }, bookmarks: [{ time: 5, title: 'x', createdAt: 1, color: 'red', libraryItemId: 'other' }] })
      const result = parseBookmarkFile(file)
      expect(result.ok).to.be.true
      expect(result.entries[0]).to.deep.equal({ time: 5, title: 'x', createdAt: 1 })
    })

    it('returns null hints values when libraryItemId/bookTitle are missing or not strings', () => {
      const file = validFile({ libraryItemId: 123, bookTitle: undefined })
      const result = parseBookmarkFile(file)
      expect(result.ok).to.be.true
      expect(result.hints).to.deep.equal({ libraryItemId: null, bookTitle: null })
    })

    it('does not reject or reuse invalid createdAt; it becomes null', () => {
      for (const createdAt of [undefined, null, 'yesterday', -5, NaN, Infinity]) {
        const result = parseBookmarkFile(validFile({ bookmarks: [{ time: 1, title: 'x', createdAt }] }))
        expect(result.ok, `createdAt=${String(createdAt)}`).to.be.true
        expect(result.entries[0].createdAt).to.equal(null)
      }
    })

    it('does not mutate or alias the input', () => {
      const file = validFile()
      const snapshot = JSON.parse(JSON.stringify(file))
      const result = parseBookmarkFile(file)
      expect(file).to.deep.equal(snapshot)
      result.entries[0].title = 'changed'
      expect(file.bookmarks[0].title).to.equal('Chapter 2')
    })
  })

  describe('invalid top-level input', () => {
    for (const [name, value] of [
      ['null', null],
      ['undefined', undefined],
      ['an array', []],
      ['a string', 'nope'],
      ['a number', 42]
    ]) {
      it(`rejects ${name}`, () => {
        const result = parseBookmarkFile(value)
        expect(result.ok).to.be.false
        expect(result.entries).to.deep.equal([])
        expect(result.errors).to.have.lengthOf(1)
      })
    }

    it('rejects a missing version', () => {
      const file = validFile()
      delete file.absBookmarksVersion
      const result = parseBookmarkFile(file)
      expect(result.ok).to.be.false
      expect(result.errors[0]).to.include('Missing')
    })

    it('rejects a wrong version (including "1" as a string)', () => {
      for (const version of [0, 2, '1', null, true]) {
        const result = parseBookmarkFile(validFile({ absBookmarksVersion: version }))
        expect(result.ok, `version=${String(version)}`).to.be.false
        expect(result.errors[0]).to.include('Unsupported')
        expect(result.errors[0]).to.include(String(SUPPORTED_VERSION))
      }
    })

    it('rejects when bookmarks is not an array', () => {
      for (const bookmarks of [undefined, null, {}, 'x', 5]) {
        const result = parseBookmarkFile(validFile({ bookmarks }))
        expect(result.ok).to.be.false
        expect(result.errors[0]).to.include('"bookmarks" must be an array')
      }
    })
  })

  describe('invalid entries', () => {
    it('rejects non-object entries', () => {
      const result = parseBookmarkFile(validFile({ bookmarks: [null, 'x', [], 5] }))
      expect(result.ok).to.be.false
      expect(result.errors).to.have.lengthOf(4)
      expect(result.errors[0]).to.include('bookmarks[0]')
    })

    it('rejects empty, whitespace-only and non-string titles', () => {
      for (const title of ['', '   ', '\n\t', null, undefined, 5, {}]) {
        const result = parseBookmarkFile(validFile({ bookmarks: [{ time: 1, title }] }))
        expect(result.ok, `title=${JSON.stringify(title)}`).to.be.false
        expect(result.errors[0]).to.include('bookmarks[0].title')
      }
    })

    it('rejects non-finite, negative, string and missing times', () => {
      for (const time of [NaN, Infinity, -Infinity, -1, '12', null, undefined, {}, true]) {
        const result = parseBookmarkFile(validFile({ bookmarks: [{ time, title: 'x' }] }))
        expect(result.ok, `time=${String(time)}`).to.be.false
        expect(result.errors[0]).to.include('bookmarks[0].time')
      }
    })

    it('rejects the whole file when a single entry is bad (all-or-nothing)', () => {
      const result = parseBookmarkFile(validFile({ bookmarks: [{ time: 1, title: 'good' }, { time: 2, title: '' }, { time: 3, title: 'also good' }] }))
      expect(result.ok).to.be.false
      expect(result.entries).to.deep.equal([])
      expect(result.hints).to.equal(null)
      expect(result.errors).to.have.lengthOf(1)
      expect(result.errors[0]).to.include('bookmarks[1].title')
    })

    it('reports every problem on an entry with its index', () => {
      const result = parseBookmarkFile(validFile({ bookmarks: [{ time: 'a', title: '' }] }))
      expect(result.errors).to.have.lengthOf(2)
    })

    it('caps reported errors', () => {
      const bookmarks = Array.from({ length: 100 }, () => ({ time: -1, title: '' }))
      const result = parseBookmarkFile(validFile({ bookmarks }))
      expect(result.ok).to.be.false
      expect(result.errors).to.have.lengthOf(21)
      expect(result.errors[20]).to.match(/and \d+ more errors/)
    })
  })
})