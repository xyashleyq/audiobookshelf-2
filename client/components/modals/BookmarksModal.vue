<template>
  <modals-modal v-model="show" name="bookmarks" :width="500" :height="'unset'">
    <template #outer>
      <div class="absolute top-0 left-0 p-5 w-2/3 overflow-hidden">
        <p class="text-3xl text-white truncate">{{ $strings.LabelYourBookmarks }}</p>
      </div>
    </template>
    <div v-if="show" class="w-full rounded-lg bg-bg box-shadow-md relative" style="max-height: 80vh">
      <!-- Import preview panel -->
      <div v-if="importState" class="w-full max-h-[calc(80vh-20px)] overflow-y-auto p-4">
        <p class="text-sm text-gray-300 truncate mb-3">{{ importState.fileName }}</p>

        <div v-if="importState.errors.length" class="mb-4">
          <p v-for="(err, i) in importState.errors" :key="i" class="text-sm text-red-400">{{ err }}</p>
        </div>

        <template v-else>
          <p v-if="importHintMismatch" class="text-sm text-yellow-400 mb-3">{{ $strings.MessageBookmarkImportWrongBook }}</p>

          <p class="text-sm mb-1">{{ $getString('MessageBookmarkImportCounts', [importState.preview.counts.new, importState.preview.counts.identical, importState.preview.counts.conflict]) }}</p>
          <p v-if="importState.preview.counts.supersededInFile" class="text-xs text-gray-400 mb-2">{{ $getString('MessageBookmarkImportSuperseded', [importState.preview.counts.supersededInFile]) }}</p>

          <div class="max-h-48 overflow-y-auto border border-white/10 rounded mb-3">
            <div v-for="entry in importState.preview.entries" :key="entry.time" class="flex items-center px-2 py-1 text-sm border-b border-white/5">
              <span class="w-16 shrink-0 font-mono text-gray-400">{{ $secondsToTimestamp(entry.time) }}</span>
              <span class="grow px-2 truncate">
                <template v-if="entry.status === 'conflict'">{{ entry.existingTitle }} &rarr; {{ entry.title }}</template>
                <template v-else>{{ entry.title }}</template>
              </span>
              <span class="shrink-0 text-xs" :class="entry.status === 'new' ? 'text-success' : entry.status === 'conflict' ? 'text-yellow-400' : 'text-gray-500'">
                {{ entry.status === 'new' ? $strings.LabelNew : entry.status === 'conflict' ? $strings.LabelConflict : $strings.LabelIdentical }}
              </span>
            </div>
          </div>

          <div v-if="importState.preview.counts.conflict" class="mb-3 text-sm">
            <label class="flex items-center mb-1 cursor-pointer">
              <input v-model="importState.mode" type="radio" value="keep" class="mr-2" />
              {{ $strings.LabelBookmarkImportKeepExisting }}
            </label>
            <label class="flex items-center cursor-pointer">
              <input v-model="importState.mode" type="radio" value="replace" class="mr-2" />
              {{ $strings.LabelBookmarkImportReplaceConflicts }}
            </label>
          </div>

          <p v-if="!canConfirmImport" class="text-sm text-gray-400 mb-3">{{ $strings.MessageBookmarkImportNothingToImport }}</p>
        </template>

        <div class="flex justify-end">
          <ui-btn class="mr-2" @click="cancelImport">{{ $strings.ButtonCancel }}</ui-btn>
          <ui-btn v-if="!importState.errors.length" color="bg-success" :disabled="!canConfirmImport || importState.submitting" @click="confirmImport">{{ $strings.ButtonImport }}</ui-btn>
        </div>
      </div>

      <template v-else>
        <div v-if="bookmarks.length" class="h-full max-h-[calc(80vh-60px)] w-full relative overflow-y-auto overflow-x-hidden">
          <template v-for="bookmark in bookmarks">
            <modals-bookmarks-bookmark-item :key="bookmark.id" :highlight="currentTime === bookmark.time" :bookmark="bookmark" :playback-rate="playbackRate" @click="clickBookmark" @delete="deleteBookmark" />
          </template>
        </div>
        <div v-else class="flex h-32 items-center justify-center">
          <p class="text-xl">{{ $strings.MessageNoBookmarks }}</p>
        </div>

        <div v-if="canCreateBookmark && !hideCreate" class="w-full border-t border-white/10">
          <form @submit.prevent="submitCreateBookmark">
            <div class="flex px-4 py-2 items-center text-center border-b border-white/10 text-white/80">
              <div class="w-16 max-w-16 text-center">
                <p class="text-sm font-mono text-gray-400">
                  {{ this.$secondsToTimestamp(currentTime / playbackRate) }}
                </p>
              </div>
              <div class="grow px-2">
                <ui-text-input v-model="newBookmarkTitle" placeholder="Note" class="w-full h-10" />
              </div>
              <ui-btn type="submit" color="bg-success" :padding-x="4" class="h-10"><span class="material-symbols text-2xl -mt-px">add</span></ui-btn>
            </div>
          </form>
        </div>

        <div class="w-full border-t border-white/10 px-4 py-2 flex justify-end">
          <input ref="importInput" type="file" accept=".json,application/json" class="hidden" @change="onImportFileSelected" />
          <ui-btn class="mr-2" @click="openImportPicker">{{ $strings.ButtonImportBookmarks }}</ui-btn>
          <ui-btn :disabled="!libraryItemBookmarks.length" @click="exportBookmarks">{{ $strings.ButtonExportBookmarks }}</ui-btn>
        </div>
      </template>
    </div>
  </modals-modal>
</template>

<script>
const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024

