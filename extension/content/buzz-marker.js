// X(旧Twitter)の検索結果・タイムライン上で、登録済みBuzzのポストに印を付ける content script。
// 各ポストのパーマリンク(https://x.com/<user>/status/<id>)を background 経由で照合し、
// 登録済みなら「✓ 登録済み」バッジを表示する。

const CHECK_CONCURRENCY = 4

// 正規化済みURL -> 登録済みか(boolean)。200/404 の確定結果のみキャッシュする
const cache = new Map()
const queue = []
let activeCount = 0
// 未ログイン(401/403)を検知したら判定を止めるためのフラグ
let disabled = false

// ポスト要素から正規のパーマリンクURLを取り出す
function extractTweetUrl(article) {
  // タイムスタンプのリンク = そのポストのパーマリンク
  const timeEl = article.querySelector('time')
  const anchor = timeEl?.closest('a[href*="/status/"]')
  if (!anchor) return null
  return normalizeTweetUrl(anchor.href)
}

// /photo/1 やクエリ等を落として https://x.com/<user>/status/<id> に揃える
function normalizeTweetUrl(href) {
  try {
    const url = new URL(href, location.origin)
    const match = url.pathname.match(/^\/([^/]+)\/status\/(\d+)/)
    if (!match) return null
    return `https://x.com/${match[1]}/status/${match[2]}`
  } catch {
    return null
  }
}

// URLが登録済みかを判定する(結果はキャッシュ)
function isRegistered(url) {
  if (cache.has(url)) return Promise.resolve(cache.get(url))
  if (disabled) return Promise.resolve(false)
  return new Promise((resolve) => {
    queue.push({ url, resolve })
    pump()
  })
}

// キューを同時実行数の上限まで処理する
function pump() {
  while (!disabled && activeCount < CHECK_CONCURRENCY && queue.length > 0) {
    const { url, resolve } = queue.shift()
    activeCount++
    chrome.runtime.sendMessage({ action: 'lookupBuzz', url }, (response) => {
      activeCount--

      if (chrome.runtime.lastError || !response) {
        // service worker 未応答など。確定できないのでキャッシュしない
        resolve(false)
        pump()
        return
      }

      if (response.status === 401 || response.status === 403) {
        // 未ログイン等。以降の判定を止めて残りを解決する
        disabled = true
        resolve(false)
        drainQueue()
        return
      }

      const registered = response.status === 200
      if (response.status === 200 || response.status === 404) {
        cache.set(url, registered)
      }
      resolve(registered)
      pump()
    })
  }
}

// disabled になったときに待機中のものを全て false で解決する
function drainQueue() {
  while (queue.length > 0) {
    queue.shift().resolve(false)
  }
}

// 「✓ 登録済み」バッジをポストのヘッダに追加する
function addBadge(article) {
  if (article.querySelector('.buzz-registered-badge')) return
  const badge = document.createElement('span')
  badge.className = 'buzz-registered-badge'
  badge.textContent = '✓ 登録済み'
  const header = article.querySelector('[data-testid="User-Name"]')
  if (header) {
    header.appendChild(badge)
  } else {
    article.prepend(badge)
  }
}

async function processArticle(article) {
  const url = extractTweetUrl(article)
  if (!url) return

  // 同じ要素が別ポストに使い回された場合に備えてURL単位で判定
  if (article.dataset.buzzUrl === url) return
  article.dataset.buzzUrl = url

  // 使い回しで古いバッジが残っていたら消す
  const old = article.querySelector('.buzz-registered-badge')
  if (old) old.remove()

  const registered = await isRegistered(url)
  // 非同期の間に要素が別ポストへ変わっていないか確認
  if (article.dataset.buzzUrl !== url) return
  if (registered) addBadge(article)
}

function scan() {
  document
    .querySelectorAll('article[data-testid="tweet"]')
    .forEach((article) => {
      processArticle(article)
    })
}

// Xはインフィニットスクロールでポストが動的に増減するため監視する
let debounceTimer = null
const observer = new MutationObserver(() => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(scan, 300)
})
observer.observe(document.body, { childList: true, subtree: true })

scan()
