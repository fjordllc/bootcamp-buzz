document.addEventListener('DOMContentLoaded', function() {
  const loader = document.querySelector('.loader')
  const loginDiv = document.querySelector('.login')
  const mainDiv = document.querySelector('.main')
  const titleField = document.getElementById('title')
  const publishedAtField = document.getElementById('published_at')

  if (!loader || !loginDiv || !mainDiv) {
    console.error("要素が見つかりません");
    return
  }

  loader.classList.add('hidden');
  loginDiv.style.display = 'none';
  mainDiv.style.display = 'none';

  chrome.cookies.get({
    url: "http://localhost:3000",
    name: "_bootcamp_session"
  }, (cookie) => {
    if (cookie) {
      console.log(cookie)
      showMainContent();
    } else {
      showLoginPrompt();
    }
  });

  function showMainContent() {
    mainDiv.style.display = 'block';
  };

  function showLoginPrompt() {
    loginDiv.style.display = 'block';
  };

  chrome.tabs.query({'active': true, 'lastFocusedWindow': true}, (tabs) => {
    const urlField = document.getElementById('url');
    urlField.value = tabs[0].url
  })

  document.getElementById('upsert-form').addEventListener('submit', (e) => {
    e.preventDefault();

    if (!titleField.value.trim()) {
      e.preventDefault();
      console.log('title empty')
      showMessage('titleを入力してください', 'message-error');
      return
    }

    if (!publishedAtField.value) {
      e.preventDefault();
      console.log('date empty')
      showMessage('日付を選択してください', 'message-error');
      return;
    }
    console.log('Form submitted!');
  });

  function showMessage(text, type) {
    const statusMessage = document.getElementById('status-message');
    statusMessage.classList.remove();
    statusMessage.classList.add(type);
    statusMessage.textContent = text;

    setTimeout(() => {
      statusMessage.textContent = "";
    }, 3000);
  }
});

