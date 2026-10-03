<template>
  <div id="page-wrapper" class="page p-6 overflow-y-auto relative" :class="streamLibraryItem ? 'streaming' : ''">
    <div class="w-full max-w-3xl mx-auto">
      <h1 class="text-2xl">{{ $strings.LabelYourBookmarks }}</h1>

      <div class="flex flex-wrap items-end -mx-2 my-4">
        <div class="w-full sm:w-2/3 px-2 py-1">
          <ui-text-input v-model="searchText" :placeholder="$strings.PlaceholderSearchBookmarks" clearable class="w-full h-10" @input="searchInput" />
        </div>
        <div class="w-full sm:w-1/3 px-2 py-1">
          <ui-dropdown v-model="selectedLibraryItemId" :items="bookItems" small @input="bookFilterChanged" />
        </div>
      </div>

      <div v-if="loading && !results.length" class="flex justify-center py-12">
        <widgets-loading-spinner />
      </div>
      <p v-else-if="!results.length && loaded" class="text-center text-gray-300 py-12">{{ hasAnyBookmarks ? $strings.MessageNoBookmarksFound : $strings.MessageNoBookmarks }}</p>

      <div v-else class="w-full rounded-md border border-white/10 overflow-hidden" :class="loading ? 'opacity-60' : ''">
        <div v-for="result in results" :key="`${result.libraryItemId}:${result.time}`" class="flex items-center border-b border-white/10 last:border-b-0">
          <div class="grow overflow-hidden">
            <nuxt-link :to="`/item/${result.libraryItemId}`" class="block px-4 pt-3 text-sm text-gray-300 hover:text-white hover:underline truncate">{{ result.bookTitle }}</nuxt-link>
            <modals-bookmarks-bookmark-item :bookmark="result" :playback-rate="1" read-only class="pt-1!" />
          </div>
          <div class="shrink-0 px-4">
            <ui-btn small color="bg-success" :aria-label="$strings.ButtonPlay" @click.stop="playBookmark(result)">
              <span class="material-symbols text-lg align-middle">play_arrow</span>
              <span class="align-middle pl-1">{{ $strings.ButtonPlay }}</span>
            </ui-btn>
          </div>
        </div>
      </div>

      <div v-if="numPages > 1" class="flex items-center justify-center py-4">
        <ui-btn small :disabled="page <= 0 || loading" @click="changePage(page - 1)">{{ $strings.ButtonPrevious }}</ui-btn>
        <p class="px-4 text-sm">{{ $getString('LabelPaginationPageXOfY', [page + 1, numPages]) }}</p>
        <ui-btn small :disabled="page >= numPages - 1 || loading" @click="changePage(page + 1)">{{ $strings.ButtonNext }}</ui-btn>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  data() {
    return {
      searchText: '',
      selectedLibraryItemId: null,
      page: 0,
      itemsPerPage: 25,
      results: [],
      books: [],
      numPages: 0,
      loading: false,
      loaded: false,
      searchTimeout: null,
      requestId: 0
    }
  },
  computed: {
    streamLibraryItem() {
      return this.$store.state.streamLibraryItem
    },
    bookItems() {
      return [{ text: this.$strings.LabelAllBooks, value: null }, ...this.books.map((book) => ({ text: book.title, value: book.libraryItemId }))]
    },
    hasAnyBookmarks() {
      return this.books.length > 0
    }
  },
  methods: {
    searchInput() {
      clearTimeout(this.searchTimeout)
      this.searchTimeout = setTimeout(() => {
        this.page = 0
        this.fetchResults()
      }, 300)
    },
    bookFilterChanged() {
      this.page = 0
      this.fetchResults()
    },
    changePage(page) {
      if (page < 0 || page >= this.numPages) return
      this.page = page
      this.fetchResults()
    },
    async fetchResults() {
      // Drop out-of-order responses when typing triggers overlapping requests
      const requestId = ++this.requestId
      this.loading = true

      const query = new URLSearchParams({ page: String(this.page), itemsPerPage: String(this.itemsPerPage) })
      const q = (this.searchText || '').trim()
      if (q) query.set('q', q)
      if (this.selectedLibraryItemId) query.set('libraryItemId', this.selectedLibraryItemId)

      try {
        const data = await this.$axios.$get(`/api/me/bookmarks/search?${query.toString()}`)
        if (requestId !== this.requestId) return
        this.results = data.results || []
        this.books = data.books || []
        this.numPages = data.numPages || 0
        this.page = data.page || 0
      } catch (error) {
        if (requestId !== this.requestId) return
        console.error('Failed to search bookmarks', error)
        this.$toast.error(this.$strings.ToastFailedToLoadData)
      } finally {
        if (requestId === this.requestId) {
          this.loading = false
          this.loaded = true
        }
      }
    },
    playBookmark(result) {
      const payload = {
        libraryItemId: result.libraryItemId,
        episodeId: null,
        startTime: Number(result.time),
        queueItems: [
          {
            libraryItemId: result.libraryItemId,
            libraryId: result.libraryId,
            episodeId: null,
            title: result.bookTitle,
            subtitle: '',
            caption: '',
            duration: null,
            coverPath: null
          }
        ]
      }

      if (this.$store.getters['getIsMediaStreaming'](result.libraryItemId)) {
        this.$eventBus.$emit('play-item', payload)
      } else {
        this.$store.commit('globals/setConfirmPrompt', {
          message: this.$getString('MessageStartPlaybackAtTime', [result.bookTitle, this.$secondsToTimestamp(result.time)]),
          callback: (confirmed) => {
            if (confirmed) this.$eventBus.$emit('play-item', payload)
          },
          type: 'yesNo'
        })
      }
    }
  },
  mounted() {
    this.fetchResults()
  },
  beforeDestroy() {
    clearTimeout(this.searchTimeout)
  }
}
</script>
