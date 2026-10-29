export interface EditorLinePosition {
  number: number
  top: number
  height: number
}

// Positions use scroll-content coordinates; soft wrapping does not create new logical lines.
export const measureEditorLines = (host: HTMLElement): EditorLinePosition[] => {
  const origin = host.getBoundingClientRect().top - host.scrollTop
  const positions: Omit<EditorLinePosition, 'number'>[] = []
  // The language picker edits fence metadata rather than a document text line.
  for (const content of host.querySelectorAll<HTMLElement>('.mu-content:not(.mu-language-input)')) {
    if (!content.getClientRects().length) continue
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
    const nodes: { node: Text; start: number; end: number }[] = []
    let length = 0
    let node = walker.nextNode()
    while (node) {
      const text = node as Text
      nodes.push({ node: text, start: length, end: length + text.length })
      length += text.length
      node = walker.nextNode()
    }
    const lines = (content.textContent ?? '').split('\n')
    let offset = 0
    let startIndex = 0
    let endIndex = 0
    for (const line of lines) {
      while (startIndex < nodes.length && nodes[startIndex].end <= offset) startIndex++
      const start = nodes[startIndex]
      // Empty lines need their newline's box; a collapsed range may have no rectangle.
      const endOffset = Math.min(length, offset + Math.max(1, line.length))
      endIndex = Math.max(startIndex, endIndex)
      while (endIndex < nodes.length && nodes[endIndex].end < endOffset) endIndex++
      const end = nodes[endIndex]
      const range = document.createRange()
      if (start && end) {
        range.setStart(start.node, offset - start.start)
        range.setEnd(end.node, endOffset - end.start)
      } else {
        range.selectNodeContents(content)
        range.collapse(false)
      }
      const rect = Array.from(range.getClientRects()).find((rect) => rect.height > 0)
      const trailingBreak = !start ? content.querySelector('.mu-trailing-break') : null
      const anchor = rect ?? trailingBreak?.getBoundingClientRect() ?? content.getBoundingClientRect()
      positions.push({ top: anchor.top - origin, height: anchor.height })
      offset += line.length + 1
    }
  }
  positions.sort((a, b) => a.top - b.top)
  // Table cells on the same row share a gutter label.
  const rows = positions.filter((position, index) => index === 0 || position.top - positions[index - 1].top > 2)
  return rows.map((position, index) => ({ ...position, number: index + 1 }))
}
