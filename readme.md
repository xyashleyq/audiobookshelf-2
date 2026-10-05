# Team 2: AudioBookshelf-2

[A short README that says how to run the combined version and how to check it. For each student it gives the change, the results of the checks, what changed from the RFC, and what remains. Your fork is public, so you may identify yourselves by GitHub username.]

## How to Run AudioBookshelf:

Needs **Node 20**. From the repo root:

```bash
npm ci
cd client && npm ci && npm run generate && cd ..
npm run build:server
PORT=13378 node dist-server/index.js
```

Open http://localhost:13378, create an admin account, then create a book library. Some functions and downloads need internet access.

### Running the tests

* Server tests: from the repository root, run `npm test` (Node 20). It compiles the server and runs the mocha tests in `dist-server/test`. All tests should pass.
* Client tests: run `cd client && npm test` (Node 20, requires Chrome). All specs should pass.

## New Features added and how to check them:

### New Feature 1 - Search bookmarks:

1. Load a library, scan the library
2. Play an audiobook, add a bookmark and write some notes for that bookmark
3. Navigate to the "Bookmarks" page in the side panel
4. Search for a keyword you wrote in your notes. Results will be the relevant bookmarks.

### New Feature 2 - [export import]

1. Load a library, scan the library.
2. Play an audiobook and add a few bookmarks. Change the playback speed to 1.5x for one of them.
3. Open the bookmarks modal in the player and click Export Bookmarks. A `bookmarks-<id>.json` file downloads.
4. Click **Import Bookmarks** and choose the same file. The preview shows "0 new, 3 identical, 0 conflicting" and the Import button is disabled.
5. Edit the file: change one title and add an entry with `"time": 500`. Import it. The preview shows 1 new, 2 identical and 1 conflicting, with the conflict shown as old `title → new title`.
6. Choose Keep existing titles and confirm. The new bookmark is added and the changed title is not applied. Import again with Replace titles of conflicting bookmarks. The title is now updated.
7. Open a different book and import the first book's file. A "different book" warning appears and the bookmarks land in the book you are in.
8. Import an invalid file, such as plain text or `{"absBookmarksVersion":2,"bookmarks":[]}`. Errors are shown and nothing is written.

### New Feature 3 - [merge]

1. Open a book that already has a publisher and genres, then go to the Match tab, search, and pick a result with a publisher and genres.
2. Under Publisher, tick “Only fill if empty”. Under Genres, tick “Add to existing”.
3. Check the “Result”:
  - Publisher shows your current value with “(no change)”.
  - Genres shows your current genres followed by the new ones, without duplicates.
4. Click Submit. The Details tab then shows the same values as the Result lines. Other checked fields still use Replace as before.

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

### 02 Elaine Ulsh (github username: ElaineUlsh): Export and import an audiobook's bookmarks

- The changes:
  - New `server/utils/bookmarkImport.js` with three separate functions: `parseBookmarkFile` (validates the versioned file), `diffBookmarks` (classifies each entry as new, identical or conflict) and `applyBookmarkImport` (the only one that touches the user).
  - Two new endpoints, `POST /api/me/item/:libraryItemId/bookmarks/import/preview` (writes nothing) and `POST /api/me/item/:libraryItemId/bookmarks/import`. Both run the same parse and diff code and the same access check as the existing per-book bookmark endpoint. The import saves once and returns a 500 on failure after reloading the user.
  - Bookmarks modal gets an Export button (downloads a versioned JSON file) and an import flow: file picker, server-computed preview, a single keep/replace choice, then confirm.
  - Existing bookmark create, update and remove code and `User.js` are untouched.
- The results of the checks:
  - 61 server tests in bookmarkImport.test.js and MeController.bookmarkImport.test.js cover:
    - parsing and validation (bad versions, empty titles, non-finite or string times, unknown keys)
    - diff classification and duplicate times within a file
    - keep vs replace, with other books and unmentioned bookmarks left untouched
    - a round trip that preserves fractional times
    - importing the same file twice (second run is all identical and writes nothing)
    - preview and import agreeing on the same input
    - the preview writing nothing
    - bad input rejected without writing
    - save failure, with and without a failing reload
    - 400, 403 and 404 handling
  - Manual testing in the dev container with two generated books covered everything under "How to check" above, plus bad files (missing version, negative time with empty title, string time, one good and one bad entry, empty list, duplicate times), cancel, re-picking the same file, persistence after a server restart, and create/rename/delete/jump on existing bookmarks.
  - Manual testing caught that the two routes had not been registered in `ApiRouter.js`, so the preview returned a 404. The controller tests missed it because they call the handlers directly. Fixed by registering the routes.
- What changed from the RFC:
  - The RFC had export reuse `GET /api/me/bookmarks/:libraryItemId`. Export now builds the file from the modal's existing `bookmarks` prop, filtered to the book, so it needs no extra request.
  - The RFC left some details open, which I settled as follows:
    - Validation is all-or-nothing, so one bad entry rejects the file.
    - The import request requires an explicit `mode`.
    - Replace keeps the existing bookmark's `createdAt`.
    - Duplicate times within a file are reported to the user as ignored.
    - Podcasts are rejected with a 400.
  - The RFC planned a preview UI test, but the client has no unit-test setup in my part, so the client flow was verified manually only.
- What remains:
  - No automated test covers the client flow or the route registration. A Cypress component test for the preview panel would be a natural addition.
  - New strings exist in `en-us.json` only, so other languages still need translations.
  - Conflict resolution is one choice for the whole import, not per bookmark. Podcast episode bookmarks are not supported.
  - The existing Vue client is no longer accepting frontend PRs upstream, so the client half would need porting to the React rewrite.

### 03 Ashley Qian (github username: xyashleyq): Choose how matched metadata combines with existing values

- The changes:
  - New merge module `client/utils/metadataMerge.js` with three merge logics: replace, fill if empty, add to existing.
  - Match tab: an "Only fill if empty" checkbox for title, subtitle, description, publisher and language, an "Add to existing" checkbox for genres and tags, and a result preview for each of these fields.
  - Unchanged fields are not sent, and if nothing changed, no request is sent.
- The results of the checks:
  - Unit tests: all 40 tests pass for the merge module.
  - Script check: across all checkbox combinations, the preview always matches what is sent.
  - Manual tests: the saved values match the preview, unchecked fields stay unchanged, Cancel does nothing, and a failed save shows an error.
- What changes from the RFC:
  - Case-insensitive comparison is only used to skip duplicates in "Add to existing". A case-only change (e.g. "penguin" → "Penguin") is still treated as different and is saved.
  - An empty value from the provider never replaces an existing value.
  - Numbers from the provider are saved as strings.
  - Replace now also trims text and drops empty list items, instead of saving them as they were
  - If there is nothing to be sent, the form shows "No updates necessary", sends no request, and stays open.
- What remains:
  - Other fields (cover, authors, ISBN, etc.) have no merge option and are saved as before, even if they did not change.
  - New labels are only in English.
  - Match.vue has no automated tests
  - Field checkbox memory saved in localStorage has no try/catch. This is old code outside the RFC.
