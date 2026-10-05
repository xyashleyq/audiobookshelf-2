const { expect } = require('chai')
const { timeKey, isSameBookmark, findBookmark, classify } = require('../../../server/utils/bookmarkUtils')

describe('bookmarkUtils', () => {
  describe('timeKey', () => {
    it('normalizes numbers and numeric strings', () => {
      expect(timeKey(12)).to.equal(12)
      expect(timeKey('12')).to.equal(12)
      expect(timeKey('12.5')).to.equal(12.5)
    })
    it('returns null for unusable values', () => {
      for (const v of [null, undefined, '', 'abc', NaN, Infinity]) expect(timeKey(v), String(v)).to.equal(null)
    })
  })

  describe('isSameBookmark / findBookmark', () => {
    const bms = [
      { libraryItemId: 'a', time: 10, title: 'x' },
      { libraryItemId: 'a', time: '20', title: 'y' },
      { libraryItemId: 'b', time: 10, title: 'z' }
    ]
    it('matches on book and numeric time', () => {
      expect(isSameBookmark(bms[0], 'a', 10)).to.be.true
      expect(isSameBookmark(bms[0], 'a', '10')).to.be.true
      expect(isSameBookmark(bms[0], 'b', 10)).to.be.false
      expect(isSameBookmark(bms[0], 'a', 11)).to.be.false
    })
    it('never matches a missing time', () => {
      expect(isSameBookmark({ libraryItemId: 'a', time: null }, 'a', 0)).to.be.false
      expect(isSameBookmark(bms[0], 'a', null)).to.be.false
    })
    it('treats a stored string time the same as a number', () => {
      expect(findBookmark(bms, 'a', 20)).to.equal(bms[1])
    })
    it('returns null when nothing matches or the list is missing', () => {
      expect(findBookmark(bms, 'a', 99)).to.equal(null)
      expect(findBookmark(null, 'a', 1)).to.equal(null)
    })
  })

  describe('classify', () => {
    it('classifies new, identical and conflict', () => {
      expect(classify(null, 'x')).to.equal('new')
      expect(classify({ title: 'x' }, 'x')).to.equal('identical')
      expect(classify({ title: 'x' }, 'X')).to.equal('conflict')
    })
  })
})