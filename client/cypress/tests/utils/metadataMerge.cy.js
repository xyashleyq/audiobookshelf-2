import { merge, FIELD_CONFIG, MERGE_LOGICS, TARGET_METADATA, TARGET_ROOT } from '@/utils/metadataMerge'

describe('metadataMerge', () => {
  describe('config', () => {
    it('covers exactly the 7 fields in scope', () => {
      expect(Object.keys(FIELD_CONFIG)).to.have.members(['title', 'subtitle', 'description', 'publisher', 'language', 'genres', 'tags'])
    })

    it('defaults every field to replace', () => {
      for (const field in FIELD_CONFIG) {
        expect(FIELD_CONFIG[field].default, field).to.equal('replace')
      }
    })

    it('allows replace and fillEmpty for text, replace and appendUnique for lists', () => {
      for (const field of ['title', 'subtitle', 'description', 'publisher', 'language']) {
        expect(FIELD_CONFIG[field].allowed, field).to.have.members(['replace', 'fillEmpty'])
      }
      for (const field of ['genres', 'tags']) {
        expect(FIELD_CONFIG[field].allowed, field).to.have.members(['replace', 'appendUnique'])
      }
    })

    it('sends tags to the payload root and everything else to metadata', () => {
      expect(FIELD_CONFIG.tags.target).to.equal(TARGET_ROOT)
      for (const field of ['title', 'subtitle', 'description', 'publisher', 'language', 'genres']) {
        expect(FIELD_CONFIG[field].target, field).to.equal(TARGET_METADATA)
      }
    })

    it('has a function for every allowed merge logic', () => {
      for (const field in FIELD_CONFIG) {
        FIELD_CONFIG[field].allowed.forEach((logic) => expect(MERGE_LOGICS[logic], logic).to.be.a('function'))
      }
    })
  })

  describe('replace (text)', () => {
    it('saves "  Penguin" as "Penguin"', () => {
      const r = merge({ publisher: 'Old House' }, { publisher: '  Penguin' }, { publisher: 'replace' })
      expect(r.publisher).to.deep.equal({ value: 'Penguin', action: 'replace', changed: true })
    })

    it('treats a case-only difference as changed', () => {
      const r = merge({ publisher: 'penguin' }, { publisher: 'Penguin' }, { publisher: 'replace' })
      expect(r.publisher).to.deep.equal({ value: 'Penguin', action: 'replace', changed: true })
    })

    it('is unchanged when the trimmed new value equals the existing value exactly', () => {
      const r = merge({ publisher: 'Penguin' }, { publisher: ' Penguin ' }, { publisher: 'replace' })
      expect(r.publisher).to.deep.equal({ value: 'Penguin', action: 'replace', changed: false })
    })

    it('keeps the original when the new value is whitespace only', () => {
      const r = merge({ title: 'Mine' }, { title: '   ' }, { title: 'replace' })
      expect(r.title).to.deep.equal({ value: 'Mine', action: 'replace', changed: false })
    })

    it('keeps the original when the new value is missing or null', () => {
      expect(merge({ title: 'Mine' }, {}, { title: 'replace' }).title).to.deep.equal({ value: 'Mine', action: 'replace', changed: false })
      expect(merge({ title: 'Mine' }, { title: null }, { title: 'replace' }).title).to.deep.equal({ value: 'Mine', action: 'replace', changed: false })
    })

    it('fills an empty existing value', () => {
      const r = merge({ subtitle: null }, { subtitle: 'Book One' }, { subtitle: 'replace' })
      expect(r.subtitle).to.deep.equal({ value: 'Book One', action: 'replace', changed: true })
    })
  })

  describe('fillEmpty', () => {
    it('fills when the existing value is null, missing, empty or whitespace only', () => {
      expect(merge({ subtitle: null }, { subtitle: ' New ' }, { subtitle: 'fillEmpty' }).subtitle).to.deep.equal({ value: 'New', action: 'fillEmpty', changed: true })
      expect(merge({}, { subtitle: 'New' }, { subtitle: 'fillEmpty' }).subtitle).to.deep.equal({ value: 'New', action: 'fillEmpty', changed: true })
      expect(merge({ subtitle: '' }, { subtitle: 'New' }, { subtitle: 'fillEmpty' }).subtitle).to.deep.equal({ value: 'New', action: 'fillEmpty', changed: true })
      expect(merge({ subtitle: '   ' }, { subtitle: 'New' }, { subtitle: 'fillEmpty' }).subtitle).to.deep.equal({ value: 'New', action: 'fillEmpty', changed: true })
    })

    it('keeps a non-empty existing value', () => {
      const r = merge({ language: 'English' }, { language: 'German' }, { language: 'fillEmpty' })
      expect(r.language).to.deep.equal({ value: 'English', action: 'fillEmpty', changed: false })
    })

    it('keeps a non-empty existing value even if it only differs in case', () => {
      const r = merge({ language: 'english' }, { language: 'English' }, { language: 'fillEmpty' })
      expect(r.language).to.deep.equal({ value: 'english', action: 'fillEmpty', changed: false })
    })

    it('keeps the original when the new value is missing or whitespace only', () => {
      expect(merge({ subtitle: null }, {}, { subtitle: 'fillEmpty' }).subtitle).to.deep.equal({ value: null, action: 'fillEmpty', changed: false })
      expect(merge({ subtitle: '  ' }, { subtitle: ' ' }, { subtitle: 'fillEmpty' }).subtitle).to.deep.equal({ value: '  ', action: 'fillEmpty', changed: false })
    })
  })

  describe('appendUnique', () => {
    it('adds new items and ignores duplicate, empty and case-different items', () => {
      const r = merge({ genres: ['Fantasy', 'Sci-Fi'] }, { genres: ['sci-fi', ' Horror ', '', 'horror', 'Fantasy ', '  '] }, { genres: 'appendUnique' })
      expect(r.genres).to.deep.equal({ value: ['Fantasy', 'Sci-Fi', 'Horror'], action: 'appendUnique', changed: true })
    })

    it('is unchanged when every new item is already present', () => {
      const r = merge({ tags: ['a', 'B'] }, { tags: ['A', ' b', ''] }, { tags: 'appendUnique' })
      expect(r.tags).to.deep.equal({ value: ['a', 'B'], action: 'appendUnique', changed: false })
    })

    it('does not change existing items', () => {
      const r = merge({ tags: ['  Mystery', 'x'] }, { tags: ['mystery', 'New'] }, { tags: 'appendUnique' })
      expect(r.tags).to.deep.equal({ value: ['  Mystery', 'x', 'New'], action: 'appendUnique', changed: true })
    })

    it('works when the existing list is null, missing or empty', () => {
      expect(merge({ tags: null }, { tags: ['A'] }, { tags: 'appendUnique' }).tags).to.deep.equal({ value: ['A'], action: 'appendUnique', changed: true })
      expect(merge({}, { tags: ['A'] }, { tags: 'appendUnique' }).tags).to.deep.equal({ value: ['A'], action: 'appendUnique', changed: true })
      expect(merge({ tags: [] }, { tags: ['A'] }, { tags: 'appendUnique' }).tags).to.deep.equal({ value: ['A'], action: 'appendUnique', changed: true })
    })

    it('keeps the original when the new list is missing or has only empty items', () => {
      expect(merge({ tags: ['A'] }, {}, { tags: 'appendUnique' }).tags).to.deep.equal({ value: ['A'], action: 'appendUnique', changed: false })
      expect(merge({ tags: ['A'] }, { tags: ['', ' '] }, { tags: 'appendUnique' }).tags).to.deep.equal({ value: ['A'], action: 'appendUnique', changed: false })
    })
  })

  describe('replace (list)', () => {
    it('trims items and drops empty ones', () => {
      const r = merge({ genres: ['Old'] }, { genres: [' a', '', 'b ', '  '] }, { genres: 'replace' })
      expect(r.genres).to.deep.equal({ value: ['a', 'b'], action: 'replace', changed: true })
    })

    it('does not drop duplicates', () => {
      const r = merge({ genres: [] }, { genres: ['a', 'A', 'a'] }, { genres: 'replace' })
      expect(r.genres).to.deep.equal({ value: ['a', 'A', 'a'], action: 'replace', changed: true })
    })

    it('treats a case-only difference as changed', () => {
      const r = merge({ genres: ['Sci-Fi'] }, { genres: ['sci-fi'] }, { genres: 'replace' })
      expect(r.genres).to.deep.equal({ value: ['sci-fi'], action: 'replace', changed: true })
    })

    it('treats an order-only difference as changed', () => {
      const r = merge({ tags: ['A', 'B'] }, { tags: ['B', 'A'] }, { tags: 'replace' })
      expect(r.tags).to.deep.equal({ value: ['B', 'A'], action: 'replace', changed: true })
    })

    it('is unchanged when the normalized list equals the existing list exactly', () => {
      const r = merge({ tags: ['A', 'B'] }, { tags: [' A', 'B ', ''] }, { tags: 'replace' })
      expect(r.tags).to.deep.equal({ value: ['A', 'B'], action: 'replace', changed: false })
    })

    it('keeps the original when the new list is missing or has only empty items', () => {
      expect(merge({ tags: ['A'] }, {}, { tags: 'replace' }).tags).to.deep.equal({ value: ['A'], action: 'replace', changed: false })
      expect(merge({ tags: ['A'] }, { tags: ['', '  '] }, { tags: 'replace' }).tags).to.deep.equal({ value: ['A'], action: 'replace', changed: false })
    })
  })

  describe('merge logic not allowed for the field', () => {
    it('uses the default (replace) for fillEmpty on a list', () => {
      const r = merge({ genres: ['Old'] }, { genres: ['New'] }, { genres: 'fillEmpty' })
      expect(r.genres).to.deep.equal({ value: ['New'], action: 'replace', changed: true })
    })

    it('uses the default (replace) for appendUnique on text', () => {
      const r = merge({ title: 'Old' }, { title: 'New' }, { title: 'appendUnique' })
      expect(r.title).to.deep.equal({ value: 'New', action: 'replace', changed: true })
    })

    it('uses the default (replace) for an unknown or missing logic name', () => {
      expect(merge({ title: 'Old' }, { title: 'New' }, { title: 'bogus' }).title.action).to.equal('replace')
      expect(merge({ title: 'Old' }, { title: 'New' }, { title: undefined }).title.action).to.equal('replace')
    })
  })

  describe('merge()', () => {
    it('returns results only for checked fields in the config', () => {
      const r = merge({ title: 'a', subtitle: 'b' }, { title: 'A', subtitle: 'B', author: 'X' }, { title: 'replace', author: 'replace' })
      expect(Object.keys(r)).to.deep.equal(['title'])
    })

    it('handles several fields with different logics in one call', () => {
      const r = merge({ title: 'Mine', subtitle: '', genres: ['Fantasy'], tags: ['x'] }, { title: 'Theirs', subtitle: ' Sub ', genres: ['fantasy', 'Epic'], tags: ['y'] }, { title: 'fillEmpty', subtitle: 'fillEmpty', genres: 'appendUnique', tags: 'replace' })
      expect(r).to.deep.equal({
        title: { value: 'Mine', action: 'fillEmpty', changed: false },
        subtitle: { value: 'Sub', action: 'fillEmpty', changed: true },
        genres: { value: ['Fantasy', 'Epic'], action: 'appendUnique', changed: true },
        tags: { value: ['y'], action: 'replace', changed: true }
      })
    })

    it('does not modify its inputs', () => {
      const existing = { title: '  x ', genres: ['A'], tags: [' t'] }
      const incoming = { title: ' New ', genres: [' b', ''], tags: ['T', 'u'] }
      const modes = { title: 'replace', genres: 'appendUnique', tags: 'appendUnique' }
      const before = JSON.stringify([existing, incoming, modes])
      const r = merge(existing, incoming, modes)
      expect(JSON.stringify([existing, incoming, modes])).to.equal(before)
      expect(r.genres.value).to.not.equal(existing.genres)
    })

    it('returns an empty object when nothing is checked', () => {
      expect(merge({ title: 'a' }, { title: 'b' }, {})).to.deep.equal({})
      expect(merge({ title: 'a' }, { title: 'b' }, null)).to.deep.equal({})
    })
  })
})
