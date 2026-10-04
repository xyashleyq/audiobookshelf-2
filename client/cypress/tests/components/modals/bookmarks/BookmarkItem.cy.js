import BookmarkItem from '@/components/modals/bookmarks/BookmarkItem.vue'

describe('BookmarkItem', () => {
  const bookmark = { libraryItemId: 'li_1', time: 125, title: 'Rocky first message', createdAt: 1727960521000 }

  const mocks = {
    $secondsToTimestamp: (seconds) => `ts:${seconds}`,
    $strings: { ToastFailedToUpdate: 'Failed to update' }
  }

  it('renders the note and timestamp', () => {
    cy.mount(BookmarkItem, { propsData: { bookmark, playbackRate: 1 }, mocks })
    cy.get('p').contains('Rocky first message').should('exist')
    cy.get('p').contains('ts:125').should('exist')
  })

  it('shows edit and delete actions by default', () => {
    cy.mount(BookmarkItem, { propsData: { bookmark, playbackRate: 1 }, mocks })
    cy.get('span.material-symbols').contains('edit').should('exist')
    cy.get('span.material-symbols').contains('delete').should('exist')
  })

  it('emits delete when the delete action is clicked', () => {
    const onDelete = cy.spy().as('onDelete')
    cy.mount(BookmarkItem, { propsData: { bookmark, playbackRate: 1 }, listeners: { delete: onDelete }, mocks })
    cy.get('span.material-symbols').contains('delete').click({ force: true })
    cy.get('@onDelete').should('have.been.calledOnceWith', bookmark)
  })

  it('hides edit and delete actions when readOnly', () => {
    cy.mount(BookmarkItem, { propsData: { bookmark, playbackRate: 1, readOnly: true }, mocks })
    cy.get('span.material-symbols').should('not.exist')
    cy.get('form').should('not.exist')
  })

  it('renders bookTitle when set', () => {
    cy.mount(BookmarkItem, { propsData: { bookmark, playbackRate: 1, bookTitle: 'Project Hail Mary' }, mocks })
    cy.get('[data-testid="bookmark-book-title"]').should('have.text', 'Project Hail Mary')
  })

  it('does not render bookTitle when not set', () => {
    cy.mount(BookmarkItem, { propsData: { bookmark, playbackRate: 1 }, mocks })
    cy.get('[data-testid="bookmark-book-title"]').should('not.exist')
  })
})
