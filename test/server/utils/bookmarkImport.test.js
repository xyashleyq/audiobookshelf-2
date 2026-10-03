const { expect } = require('chai')
const { parseBookmarkFile, diffBookmarks, SUPPORTED_VERSION } = require('../../../server/utils/bookmarkImport')

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

describe('bookmarkImport.diffBookmarks', () => {
  const existing = [
    { libraryItemId: 'li_1', time: 10, title: 'A', createdAt: 1 },
    { libraryItemId: 'li_1', time: 20, title: 'B', createdAt: 2 }
  ]

  it('classifies new, identical and conflict', () => {
    const result = diffBookmarks(existing, [
      { time: 5, title: 'fresh', createdAt: null },
      { time: 10, title: 'A', createdAt: null },
      { time: 20, title: 'Different', createdAt: null }
    ])
    expect(result.entries.map((e) => e.status)).to.deep.equal(['new', 'identical', 'conflict'])
    expect(result.entries[2].existingTitle).to.equal('B')
    expect(result.entries[0].existingTitle).to.equal(null)
    expect(result.counts).to.deep.equal({ total: 3, new: 1, identical: 1, conflict: 1, supersededInFile: 0 })
  })

  it('treats everything as new when there are no existing bookmarks', () => {
    const result = diffBookmarks([], [{ time: 1, title: 'x', createdAt: null }])
    expect(result.counts.new).to.equal(1)
  })

  it('returns empty results for empty incoming', () => {
    const result = diffBookmarks(existing, [])
    expect(result.entries).to.deep.equal([])
    expect(result.counts.total).to.equal(0)
  })

  it('last entry wins when the file repeats a time, and the earlier one is flagged', () => {
    const result = diffBookmarks(existing, [
      { time: 30, title: 'first', createdAt: 1 },
      { time: 30, title: 'second', createdAt: 2 }
    ])
    expect(result.entries).to.have.lengthOf(1)
    expect(result.entries[0].title).to.equal('second')
    expect(result.supersededInFile).to.deep.equal([{ time: 30, title: 'first', createdAt: 1 }])
    expect(result.counts.supersededInFile).to.equal(1)
  })

  it('compares the winning duplicate (not the superseded one) against existing', () => {
    const result = diffBookmarks(existing, [
      { time: 10, title: 'Other', createdAt: null },
      { time: 10, title: 'A', createdAt: null }
    ])
    expect(result.entries[0].status).to.equal('identical')
  })

  it('compares titles exactly (case and whitespace sensitive)', () => {
    const result = diffBookmarks(existing, [{ time: 10, title: 'a', createdAt: null }])
    expect(result.entries[0].status).to.equal('conflict')
  })

  it('compares times numerically, so a stored string time still matches', () => {
    const result = diffBookmarks([{ time: '10', title: 'A' }], [{ time: 10, title: 'A', createdAt: null }])
    expect(result.entries[0].status).to.equal('identical')
  })

  it('does not mutate its inputs', () => {
    const incoming = [{ time: 10, title: 'Z', createdAt: null }]
    const existingSnapshot = JSON.parse(JSON.stringify(existing))
    const incomingSnapshot = JSON.parse(JSON.stringify(incoming))
    diffBookmarks(existing, incoming)
    expect(existing).to.deep.equal(existingSnapshot)
    expect(incoming).to.deep.equal(incomingSnapshot)
  })
})