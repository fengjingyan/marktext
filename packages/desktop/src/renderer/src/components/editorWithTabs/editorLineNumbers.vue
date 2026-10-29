<template>
  <div
    class="editor-line-numbers"
    :style="{ left: `${gutterLeft}px` }"
    aria-hidden="true"
    dir="ltr"
  >
    <span
      v-for="line in visibleLines"
      :key="line.number"
      :style="{ top: `${line.top - scrollTop}px`, height: `${line.height}px` }"
    >{{ line.number }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { measureEditorLines, type EditorLinePosition } from '@/util/editorLineNumbers'

const props = defineProps<{ host: HTMLElement }>()
const lines = shallowRef<EditorLinePosition[]>([])
const scrollTop = ref(0)
const viewportHeight = ref(0)
const gutterLeft = ref(0)
const visibleLines = computed(() => lines.value.filter((line) =>
  line.top + line.height >= scrollTop.value && line.top <= scrollTop.value + viewportHeight.value
))
let frame = 0
let mutationObserver: MutationObserver | undefined
let resizeObserver: ResizeObserver | undefined

const syncScroll = () => {
  scrollTop.value = props.host.scrollTop
  viewportHeight.value = props.host.clientHeight
  const content = props.host.querySelector('.mu-container')
  const wrapper = props.host.parentElement
  if (content && wrapper) {
    gutterLeft.value = Math.max(0, content.getBoundingClientRect().left - wrapper.getBoundingClientRect().left)
  }
}
const scheduleMeasure = () => {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    lines.value = measureEditorLines(props.host)
    syncScroll()
    const content = props.host.querySelector('.mu-container')
    if (content) resizeObserver?.observe(content)
  })
}

onMounted(() => {
  mutationObserver = new MutationObserver(scheduleMeasure)
  mutationObserver.observe(props.host, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden']
  })
  resizeObserver = new ResizeObserver(scheduleMeasure)
  resizeObserver.observe(props.host)
  props.host.addEventListener('scroll', syncScroll, { passive: true })
  props.host.addEventListener('load', scheduleMeasure, true)
  document.fonts.addEventListener('loadingdone', scheduleMeasure)
  scheduleMeasure()
})

onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  mutationObserver?.disconnect()
  resizeObserver?.disconnect()
  props.host.removeEventListener('scroll', syncScroll)
  props.host.removeEventListener('load', scheduleMeasure, true)
  document.fonts.removeEventListener('loadingdone', scheduleMeasure)
})
</script>

<style scoped>
.editor-line-numbers {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 48px;
  overflow: hidden;
  pointer-events: none;
  user-select: none;
  color: var(--editorColor);
  opacity: 0.45;
  font: 12px var(--monospace-font, monospace);
  font-variant-numeric: tabular-nums;
  border-right: 1px solid var(--editorColor);
}
.editor-line-numbers span {
  position: absolute;
  right: 8px;
  display: flex;
  align-items: center;
}
</style>
