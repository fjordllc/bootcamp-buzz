chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action !== 'extractMetadata') return
  const title = document.title
  const published_at = document
    .querySelector('meta[property="article:published_time"]')
    ?.getAttribute('content')
    ?.slice(0, 10)

  sendResponse({
    title: title,
    published_at: published_at
  })
})
