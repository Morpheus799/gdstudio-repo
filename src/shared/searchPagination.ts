/** Paginate the records actually returned by an API that provides no total. */
export function createSearchPagination<T>(
  fetchBatch: (page: number) => Promise<T[]>,
  getId: (item: T) => string,
  onPartialError: (error: unknown) => void = () => {}
) {
  const items: T[] = []
  const ids = new Set<string>()
  let nextApiPage = 1
  let exhausted = false
  let pending: Promise<void> | undefined

  const loadNextBatch = () => {
    if (pending) return pending
    pending = fetchBatch(nextApiPage).then((batch) => {
      // An empty response may mean rate limiting. Keep this API page retryable.
      if (!batch.length) throw new Error('搜索返回空结果(可能是 API 限流,请稍后重试)')
      const newItems = batch.filter((item) => {
        const id = getId(item)
        if (ids.has(id)) return false
        ids.add(id)
        return true
      })
      // Some sources ignore the page parameter and repeat the same results.
      if (!newItems.length) exhausted = true
      items.push(...newItems)
      nextApiPage++
    }).finally(() => {
      pending = undefined
    })
    return pending
  }

  return {
    async getPage(page: number, limit: number) {
      const start = (page - 1) * limit
      const end = start + limit
      try {
        while (items.length < end && !exhausted) await loadNextBatch()
      } catch (error) {
        if (start >= items.length) throw error
        // Preserve available songs and the next-page entry if fetching more fails.
        onPartialError(error)
      }

      return {
        list: items.slice(start, end),
        // A short batch is not evidence of the last page. Advertise one page
        // beyond the cached records; keep this estimate across backward paging.
        total: exhausted ? items.length : Math.ceil(items.length / limit) * limit + 1,
      }
    },
  }
}