export default {
  props: {
    value: Boolean,
    bookmarks: {
      type: Array,
      default: () => []
    },
    currentTime: {
      type: Number,
      default: 0
    },
    libraryItemId: String,
    bookTitle: {
      type: String,
      default: ''
    },
    playbackRate: Number,
    hideCreate: Boolean
  },
  data() {
    return {
      selectedBookmark: null,
      showBookmarkTitleInput: false,
      newBookmarkTitle: '',
      importState: null
    }
  },
  watch: {
    show(newVal) {
      if (newVal) {
        this.selectedBookmark = null
        this.showBookmarkTitleInput = false
        this.newBookmarkTitle = ''
      }
      this.importState = null
    }
  },
  computed: {
    show: {
      get() {
        return this.value
      },
      set(val) {
        this.$emit('input', val)
      }
    },
    canCreateBookmark() {
      return !this.bookmarks.find((bm) => Math.abs(this.currentTime - bm.time) < 1)
    },
    dateFormat() {
      return this.$store.getters['getServerSetting']('dateFormat')
    },
    timeFormat() {
      return this.$store.getters['getServerSetting']('timeFormat')
    },
    libraryItemBookmarks() {
      return this.bookmarks.filter((bm) => !this.libraryItemId || bm.libraryItemId === this.libraryItemId)
    },
    canConfirmImport() {
      const state = this.importState
      if (!state || !state.preview) return false
      const counts = state.preview.counts
      return counts.new > 0 || (state.mode === 'replace' && counts.conflict > 0)
    },
    importHintMismatch() {
      const hints = this.importState && this.importState.preview && this.importState.preview.hints
      if (!hints) return false
      if (hints.libraryItemId && hints.libraryItemId !== this.libraryItemId) return true
      return !!(hints.bookTitle && this.bookTitle && hints.bookTitle !== this.bookTitle)
    }
  },
  methods: {
    editBookmark(bm) {
      this.selectedBookmark = bm
      this.newBookmarkTitle = bm.title
      this.showBookmarkTitleInput = true
    },
    deleteBookmark(bm) {
      this.$axios
        .$delete(`/api/me/item/${this.libraryItemId}/bookmark/${bm.time}`)
        .then(() => {
          this.$toast.success(this.$strings.ToastBookmarkRemoveSuccess)
        })
        .catch((error) => {
          this.$toast.error(this.$strings.ToastRemoveFailed)
          console.error(error)
        })
      this.show = false
    },
    clickBookmark(bm) {
      this.$emit('select', bm)
    },
    submitCreateBookmark() {
      if (!this.newBookmarkTitle) {
        this.newBookmarkTitle = this.$formatDatetime(Date.now(), this.dateFormat, this.timeFormat)
      }
      var bookmark = {
        title: this.newBookmarkTitle,
        time: Math.floor(this.currentTime)
      }
      this.$axios
        .$post(`/api/me/item/${this.libraryItemId}/bookmark`, bookmark)
        .then(() => {
          this.$toast.success(this.$strings.ToastBookmarkCreateSuccess)
        })
        .catch((error) => {
          this.$toast.error(this.$strings.ToastBookmarkCreateFailed)
          console.error(error)
        })

      this.newBookmarkTitle = ''
      this.showBookmarkTitleInput = false

      this.show = false
    },

    // ---- Export ----
    exportBookmarks() {
      const payload = {
        absBookmarksVersion: 1,
        libraryItemId: this.libraryItemId,
        bookTitle: this.bookTitle || null,
        exportedAt: Date.now(),
        // Raw stored time in book seconds. Never divide by playbackRate here.
        bookmarks: this.libraryItemBookmarks.map((bm) => ({ time: bm.time, title: bm.title, createdAt: bm.createdAt }))
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `bookmarks-${this.libraryItemId}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    },

    // ---- Import ----
    openImportPicker() {
      this.$refs.importInput.click()
    },
    async onImportFileSelected(evt) {
      const file = evt.target.files && evt.target.files[0]
      evt.target.value = '' // allow picking the same file again
      if (!file) return

      let parsedFile
      try {
        if (file.size > MAX_IMPORT_FILE_BYTES) throw new Error('File too large')
        parsedFile = JSON.parse(await file.text())
      } catch (error) {
        console.error(error)
        this.$toast.error(this.$strings.ToastBookmarkImportInvalidFile)
        return
      }

      try {
        const preview = await this.$axios.$post(`/api/me/item/${this.libraryItemId}/bookmarks/import/preview`, { file: parsedFile })
        this.importState = { fileName: file.name, file: parsedFile, preview, errors: [], mode: 'keep', submitting: false }
      } catch (error) {
        const errors = error.response && error.response.data && error.response.data.errors
        if (errors && errors.length) {
          this.importState = { fileName: file.name, file: parsedFile, preview: null, errors, mode: 'keep', submitting: false }
        } else {
          console.error(error)
          this.$toast.error(this.$strings.ToastBookmarkImportFailed)
        }
      }
    },
    cancelImport() {
      this.importState = null
    },
    async confirmImport() {
      if (!this.canConfirmImport || this.importState.submitting) return
      this.importState.submitting = true
      try {
        const response = await this.$axios.$post(`/api/me/item/${this.libraryItemId}/bookmarks/import`, {
          file: this.importState.file,
          mode: this.importState.mode
        })
        this.$toast.success(this.$getString('ToastBookmarkImportSuccess', [response.summary.added, response.summary.replaced]))
        this.importState = null
      } catch (error) {
        console.error(error)
        this.$toast.error(this.$strings.ToastBookmarkImportFailed)
        if (this.importState) this.importState.submitting = false
      }
    }
  }
}
</script>