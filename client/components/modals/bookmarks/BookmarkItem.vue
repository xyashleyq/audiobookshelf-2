<template>
  <div class="flex items-center px-4 py-4 justify-start relative hover:bg-primary/10" :class="wrapperClass" @click.stop="click" @mouseover="mouseover" @mouseleave="mouseleave">
    <div class="w-16 max-w-16 text-center">
      <p class="text-sm font-mono text-gray-400">
        {{ this.$secondsToTimestamp(bookmark.time / playbackRate) }}
      </p>
    </div>
    <div class="grow overflow-hidden px-2">
      <template v-if="isEditing">
        <form @submit.prevent="submitUpdate">
          <div class="flex items-center">
            <div class="grow pr-2">
              <ui-text-input v-model="newBookmarkTitle" placeholder="Note" class="w-full h-10" />
            </div>
            <ui-btn type="submit" color="bg-success" :padding-x="4" class="h-10"><span class="material-symbols text-2xl -mt-px">forward</span></ui-btn>
            <div class="pl-2 flex items-center">
              <span class="material-symbols text-3xl text-white/70 hover:text-white/95 cursor-pointer" @click.stop.prevent="cancelEditing">close</span>
            </div>
          </div>
        </form>
      </template>
      <template v-else>
        <p v-if="bookTitle" data-testid="bookmark-book-title" class="pl-2 pr-2 text-xs text-gray-400 truncate">{{ bookTitle }}</p>
        <p class="pl-2 pr-2 truncate">{{ bookmark.title }}</p>
      </template>
    </div>
    <div v-if="!isEditing && !readOnly" class="h-full flex items-center justify-end transform" :class="isHovering ? 'transition-transform translate-0 w-16' : 'translate-x-40 w-0'">
      <span class="material-symbols text-xl mr-2 text-gray-200 hover:text-yellow-400" @click.stop="editClick">edit</span>
      <span class="material-symbols text-xl text-gray-200 hover:text-error cursor-pointer" @click.stop="deleteClick">delete</span>
    </div>
  </div>
</template>

<script>
export default {
  props: {
    bookmark: {
      type: Object,
      default: () => {}
    },
    highlight: Boolean,
    playbackRate: Number,
    readOnly: Boolean,
    bookTitle: {
      type: String,
      default: null
    }
  },
  data() {
    return {
      isHovering: false,
      isEditing: false,
      newBookmarkTitle: null
    }
  },
  computed: {
    wrapperClass() {
      var classes = []
      if (this.highlight) classes.push('bg-bg/60')
      if (!this.isEditing && !this.readOnly) classes.push('cursor-pointer')
      return classes.join(' ')
    }
  },
  methods: {
    mouseover() {
      if (this.isEditing || this.readOnly) return
      this.isHovering = true
    },
    mouseleave() {
      this.isHovering = false
    },
    click(e) {
      if (this.isEditing) {
        if (e) e.stopPropagation()
        return
      }
      this.$emit('click', this.bookmark)
    },
    deleteClick() {
      if (this.isEditing) return
      this.$emit('delete', this.bookmark)
    },
    editClick() {
      if (this.readOnly) return
      this.newBookmarkTitle = this.bookmark.title
      this.isEditing = true
      this.isHovering = false
    },
    cancelEditing() {
      this.isEditing = false
    },
    submitUpdate() {
      if (this.newBookmarkTitle === this.bookmark.title) {
        return this.cancelEditing()
      }
      const bookmark = { ...this.bookmark }
      bookmark.title = this.newBookmarkTitle

      this.$axios
        .$patch(`/api/me/item/${bookmark.libraryItemId}/bookmark`, bookmark)
        .then(() => {
          this.isEditing = false
        })
        .catch((error) => {
          this.$toast.error(this.$strings.ToastFailedToUpdate)
          console.error(error)
        })
    }
  }
}
</script>
