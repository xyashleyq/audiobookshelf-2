# Team 2: AudioBookshelf-2

[A short README that says how to run the combined version and how to check it. For each student it gives the change, the results of the checks, what changed from the RFC, and what remains. Your fork is public, so you may identify yourselves by GitHub username.]

## How to Run AudioBookshelf:

[tbd]

## New Features added and how to check them:

### New Feature 1 - Search bookmarks:

1. Load a library, scan the library
2. Play an audiobook, add a bookmark and write some notes for that bookmark
3. Navigate to the "Bookmarks" page in the side panel
4. Search for a keyword you wrote in your notes. Results will be the relevant bookmarks.

### New Feature 2 - [export import]

### New Feature 3 - [merge]

## Infividual Components:

### 01 Ying Wong (github username: wqying): Search bookmarks across my audiobooks

- The changes:
  - New "Bookmarks" page in the sidebar that searches bookmark notes across every book, with a per-book filter, paging, and click-to-play at the bookmarked time.
  - New API endpoint for search, so all search related logic is run on the server, only one page of results will reach the client.
  - Bookmarks for inaccessible books are now filtered out on the server.
- The results of the checks:
  - Server tests in MeController.test.js cover search, access rules, paging, special characters and the user payloads.
  - Cypress component test for the read-only BookmarkItem for UI.
  - Manual test caught a bug where the Play button did nothing in the "Bookmarks" page, fixed with @click.stop by following how the existing Play logic does it.
- What changes from the RFC:
  - My original RFC didn't address the leaking GET /api/me/bookmarks, and left the login payload as a judgement call. During implementation, this is fixed, which means existing responses change for users who have lost access to a book.
- What remains:
  - Podcast bookmarks are still unsupported, because they need a migration. Other languages also still need translations of the new strings.

### 02

### 03
