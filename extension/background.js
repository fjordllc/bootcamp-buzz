import { CONFIG } from './config.js'

// Buzzが登録済みかを判定(1): tabを切り替えたとき
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId)
    await updateBuzzIcon(tab)
  } catch (error) {
    // タブが既に閉じられている場合など(No tab with id)は無視する
    console.debug('onActivated skipped:', error.message)
  }
})

// Buzzが登録済みかを判定(2): 同じtab内で新しい記事を開いたとき
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  try {
    await updateBuzzIcon(tab)
  } catch (error) {
    // タブが既に閉じられている場合などは無視する
    console.debug('onUpdated skipped:', error.message)
  }
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'fetchToken') {
    fetchToken(message.login_name, message.password)
      .then((response) => {
        sendResponse(response)
      })
      .catch((error) => {
        sendResponse({ error: error.message })
      })
    return true
  }

  if (message.action === 'lookupBuzz') {
    fetchBuzz(message.url)
      .then((response) => {
        sendResponse(response)
      })
      .catch((error) => {
        sendResponse({ error: error.message })
      })
    return true
  }

  if (message.action === 'saveBuzz') {
    saveBuzz(message.buzz)
      .then((response) => {
        sendResponse(response)
      })
      .catch((error) => {
        sendResponse({ error: error.message })
      })
    return true
  }

  if (message.action === 'deleteBuzz') {
    deleteBuzz(message.url)
      .then((response) => {
        sendResponse(response)
      })
      .catch((error) => {
        sendResponse({ error: error.message })
      })
    return true
  }

  if (message.action === 'resolveUrl') {
    resolveUrl(message.url)
      .then((response) => {
        sendResponse(response)
      })
      .catch((error) => {
        sendResponse({ error: error.message })
      })
    return true
  }

  if (message.action === 'setIcon') {
    setIcon(message.status).catch((error) => {
      console.error('Icon setting failed:', error)
    })
  }
})

// t.coはHTTPリダイレクト(301)ではなく、実URLを埋め込んだHTML中間ページ(200)を
// 返す。本文から実URLを取り出す。
function extractExpandedUrl(html) {
  // <meta http-equiv="refresh" content="0;URL=https://...">
  const metaMatch = html.match(
    /http-equiv=["']?refresh["']?[^>]*?url=([^"'>\s]+)/i
  )
  if (metaMatch) return metaMatch[1].replace(/&amp;/g, '&')
  // location.replace("https:\/\/...") スラッシュがエスケープされている
  const jsMatch = html.match(/location\.replace\((["'])(.*?)\1\)/i)
  if (jsMatch) return jsMatch[2].replace(/\\\//g, '/')
  return null
}

function isShortenerUrl(url) {
  try {
    return new URL(url).hostname === 't.co'
  } catch {
    return false
  }
}

// 短縮URLを実URLに展開する。認証情報は送らない。
// 通常のHTTPリダイレクトで辿れた場合はその最終URLを、t.coのように
// HTML中間ページを返す場合は本文から抽出した実URLを返す。
async function resolveUrl(url) {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      credentials: 'omit'
    })
    // HTTPリダイレクトで最終URLになっていればそれを使う(本文は読まない)
    if (response.url && !isShortenerUrl(response.url)) {
      return { url: response.url }
    }
    // t.coが中間ページを返した場合は本文から実URLを取り出す
    const html = await response.text()
    const expanded = extractExpandedUrl(html)
    return { url: expanded || response.url }
  } catch (error) {
    return { error: error.message }
  }
}

async function fetchToken(login_name, password) {
  try {
    const response = await fetch(`${CONFIG.BASE_URL}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login_name: login_name,
        password: password
      })
    })
    if (!response.ok) {
      return { status: response.status }
    }
    const data = await response.json()
    return {
      status: response.status,
      jwt_token: data.token
    }
  } catch (error) {
    throw new Error(`failed to fetch token: ${error.message}`)
  }
}

async function fetchBuzz(url) {
  try {
    const data = await chrome.storage.local.get('jwt')
    if (!data.jwt) {
      return { status: 401 }
    }
    const response = await fetch(
      `${CONFIG.BASE_URL}/api/buzz?url=${encodeURIComponent(url)}`,
      {
        headers: { Authorization: `Bearer ${data.jwt}` },
        credentials: 'omit'
      }
    )
    if (response.status === 200) {
      const buzz = await response.json()
      return {
        status: response.status,
        buzz: {
          title: buzz.title,
          published_at: buzz.published_at,
          memo: buzz.memo
        }
      }
    } else if (
      response.status === 404 ||
      response.status === 401 ||
      response.status === 403
    ) {
      return { status: response.status }
    } else {
      throw new Error(`HTTP error: ${response.status}`)
    }
  } catch (error) {
    throw new Error(`failed to fetch buzz: ${error.message}`)
  }
}

async function saveBuzz(buzz) {
  try {
    const data = await chrome.storage.local.get('jwt')
    if (!data.jwt) {
      return { status: 401 }
    }
    const response = await fetch(`${CONFIG.BASE_URL}/api/buzz`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${data.jwt}`,
        'Content-Type': 'application/json'
      },
      credentials: 'omit',
      body: JSON.stringify(buzz)
    })
    if (response.ok || response.status === 401) {
      return { status: response.status }
    } else {
      throw new Error(`HTTP error: ${response.status}`)
    }
  } catch (error) {
    throw new Error(`failed to save buzz: ${error.message}`)
  }
}

async function deleteBuzz(url) {
  try {
    const data = await chrome.storage.local.get('jwt')
    if (!data.jwt) {
      return { status: 401 }
    }
    const response = await fetch(
      `${CONFIG.BASE_URL}/api/buzz?url=${encodeURIComponent(url)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${data.jwt}` },
        credentials: 'omit'
      }
    )
    if (
      response.status === 200 ||
      response.status === 404 ||
      response.status === 401
    ) {
      return { status: response.status }
    } else {
      throw new Error(`HTTP error: ${response.status}`)
    }
  } catch (error) {
    throw new Error(`failed to delete buzz: ${error.message}`)
  }
}

async function setIcon(status) {
  try {
    const iconPath =
      status === 'checked'
        ? 'icons/buzz_icon16_checked.png'
        : 'icons/buzz_icon16.png'
    await chrome.action.setIcon({ path: iconPath })
  } catch (error) {
    console.error('chrome api error:', error)
  }
}

async function updateBuzzIcon(tab) {
  if (!tab || !tab.url) return

  try {
    const response = await fetchBuzz(tab.url)
    const iconType = response.status === 200 ? 'checked' : 'default'
    await setIcon(iconType)
  } catch (error) {
    console.error('failed to switch icon:', error)
  }
}
