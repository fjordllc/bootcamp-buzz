// 登録済みBuzzのリンクの横に「✓ 登録済み」バッジを表示する content script。
// 対応サイト:
//   - X(x.com / twitter.com): ツイート内の t.co 短縮リンクを background で実URLに展開して照合
//   - はてなブックマーク(b.hatena.ne.jp): エントリーの記事リンク(実URL)を直接照合

const MAX_CONCURRENCY = 4

// 実URL -> 登録済みか(true/false)。200/404 の確定結果のみキャッシュする
const registeredCache = new Map()
// 短縮URL -> 展開後の実URL(解決できなければnull)。成否ともキャッシュする
const resolvedCache = new Map()
// 判定中の重複問い合わせを防ぐためのPromiseマップ
const registeredPending = new Map()
const resolvedPending = new Map()
// 未ログイン(401/403)を検知したら判定を止めるフラグ
let disabled = false

// --- 同時実行数を制限する簡易セマフォ ---
let active = 0
const waiters = []

function acquire() {
  if (active < MAX_CONCURRENCY) {
    active++
    return Promise.resolve()
  }
  return new Promise((resolve) => waiters.push(resolve))
}

function release() {
  active--
  const next = waiters.shift()
  if (next) {
    active++
    next()
  }
}

// backgroundへメッセージを送る(lastError等はnullに正規化)
function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null)
      } else {
        resolve(response ?? null)
      }
    })
  })
}

async function limitedSend(message) {
  await acquire()
  try {
    return await sendMessage(message)
  } finally {
    release()
  }
}

// ハッシュを除いた実URLに正規化する
function normalizeUrl(url) {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return null
  }
}

// 短縮URL(t.co)を実URLに展開する。解決できなければnull。
function resolveShortUrl(shortUrl) {
  if (resolvedCache.has(shortUrl)) {
    return Promise.resolve(resolvedCache.get(shortUrl))
  }
  if (resolvedPending.has(shortUrl)) return resolvedPending.get(shortUrl)

  const promise = (async () => {
    const response = await limitedSend({ action: 'resolveUrl', url: shortUrl })
    const real = response && response.url ? normalizeUrl(response.url) : null
    resolvedCache.set(shortUrl, real)
    return real
  })().finally(() => resolvedPending.delete(shortUrl))

  resolvedPending.set(shortUrl, promise)
  return promise
}

// 実URLが登録済みかを判定する。true=登録済 / false=未登録(確定) / null=不確定
function isRegistered(url) {
  if (registeredCache.has(url)) {
    return Promise.resolve(registeredCache.get(url))
  }
  if (disabled) return Promise.resolve(null)
  if (registeredPending.has(url)) return registeredPending.get(url)

  const promise = (async () => {
    const response = await limitedSend({ action: 'lookupBuzz', url })
    if (!response) return null
    if (response.status === 401 || response.status === 403) {
      // 未ログイン等。以降の判定を止める
      disabled = true
      return null
    }
    if (response.status === 200) {
      registeredCache.set(url, true)
      return true
    }
    if (response.status === 404) {
      registeredCache.set(url, false)
      return false
    }
    // 5xx など不確定。キャッシュせず再試行に委ねる
    return null
  })().finally(() => registeredPending.delete(url))

  registeredPending.set(url, promise)
  return promise
}

// --- バッジ表示 ---

function hasBadge(anchor) {
  const next = anchor.nextElementSibling
  return !!next && next.classList.contains('buzz-registered-badge')
}

// リンクの直後に「✓ 登録済み」バッジを差し込む
function addBadge(anchor) {
  if (hasBadge(anchor)) return
  const badge = document.createElement('span')
  badge.className = 'buzz-registered-badge'
  badge.textContent = '✓ 登録済み'
  anchor.insertAdjacentElement('afterend', badge)
}

// --- サイト別アダプタ ---
// linkSelector: 判定対象リンクのCSSセレクタ
// getRealUrl(anchor): そのリンクの照合用実URL(Promise, 解決不能はnull)

const X_ADAPTER = {
  linkSelector: 'article[data-testid="tweet"] a[href^="https://t.co/"]',
  getRealUrl: (anchor) => resolveShortUrl(anchor.href)
}

const HATENA_ADAPTER = {
  linkSelector: [
    'a.js-keyboard-openable[href^="http"]',
    'a.entrylist-contents-title[href^="http"]'
  ].join(', '),
  getRealUrl: (anchor) => Promise.resolve(normalizeUrl(anchor.href))
}

function detectAdapter() {
  const host = location.hostname
  if (host === 'x.com' || host === 'twitter.com') return X_ADAPTER
  if (host === 'b.hatena.ne.jp') return HATENA_ADAPTER
  return null
}

const adapter = detectAdapter()

async function processLink(anchor) {
  const key = anchor.href
  if (!key) return

  // 確定済みのリンクは再処理しない
  if (anchor.dataset.buzzKey === key) return

  const realUrl = await adapter.getRealUrl(anchor)
  // 非同期の間に要素が別リンクへ変わっていないか確認する
  if (anchor.href !== key) return

  if (realUrl === null) {
    // 実URLを得られない(展開不能・不正URL)。確定扱いにして再試行しない
    anchor.dataset.buzzKey = key
    return
  }

  const registered = await isRegistered(realUrl)
  if (anchor.href !== key) return

  // 不確定(通信失敗・未ログイン等)は確定保存せず、次回スキャンで再試行する
  if (registered === null) return

  // 確定結果が出てから記録する(以降このリンクでは再判定しない)
  anchor.dataset.buzzKey = key
  if (registered) addBadge(anchor)
}

function scan() {
  document.querySelectorAll(adapter.linkSelector).forEach((anchor) => {
    processLink(anchor)
  })
}

if (adapter) {
  // ページはスクロールで内容が動的に増減するため監視する
  let debounceTimer = null
  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(scan, 300)
  })
  observer.observe(document.body, { childList: true, subtree: true })

  scan()
}
