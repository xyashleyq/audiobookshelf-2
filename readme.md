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

### New Feature 3 - [merge]

1. Open a book that already has a publisher and genres, then go to the Match tab, search, and pick a result with a publisher and genres.
2. Under Publisher, tick “Only fill if empty”. Under Genres, tick “Add to existing”.
3. Check the “Result”:
  * Publisher shows your current value with “(no change)”.
  * Genres shows your current genres followed by the new ones, without duplicates.
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

### 02

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
- What remains:
  - Other fields (cover, authors, ISBN, etc.) have no merge option and are unchanged.
  - New labels are only in English.
  - Field checkbox memory saved in localStorage has no try/catch. This is old code outside the RFC.


