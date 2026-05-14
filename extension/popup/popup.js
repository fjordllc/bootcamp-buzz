document.addEventListener('DOMContentLoaded', async () => {
  const loader = document.querySelector('.loader')
  const loginDiv = document.querySelector('.login')
  const mainDiv = document.querySelector('.main')
  const loginName = document.getElementById('login_name')
  const password = document.getElementById('password')
  const titleField = document.getElementById('title')
  const publishedAtField = document.getElementById('published_at')
  const memoField = document.getElementById('memo')
  const urlField = document.getElementById('url')
  const activeTab = await getActiveTab()
  const tabId = activeTab.id

  if (!loader || !loginDiv || !mainDiv) {
    console.error('popup ui elements not found')
    return
  }

  loader.classList.add('hidden')
  loginDiv.style.display = 'none'
  mainDiv.style.display = 'none'

  const url = activeTab.url || ''
  if (!url || !url.startsWith('http')) {
    showMessage('urlがありません', 'message-warning')
    return
  }
  urlField.value = url

  const result = await chrome.storage.local.get("jwt");
  const token = result.jwt;
  if (token) {
    showMainContent()
  } else {
    showLoginForm()
    const loginForm = document.getElementById('login-form')

    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault()

      try {
        const response = await fetchToken(loginName.value, password.value)
        if (response.status === 200) {
          await chrome.storage.local.set({ jwt: response.jwt_token })
          hideLoginForm()
          showMainContent()
          initializeForm(url)
          showMessage('ログインしました', 'message-success')
        } else {
          showMessage('ログインに失敗しました', 'message-warning')
          throw new Error(response.status || response.error)
        }
      } catch (error) {
        console.error(`unknown error:`, error)
        return
      }
    })
  }

  const logoutLink = document.getElementById('logout-link')
  logoutLink.addEventListener('click', async (e) => {
    e.preventDefault()
    await chrome.storage.local.remove("jwt");
    showLoginForm()
    hideMainContent()
    showMessage('ログアウトしました', 'message-success')
  })

  let metadata = { title: '', published_at: '' }
  try {
    metadata = await extractMetadata(tabId)
  } catch (error) {
    console.warn('メタデータの取得に失敗しました', error)
  }

  function showMainContent() {
    mainDiv.style.display = 'block'
  }

  function hideMainContent() {
    mainDiv.style.display = 'none'
  }

  function showLoginForm() {
    loginDiv.style.display = 'block'
  }

  function hideLoginForm() {
    loginDiv.style.display = 'none'
  }

  async function backToLoginForm(msg) {
    hideMainContent()
    showLoginForm()
    await chrome.storage.local.remove("jwt");
    showMessage(`${msg}`, 'message-warning')
  }

  initializeForm(url)

  async function initializeForm(url) {
    try {
      const response = await lookupBuzz(url)

      if (response.status === 200) {
        titleField.value = response.buzz.title
        publishedAtField.value = response.buzz.published_at || ''
        memoField.value = response.buzz.memo || ''
        showMessage('既に登録済みです', 'message-warning')
      } else if (response.status === 404) {
        titleField.value = metadata.title
        publishedAtField.value = metadata.published_at || ''
        showMessage('未登録のBuzzです', 'message-warning')
      } else if (response.status === 401) {
        const msg = '認証が必要です'
        backToLoginForm(msg)
      } else if (response.status === 403) {
        const msg = '権限がありません'
        backToLoginForm(msg)
      } else {
        throw new Error(response.status || response.error)
      }

    } catch (error) {
      showMessage('予期せぬエラーが発生しました', 'message-error')
      console.error(`unknown error: url: ${url}`, error)
    }
  }

  const upsertForm = document.getElementById('upsert-form')
  const deleteLink = document.getElementById('delete-link')
  if (!upsertForm || !deleteLink) {
    console.error('form elements not found')
    return
  }

  upsertForm.addEventListener('submit', async (e) => {
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
        await setIcon(response.status)
      } else if (response.status === 200) {
        showMessage('Buzzを更新しました', 'message-success')
      } else if (response.status === 401) {
        const msg = "認証が必要です(token expired)"
        backToLoginForm(msg)
      } else {
        throw new Error(response.status || response.error)
      }
    } catch (error) {
      console.error(`unknown error: buzz: ${JSON.stringify(buzz)}`, error)
      showMessage('Buzzの保存に失敗しました', 'message-error')
    }
  })


  deleteLink.addEventListener('click', async (e) => {
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
      } else if (response.status === 401) {
        const msg = "認証が必要です(token expired)"
        backToLoginForm(msg)
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
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        return {
          title: document.title,
          published_at: document.querySelector('meta[property="article:published_time"]')?.getAttribute('content')?.slice(0, 10) || ""
        };
      }
    });
    const metadata = results[0].result;
    return { title: metadata.title, published_at: metadata.published_at }
  } catch (error) {
    throw new Error(`chrome api error: ${error.message}`)
  }
}

async function fetchToken(login_name, password) {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'fetchToken',
      login_name: login_name,
      password: password
    })
    if (!response) {
      throw new Error('tokenが取得できません')
    }
    return response
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
