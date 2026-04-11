import { CONFIG } from './config.js';

// Buzzが登録済みかを判定(1): tabを切り替えたとき
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId)
  await updateBuzzIcon(tab)
})

// Buzzが登録済みかを判定(2): 同じtab内で新しい記事を開いたとき
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  await updateBuzzIcon(tab)
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'checkAuth') {
    checkAuth()
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

  if (message.action === 'setIcon') {
    const iconStatus = message.status === 201 ? 'checked' : 'default'
    setIcon(iconStatus).catch((error) => {
      console.error('Icon setting failed:', error)
    })
  }
})

async function checkAuth() {
  try {
    // const response = await fetch(`${CONFIG.BASE_URL}/api/buzz/auth_status`, {
    const response = await fetch(`${CONFIG.BASE_URL}/api/auth`, {
      credentials: 'include'
    })
    if (response.status < 500) {
      return { status: response.status }
    } else {
      throw new Error(`HTTP error: ${response.status}`)
    }
  } catch (error) {
    throw new Error(`failed to check auth: ${error.message}`)
  }
}

async function fetchBuzz(url) {
  try {
    const response = await fetch(`${CONFIG.BASE_URL}/api/buzz?url=${encodeURIComponent(url)}`, {
      credentials: 'include'
    })
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
    } else if (response.status === 404) {
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
    const response = await fetch(`${CONFIG.BASE_URL}/api/buzz`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buzz)
    })
    if (response.status !== 200 && response.status !== 201) {
      throw new Error(`HTTP error: ${response.status}`)
    }
    return { status: response.status }
  } catch (error) {
    throw new Error(`failed to save buzz: ${error.message}`)
  }
}

async function deleteBuzz(url) {
  try {
    const response = await fetch(`${CONFIG.BASE_URL}/api/buzz?url=${encodeURIComponent(url)}`, {
      method: 'DELETE',
      credentials: 'include'
    })
    if (response.status === 200 || response.status === 404) {
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
