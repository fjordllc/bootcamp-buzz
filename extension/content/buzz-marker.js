// X(旧Twitter)の検索結果・タイムライン上で、登録済みBuzzのポストに印を付ける content script。
// 各ポストのパーマリンク(https://x.com/<user>/status/<id>)を background 経由で照合し、
// 登録済みなら「✓ 登録済み」バッジを表示する。

const CHECK_CONCURRENCY = 4

// 正規化済みURL -> 登録済みか(boolean)。200/404 の確定結果のみキャッシュする
const cache = new Map()
// 判定中のURL -> 進行中のPromise。同一URLの二重問い合わせを防ぐ
const pending = new Map()
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

// URLが登録済みかを判定する。
// 戻り値: true=登録済み / false=未登録(確定) / null=不確定(通信失敗・未ログイン等)
function isRegistered(url) {
  if (cache.has(url)) return Promise.resolve(cache.get(url))
  if (disabled) return Promise.resolve(null)
  if (pending.has(url)) return pending.get(url)

  const promise = new Promise((resolve) => {
    queue.push({ url, resolve })
    pump()
  }).finally(() => {
    pending.delete(url)
  })
  pending.set(url, promise)
  return promise
}

// キューを同時実行数の上限まで処理する
function pump() {
  while (!disabled && activeCount < CHECK_CONCURRENCY && queue.length > 0) {
    const { url, resolve } = queue.shift()
    activeCount++
    chrome.runtime.sendMessage({ action: 'lookupBuzz', url }, (response) => {
      activeCount--

      if (chrome.runtime.lastError || !response) {
        // service worker 未応答など。不確定として次回スキャンで再試行させる
        resolve(null)
        pump()
        return
      }

      if (response.status === 401 || response.status === 403) {
        // 未ログイン等。以降の判定を止めて残りを不確定で解決する
        disabled = true
        resolve(null)
        drainQueue()
        return
      }

      if (response.status === 200) {
        cache.set(url, true)
        resolve(true)
      } else if (response.status === 404) {
        cache.set(url, false)
        resolve(false)
      } else {
        // 5xx など不確定。キャッシュせず再試行に委ねる
        resolve(null)
      }
      pump()
    })
  }
}

// disabled になったときに待機中のものを全て不確定(null)で解決する
function drainQueue() {
  while (queue.length > 0) {
    queue.shift().resolve(null)
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

// ポストに付いているバッジを取り除く
function removeBadge(article) {
  const badge = article.querySelector('.buzz-registered-badge')
  if (badge) badge.remove()
}

async function processArticle(article) {
  const url = extractTweetUrl(article)
  if (!url) {
    // 要素が使い回されURLが取れない状態。古いバッジ/状態を残さないよう掃除する
    removeBadge(article)
    delete article.dataset.buzzUrl
    return
  }

  // 確定済みのURLは再判定しない
  if (article.dataset.buzzUrl === url) return

  // 使い回しで古いバッジが残っていたら消してから判定する
  removeBadge(article)

  const registered = await isRegistered(url)

  // 非同期の間に要素が別ポストへ変わっていないか確認する
  if (extractTweetUrl(article) !== url) return

  // 不確定(通信失敗・未ログイン等)は確定保存せず、次回スキャンで再試行する
  if (registered === null) return

  // 確定結果が出てから記録する(以降このURLでは再判定しない)
  article.dataset.buzzUrl = url
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
