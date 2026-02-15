document.addEventListener('DOMContentLoaded', async () => {
  const loader = document.querySelector('.loader')
  const loginDiv = document.querySelector('.login')
  const mainDiv = document.querySelector('.main')
  const infoDiv = document.querySelector('.info')
  const titleField = document.getElementById('title')
  const publishedAtField = document.getElementById('published_at')
  const memoField = document.getElementById('memo')
  const urlField = document.getElementById('url')
  const activeTab = await getActiveTab()
  const tabId = activeTab.id
  const url = activeTab.url
  urlField.value = url

  if (!loader || !loginDiv || !mainDiv || !infoDiv) {
    console.error('popup ui elements not found')
    return
  }

  loader.classList.add('hidden')
  loginDiv.style.display = 'none'
  mainDiv.style.display = 'none'
  infoDiv.style.display = 'none'

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

  if (!tab.url.startsWith('http')) {
    showInfo()
    return
  }

  const cookie = await ensureCookies()
  if (!cookie) {
    showLoginPrompt()
    return
  }

  showMainContent()

  const metadata = await extractMetadata(tabId)

  async function ensureCookies() {
    try {
      const cookie = await chrome.cookies.get({
        url: 'http://localhost:3000',
        name: '_bootcamp_session'
      })
      return cookie
    } catch (error) {
      console.error('failed to get cookie:', error)
      showLoginPrompt()
    }
  }

  function showMainContent() {
    mainDiv.style.display = 'block'
  }

  function showLoginPrompt() {
    loginDiv.style.display = 'block'
  }

  function showInfo() {
    infoDiv.style.display = 'block'
  }

  try {
    const response = await lookupBuzz(url)
    if (response.status === 200) {
      titleField.value = response.buzz.title
      publishedAtField.value = response.buzz.published_at || ''
      memoField.value = response.buzz.memo || ''
      showMessage('既に登録済みです', 'message-success')
    } else if (response.status === 404) {
      titleField.value = metadata.title
      publishedAtField.value = metadata.published_at || ''
      showMessage('未登録のBuzzです', 'message-success')
    } else {
      throw new Error(response.status || response.error)
    }
  } catch (error) {
    showMessage('予期せぬエラーが発生しました', 'message-error')
    console.error(`unknown error: url: ${url}`, error)
  }

  document
    .getElementById('upsert-form')
    .addEventListener('submit', async (e) => {
      e.preventDefault()

      if (!titleField.value.trim() && !publishedAtField.value.trim()) {
        showMessage('titleとpublished_atを入力してください', 'message-warning')
        return
      } else if (!titleField.value.trim()) {
        showMessage('titleを入力してください', 'message-warning')
        return
      } else if (!publishedAtField.value.trim()) {
        showMessage('published_atを入力してください', 'message-warning')
        return
      }

      const buzz = {
        title: titleField.value,
        published_at: publishedAtField.value,
        memo: memoField.value,
        url: urlField.value
      }

      try {
        const response = await saveBuzz(buzz)
        if (response.status === 201) {
          showMessage('Buzzを登録しました', 'message-success')
          setIcon(response.status)
        } else if (response.status === 200) {
          showMessage('Buzzを更新しました', 'message-success')
        } else {
          throw new Error(response.status || response.error)
        }
      } catch (error) {
        console.error(`unknown error: buzz: ${JSON.stringify(buzz)}`, error)
        showMessage('Buzzの保存に失敗しました', 'message-error')
      }
    })

  document
    .getElementById('delete-link')
    .addEventListener('click', async (e) => {
      e.preventDefault()
      try {
        const response = await deleteBuzz(url)
        if (response.status === 200) {
          showMessage('Buzzを削除しました', 'message-success')
          titleField.value = metadata.title
          publishedAtField.value = metadata.published_at || ''
          memoField.value = ''
          await setIcon(response.status)
        } else if (response.status === 404) {
          showMessage('Buzzが見つかりません', 'message-error')
        } else {
          throw new Error(response.status || response.error)
        }
      } catch (error) {
        console.error(`unknown error: url: ${url}`, error)
        showMessage('Buzzが削除できません', 'message-error')
      }
    })

  function showMessage(text, type) {
    const statusMessage = document.getElementById('status-message')
    if (!statusMessage) {
      console.error('status-message not found')
      return
    }

    statusMessage.classList.remove(
      'message-success',
      'message-error',
      'message-warning'
    )
    statusMessage.classList.add(type)
    statusMessage.textContent = text

    setTimeout(() => {
      statusMessage.textContent = ''
    }, 3000)
  }
})

async function getActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true
    })
    if (!tab) {
      throw new Error('タブが見つかりません')
    }
    return { id: tab.id, url: tab.url }
  } catch (error) {
    throw new Error(`chrome api error: ${error.message}`)
  }
}

async function extractMetadata(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      action: 'extractMetadata'
    })
    if (!response) {
      throw new Error('メタデータが取得できません')
    }
    return { title: response.title, published_at: response.published_at }
  } catch (error) {
    throw new Error(`chrome api error: ${error.message}`)
  }
}

async function lookupBuzz(url) {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'lookupBuzz',
      url: url
    })
    if (!response) {
      throw new Error('buzzが取得できません')
    }
    return response
  } catch (error) {
    throw new Error(`chrome api error: ${error.message}`)
  }
}

async function saveBuzz(buzz) {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'saveBuzz',
      buzz: buzz
    })
    if (!response) {
      throw new Error('buzzが保存できません')
    }
    return response
  } catch (error) {
    throw new Error(`chrome api error: ${error.message}`)
  }
}

async function deleteBuzz(url) {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'deleteBuzz',
      url: url
    })
    if (!response) {
      throw new Error('buzzが削除できません')
    }
    return response
  } catch (error) {
    throw new Error(`chrome api error: ${error.message}`)
  }
}

async function setIcon(status) {
  try {
    await chrome.runtime.sendMessage({
      action: 'setIcon',
      status: status
    })
  } catch (error) {
    throw new Error(`chrome api error: ${error.message}`)
  }
}
