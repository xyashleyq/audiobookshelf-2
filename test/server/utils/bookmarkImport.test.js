const { expect } = require('chai')
const sinon = require('sinon')
const { parseBookmarkFile, diffBookmarks, applyBookmarkImport, SUPPORTED_VERSION } = require('../../../server/utils/bookmarkImport')

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

describe('bookmarkImport.applyBookmarkImport', () => {
  function makeUser(bookmarks) {
    return { bookmarks, changed: sinon.spy() }
  }
  const entry = (time, title, createdAt = null) => ({ time, title, createdAt })

  function baseBookmarks() {
    return [
      { libraryItemId: 'li_1', time: 10, title: 'A', createdAt: 1 },
      { libraryItemId: 'li_1', time: 20, title: 'B', createdAt: 2 },
      { libraryItemId: 'li_1', time: 99, title: 'Not in file', createdAt: 3 },
      { libraryItemId: 'li_2', time: 10, title: 'Other book', createdAt: 4 }
    ]
  }

  it('keep: adds only new entries and leaves conflicts alone', () => {
    const user = makeUser(baseBookmarks())
    const summary = applyBookmarkImport(user, 'li_1', [entry(5, 'new', 50), entry(20, 'Changed'), entry(10, 'A')], 'keep', 1000)
    expect(summary).to.deep.include({ added: 1, replaced: 0, keptExisting: 1, identical: 1, changed: true })
    expect(user.bookmarks.find((b) => b.libraryItemId === 'li_1' && b.time === 20).title).to.equal('B')
    expect(user.bookmarks.find((b) => b.time === 5)).to.deep.equal({ libraryItemId: 'li_1', time: 5, title: 'new', createdAt: 50 })
    expect(user.bookmarks).to.have.lengthOf(5)
    expect(user.changed.calledOnceWithExactly('bookmarks', true)).to.be.true
  })

  it('replace: overwrites only flagged conflicts, preserving their createdAt', () => {
    const user = makeUser(baseBookmarks())
    const summary = applyBookmarkImport(user, 'li_1', [entry(20, 'Changed'), entry(10, 'A')], 'replace')
    expect(summary).to.deep.include({ added: 0, replaced: 1, keptExisting: 0, identical: 1, changed: true })
    const replaced = user.bookmarks.find((b) => b.libraryItemId === 'li_1' && b.time === 20)
    expect(replaced).to.deep.equal({ libraryItemId: 'li_1', time: 20, title: 'Changed', createdAt: 2 })
  })

  it('replace: leaves bookmarks the file does not mention untouched (same object)', () => {
    const original = baseBookmarks()
    const unmentioned = original[2]
    const user = makeUser(original)
    applyBookmarkImport(user, 'li_1', [entry(20, 'Changed')], 'replace')
    expect(user.bookmarks).to.include(unmentioned)
  })

  it("never changes another book's bookmarks, even at the same time", () => {
    const original = baseBookmarks()
    const otherBook = original[3]
    const user = makeUser(original)
    applyBookmarkImport(user, 'li_1', [entry(10, 'Overwrite attempt')], 'replace')
    expect(user.bookmarks).to.include(otherBook)
    expect(otherBook.title).to.equal('Other book')
  })

  it('uses the libraryItemId argument for new entries, not anything from the file', () => {
    const user = makeUser([])
    applyBookmarkImport(user, 'li_9', [{ ...entry(1, 'x'), libraryItemId: 'li_evil' }], 'keep')
    expect(user.bookmarks[0].libraryItemId).to.equal('li_9')
  })

  it('uses now for entries without createdAt', () => {
    const user = makeUser([])
    applyBookmarkImport(user, 'li_1', [entry(1, 'x', null)], 'keep', 777)
    expect(user.bookmarks[0].createdAt).to.equal(777)
  })

  it('builds a new array and does not mutate the previous one or its objects', () => {
    const original = baseBookmarks()
    const snapshot = JSON.parse(JSON.stringify(original))
    const user = makeUser(original)
    applyBookmarkImport(user, 'li_1', [entry(20, 'Changed'), entry(5, 'new')], 'replace')
    expect(user.bookmarks).to.not.equal(original)
    expect(original).to.deep.equal(snapshot)
  })

  it('does not touch the user when nothing would change', () => {
    const original = baseBookmarks()
    const user = makeUser(original)
    const summary = applyBookmarkImport(user, 'li_1', [entry(10, 'A'), entry(20, 'B')], 'replace')
    expect(summary.changed).to.be.false
    expect(user.bookmarks).to.equal(original)
    expect(user.changed.called).to.be.false
  })

  it('keep with only conflicts changes nothing', () => {
    const user = makeUser(baseBookmarks())
    const summary = applyBookmarkImport(user, 'li_1', [entry(20, 'Changed')], 'keep')
    expect(summary).to.deep.include({ changed: false, keptExisting: 1 })
    expect(user.changed.called).to.be.false
  })

  it('handles a user with null bookmarks', () => {
    const user = makeUser(null)
    applyBookmarkImport(user, 'li_1', [entry(1, 'x')], 'keep')
    expect(user.bookmarks).to.have.lengthOf(1)
  })

  it('last duplicate in the file wins', () => {
    const user = makeUser([])
    const summary = applyBookmarkImport(user, 'li_1', [entry(5, 'first'), entry(5, 'second')], 'keep')
    expect(summary).to.deep.include({ added: 1, supersededInFile: 1 })
    expect(user.bookmarks[0].title).to.equal('second')
  })

  it('throws on an invalid mode and writes nothing', () => {
    const original = baseBookmarks()
    const user = makeUser(original)
    expect(() => applyBookmarkImport(user, 'li_1', [entry(1, 'x')], 'merge')).to.throw('Invalid import mode')
    expect(user.bookmarks).to.equal(original)
    expect(user.changed.called).to.be.false
  })

  describe('round trip and idempotency', () => {
    const original = [
      { libraryItemId: 'li_1', time: 90.5, title: 'Listened at 1.5x', createdAt: 111 },
      { libraryItemId: 'li_1', time: 0, title: 'Start', createdAt: 222 }
    ]

    it('export shape -> JSON -> parse -> apply into an empty book reproduces the bookmarks exactly', () => {
      const exported = {
        absBookmarksVersion: 1,
        libraryItemId: 'li_1',
        bookTitle: 'B',
        exportedAt: 5,
        bookmarks: original.map(({ time, title, createdAt }) => ({ time, title, createdAt }))
      }
      const parsed = parseBookmarkFile(JSON.parse(JSON.stringify(exported)))
      expect(parsed.ok).to.be.true
      const user = makeUser([])
      applyBookmarkImport(user, 'li_1', parsed.entries, 'keep')
      expect(user.bookmarks).to.deep.equal(original)
    })

    it('importing the same file twice: second run is all identical and writes nothing', () => {
      const entries = original.map(({ time, title, createdAt }) => ({ time, title, createdAt }))
      const user = makeUser([])
      applyBookmarkImport(user, 'li_1', entries, 'replace')
      const afterFirst = user.bookmarks
      const second = applyBookmarkImport(user, 'li_1', entries, 'replace')
      expect(second).to.deep.include({ added: 0, replaced: 0, identical: 2, changed: false })
      expect(user.bookmarks).to.equal(afterFirst)
      expect(user.changed.calledOnce).to.be.true
    })
  })
})