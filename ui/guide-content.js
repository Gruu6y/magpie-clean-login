// The in-page manual, shown in the fourth tab.
//
// This is prose for a person who has never used the plugin, so it is kept out
// of app.js (which is wiring) and out of index.html (which the editorial test
// keeps free of remote URLs). Every claim here was read back from the code it
// describes: the two third-party scores are named and kept apart, the SOCKS5
// split is stated, and the who.1ms.dog disclaimer is repeated verbatim from
// messages.gradeDisclaimer rather than paraphrased into a promise.
//
// Hosts are written without a scheme on purpose, the same way the rest of the
// page writes them: this file ships inside a sandboxed page that cannot open
// links, so a clickable-looking URL would be a lie.
//
// A section is { n, title, lead, blocks }. A block is one of:
//   { t: "p",     text }
//   { t: "ol",    items: [text, ...] }   numbered steps
//   { t: "ul",    items: [text, ...] }   plain points
//   { t: "terms", items: [{ k, v }, ...] }
//   { t: "note",  text }                 a bordered caveat
// The renderer only ever sets textContent, so nothing here can become markup.

const en = [
  {
    n: "01",
    title: "What this plugin does",
    lead: "Clean Login moves signing in into its own isolated browser: every account keeps one fixed browser fingerprint, you choose the exit it signs in through, and the credentials are written straight into magpie when you are done.",
    blocks: [
      { t: "ul", items: [
        "Providers — see which services can be signed in to, and start a sign-in from a card.",
        "Proxy IPs — manage the exits used for signing in and for later requests, and test them.",
        "Accounts — see every account you signed in, the fingerprint it keeps, and what a third-party site makes of that identity.",
      ] },
      { t: "note", text: "Clean Login does not register accounts for you and does not bypass any service's verification. It only makes sure the same account keeps showing up as the same identity, from the same exit." },
    ],
  },
  {
    n: "02",
    title: "First run: prepare the login browser",
    lead: "Signing in never uses your everyday browser. Before the first sign-in, open the Providers tab and press Prepare browser once on the Login browser setup card at the top.",
    blocks: [
      { t: "ol", items: [
        "Open the Providers tab and find the Login browser setup card at the top.",
        "Read the download size and the free disk space it reports, then press Prepare browser.",
        "Wait for the progress to finish and the badge to read Ready. You can cancel while it runs.",
      ] },
      { t: "note", text: "Nothing is downloaded until you press the button. The browser and the fingerprint model are installed into this plugin's own cache, not into a shared Camoufox cache. If you try to sign in before this is done, you are told the login browser is not installed." },
    ],
  },
  {
    n: "03",
    title: "Add a proxy IP (only if you want a different exit)",
    lead: "If an account should sign in from a particular network exit, add that exit on the Proxy IPs tab first. If you do not need one, skip this step and pick No proxy (direct) when signing in.",
    blocks: [
      { t: "ol", items: [
        "Press Add Proxy and fill in the name, type, host and port. Add a username and password only if the proxy needs them.",
        "Press Test connection. A line reading Connection works · exit … · … ms means the exit is usable.",
        "Press Save.",
      ] },
      { t: "ul", items: [
        "HTTP, HTTPS and SOCKS5 are supported.",
        "The password is stored on this machine only and is never shown again. When editing, leaving it empty keeps the saved one.",
        "Test target defaults to Generic (exit check): it measures the round trip to the exit-check service and reports the exit IP and region.",
        "Pick a provider instead and it measures the round trip from this proxy to that provider's own server. Only providers whose installed plugin declares an API address appear here.",
        "A provider you have not measured shows a blank, never the generic number borrowed from another target.",
        "A leading ~ means only the TLS handshake completed and the host did not answer in HTTP. That is a lower bound, not a full request time.",
        "With SOCKS5 the isolated browser goes through the proxy, but the plugin's own requests for a login link or a text message still leave through magpie's exit. Use an HTTP or HTTPS proxy when the whole flow must share one exit.",
      ] },
      { t: "note", text: "The Score column is the Claude Trust Score from the third-party site ip.net.coffee. It is not a score of our own, and it is a different thing from the A–D verdict on the Accounts tab. Scoring opens a browser window and leaves it open after the number is read so you can look at the page." },
    ],
  },
  {
    n: "04",
    title: "Sign in to a provider",
    lead: "Back on the Providers tab, find the service you want and press Add account on its card.",
    blocks: [
      { t: "ol", items: [
        "Choose a Proxy IP. It starts on No proxy (direct), and exits this provider has not used yet are listed first.",
        "If the service offers more than one login method, pick the right one first — the wrong one signs you in to a different site.",
        "Some methods ask for a few details before they start, such as a team site, a dedicated domain or a key. Fill them in as prompted.",
        "Press Start sign-in. An isolated browser window opens; finish signing in there.",
        "You are done when it reads Signed in. The credential was written to magpie.",
      ] },
      { t: "terms", items: [
        { k: "Device code", v: "The window shows a code; confirm that code on the page." },
        { k: "Text-message code", v: "No browser opens. Type the code you received into the dialog and press Submit code." },
        { k: "magpie's own providers", v: "These use magpie's own sign-in flow and your system browser. The proxy and identity you pick in the dialog do not apply to them." },
      ] },
      { t: "note", text: "If it says the page did not finish loading in time, that is only a warning. The window is still open and you can finish signing in by hand." },
    ],
  },
  {
    n: "05",
    title: "Reading the Accounts tab: one account, one fingerprint",
    lead: "Accounts you signed in appear on the Accounts tab. Each one keeps a fixed browser fingerprint tied to its own profile directory.",
    blocks: [
      { t: "ul", items: [
        "Pinned at … in the Fingerprint column means this identity has not changed since then.",
        "As long as you do not clear the identity, the next sign-in reuses the same fingerprint instead of becoming a new person.",
        "A signed-out account reads Signed out · identity kept, and Sign in again brings it back as the same identity.",
        "Clear identity deletes the fingerprint and the profile directory, so the next sign-in is a brand-new identity. It is only offered for accounts that are signed out.",
        "Last login shows the exit used for that sign-in; a direct one reads Direct.",
      ] },
    ],
  },
  {
    n: "06",
    title: "Is this identity clean? Run an identity check",
    lead: "Press Check on an account row. Clean Login opens the third-party site who.1ms.dog using that account's own fingerprint and reads the site's verdict back.",
    blocks: [
      { t: "ol", items: [
        "Press Check and choose the exit for this check. It may be different from the one used to sign in.",
        "Press Start check and wait for the site to answer.",
        "The result is stored on that account as A, B, C or D.",
      ] },
      { t: "terms", items: [
        { k: "A · Clean", v: "The exit and the identity agree; ready to use." },
        { k: "B · Usable", v: "The site can tell you are on a proxy, but nothing contradicts itself." },
        { k: "C · Change the exit", v: "The identity and the exit do not match; try another exit." },
        { k: "D · Do not use this exit", v: "Several contradictions; change the exit first." },
      ] },
      { t: "note", text: "This is a verdict from the third-party site who.1ms.dog. It is not a provider risk-control conclusion, and it is not a fingerprint score of our own." },
      { t: "ul", items: [
        "The exit you pick here is not recorded as the sign-in exit; it only affects this one check.",
        "A failed or cancelled check never overwrites the previous verdict, and the page says so explicitly.",
        "Only one check runs at a time.",
      ] },
    ],
  },
  {
    n: "07",
    title: "When something gets stuck",
    blocks: [
      { t: "terms", items: [
        { k: "A card has no Add account", v: "It probably comes from magpie's market catalog and its plugin is not installed here yet — the badge reads Not installed. Install the plugin and reload the page." },
        { k: "It says the browser is not installed", v: "Go back to the card at the top of the Providers tab and press Prepare browser." },
        { k: "Sign-in sits at waiting for you", v: "Finish signing in inside the isolated window. If you no longer want it, press Cancel sign-in." },
        { k: "A sign-in is already running", v: "Only one sign-in can run at a time. Finish or cancel the previous one." },
        { k: "A proxy test fails", v: "The message says whether it timed out, refused authentication or refused the tunnel. Check the host, port and credentials first." },
        { k: "The service token expired", v: "Reload this page." },
        { k: "Preparing failed on disk space", v: "Free up disk space and press Retry." },
      ] },
    ],
  },
  {
    n: "08",
    title: "Where your data lives",
    blocks: [
      { t: "ul", items: [
        "Account identities, fingerprints and profile directories are kept on this machine, in this plugin's own data directory.",
        "Proxy passwords are stored on this machine only and are never shown again after saving.",
        "Keys you type into a login method's prompts are not stored and never appear in the status.",
        "Report a problem builds its text on the local service. It contains no accounts, cookies, tokens or proxy credentials, and it only opens GitHub's new-issue page for you — whether to submit is still your decision.",
      ] },
    ],
  },
];

const zhHans = [
  {
    n: "01",
    title: "这个插件帮你做什么",
    lead: "干净登录把「登录」这件事单独关进一个隔离浏览器里：每个账号有自己固定的浏览器指纹，登录走哪个出口由你指定，登录完成后凭据直接写进 magpie。",
    blocks: [
      { t: "ul", items: [
        "供应商：看哪些服务能登录，在卡片上开始登录。",
        "代理 IP：管理登录和后续请求走的出口，并测试它们。",
        "账号：看登录过的每个账号、它保留的指纹，以及第三方站点怎么看这个身份。",
      ] },
      { t: "note", text: "干净登录不替你注册账号，也不绕过任何服务的验证。它只负责让同一个账号始终以同一个身份、从同一个出口出现。" },
    ],
  },
  {
    n: "02",
    title: "第一次使用：先准备登录浏览器",
    lead: "登录不会用你日常那个浏览器。第一次登录前，打开「供应商」页，在顶部的「登录浏览器设置」卡片上点一次「准备浏览器」。",
    blocks: [
      { t: "ol", items: [
        "打开「供应商」tab，找到顶部的「登录浏览器设置」卡片。",
        "看清卡片上的下载大小和可用磁盘空间，然后点「准备浏览器」。",
        "等进度走完、徽标变成「已就绪」。中途可以点「取消」。",
      ] },
      { t: "note", text: "只有你点了按钮才会开始下载。浏览器和指纹模型装在本插件自己的缓存里，不会动你共享的 Camoufox 缓存。没准备好就去登录，会直接告诉你隔离浏览器未安装。" },
    ],
  },
  {
    n: "03",
    title: "加一个代理 IP（想换出口时才需要）",
    lead: "如果你希望某个账号从指定的网络出口登录，先在「代理 IP」页把这条出口加进来。不需要换出口的话可以跳过这一步，登录时选「不使用代理（直连）」。",
    blocks: [
      { t: "ol", items: [
        "点「添加代理」，填名称、类型、地址和端口；代理需要认证时再填用户名和密码。",
        "点「测试连接」。看到「连接正常 · 出口 … · … ms」说明这条出口能用。",
        "点「保存」。",
      ] },
      { t: "ul", items: [
        "支持 HTTP、HTTPS 和 SOCKS5。",
        "密码只保存在本机，保存之后不会再显示；编辑时留空表示保持原来那个。",
        "「测速目标」默认是「通用（出口检测）」：量的是到出口检测服务的往返，并告诉你出口 IP 和地区。",
        "选成某个供应商时，量的是这条代理到该供应商服务器的往返。这里只列出本机已安装插件声明了 API 地址的供应商。",
        "某个供应商没测过就显示空白，绝不会拿别的目标的数字来冒充。",
        "数字前面带「~」表示只完成了 TLS 握手、对方没有用 HTTP 回应。那是个下限，不是完整的请求时间。",
        "用 SOCKS5 时，隔离浏览器会走这条代理，但插件自己取登录链接、发短信的请求仍从 magpie 的出口走。要求全程同一个出口时，请用 HTTP 或 HTTPS 代理。",
      ] },
      { t: "note", text: "列表里的「评分」是第三方站点 ip.net.coffee 给出的 Claude Trust Score，不是我们自己打的分，和「账号」页的 A–D 判定是两回事。评分会打开一个浏览器窗口，读完分数后窗口会留着给你看。" },
    ],
  },
  {
    n: "04",
    title: "给供应商添加账号",
    lead: "回到「供应商」页，找到你要登录的服务，点卡片上的「添加账号」。",
    blocks: [
      { t: "ol", items: [
        "选「代理 IP」。默认是「不使用代理（直连）」，这个供应商还没用过的出口会排在前面。",
        "如果这个服务提供了多个登录方式，先选对那一个——选错会登录到别的站点。",
        "有些方式在开始前要填几项信息，例如团队站点、专属域名或密钥，按提示填完。",
        "点「开始登录」。会弹出一个隔离浏览器窗口，在里面把登录做完。",
        "看到「登录完成，凭据已写入 magpie。」就成功了。",
      ] },
      { t: "terms", items: [
        { k: "设备码", v: "窗口里会显示一个代码，照着在页面上确认。" },
        { k: "短信验证码", v: "不会开浏览器。把收到的验证码填进对话框，点「提交验证码」。" },
        { k: "magpie 自带的供应商", v: "走 magpie 自己的登录流程和你的系统浏览器，对话框里选的代理和身份对它不生效。" },
      ] },
      { t: "note", text: "如果提示页面未在限定时间内加载完成，那只是警告。窗口还开着，你仍然可以手动把登录做完。" },
    ],
  },
  {
    n: "05",
    title: "看懂「账号」页：一个账号，一个指纹",
    lead: "登录成功的账号会出现在「账号」页。每个账号都保留一个固定的浏览器指纹，和它自己的配置目录绑在一起。",
    blocks: [
      { t: "ul", items: [
        "「指纹」列写着「固定于 …」，表示这个身份从那时起就没变过。",
        "只要不清除身份，下次登录会沿用同一个指纹，不会变成一个新的人。",
        "已登出的账号显示「已登出 · 保留身份」，点「重新登录」就能用原来的身份回来。",
        "「清除身份」会删掉指纹和配置目录，下次登录就是一个全新身份；只有已登出的账号才有这个操作。",
        "「上次登录」显示的是那次登录用的出口，直连会写「直连」。",
      ] },
    ],
  },
  {
    n: "06",
    title: "这个身份干不干净？做一次身份检测",
    lead: "在账号那一行点「检测」。干净登录会用这个账号自己的指纹打开第三方站点 who.1ms.dog，把站点的判定读回来。",
    blocks: [
      { t: "ol", items: [
        "点「检测」，选这次检测要用的出口，可以和登录时用的不一样。",
        "点「开始检测」，等站点给出判定。",
        "结果会以 A、B、C、D 记在这个账号上。",
      ] },
      { t: "terms", items: [
        { k: "A · 干净", v: "出口和身份对得上，可以拿去用。" },
        { k: "B · 可用", v: "站点看得出你走了一条代理，但没有自相矛盾。" },
        { k: "C · 建议换出口", v: "身份和出口对不上，换一个出口再测。" },
        { k: "D · 不要用这个出口", v: "多处矛盾，先换成别的出口。" },
      ] },
      { t: "note", text: "这是第三方站点 who.1ms.dog 的判定，不等于供应商风控结论，也不是我们自建的指纹评分。" },
      { t: "ul", items: [
        "这里选的出口不会被记录成登录出口，它只影响这一次检测。",
        "检测失败或取消不会覆盖上一次的判定，页面会明确告诉你没有产生新判定。",
        "同一时间只能跑一个检测。",
      ] },
    ],
  },
  {
    n: "07",
    title: "卡住了怎么办",
    blocks: [
      { t: "terms", items: [
        { k: "卡片上没有「添加账号」", v: "这张卡多半来自 magpie 市场目录，本机还没装对应插件，徽标会写「未安装」。装好插件后重新加载页面。" },
        { k: "提示隔离浏览器未安装", v: "回到「供应商」页顶部的卡片，点「准备浏览器」。" },
        { k: "登录一直停在等待你完成", v: "去那个隔离窗口里把登录做完；不想要了就点「取消登录」。" },
        { k: "提示已有登录正在进行", v: "同一时间只能有一个登录流程，先完成或取消上一个。" },
        { k: "代理测试失败", v: "提示会说明是超时、认证失败还是隧道被拒。先确认地址、端口和账号密码。" },
        { k: "提示本地服务令牌已失效", v: "重新加载这个页面。" },
        { k: "准备浏览器时磁盘不足", v: "清理出磁盘空间后点「重试」。" },
      ] },
    ],
  },
  {
    n: "08",
    title: "你的数据放在哪里",
    blocks: [
      { t: "ul", items: [
        "账号身份、指纹和配置目录都保存在本机、本插件自己的数据目录里。",
        "代理密码只保存在本机，保存之后不再显示。",
        "登录方式里临时填写的密钥不会被保存，也不会出现在状态里。",
        "点「报告问题」时，正文由本地服务生成，不含账号、cookie、令牌或代理凭据；它只帮你打开 GitHub 的新建 issue 页面，要不要提交仍然由你决定。",
      ] },
    ],
  },
];

const zhHant = [
  {
    n: "01",
    title: "這個外掛幫你做什麼",
    lead: "乾淨登入把「登入」這件事單獨關進一個隔離瀏覽器裡：每個帳號有自己固定的瀏覽器指紋，登入走哪個出口由你指定，登入完成後憑據直接寫進 magpie。",
    blocks: [
      { t: "ul", items: [
        "供應商：看哪些服務能登入，在卡片上開始登入。",
        "代理 IP：管理登入與後續請求走的出口，並測試它們。",
        "帳號：看登入過的每個帳號、它保留的指紋，以及第三方網站怎麼看這個身分。",
      ] },
      { t: "note", text: "乾淨登入不替你註冊帳號，也不繞過任何服務的驗證。它只負責讓同一個帳號始終以同一個身分、從同一個出口出現。" },
    ],
  },
  {
    n: "02",
    title: "第一次使用：先準備登入瀏覽器",
    lead: "登入不會用你日常那個瀏覽器。第一次登入前，打開「供應商」頁，在頂部的「登入瀏覽器設定」卡片上點一次「準備瀏覽器」。",
    blocks: [
      { t: "ol", items: [
        "打開「供應商」tab，找到頂部的「登入瀏覽器設定」卡片。",
        "看清卡片上的下載大小與可用磁碟空間，然後點「準備瀏覽器」。",
        "等進度走完、徽標變成「已就緒」。中途可以點「取消」。",
      ] },
      { t: "note", text: "只有你點了按鈕才會開始下載。瀏覽器與指紋模型裝在本外掛自己的快取裡，不會動你共享的 Camoufox 快取。沒準備好就去登入，會直接告訴你隔離瀏覽器未安裝。" },
    ],
  },
  {
    n: "03",
    title: "加一個代理 IP（想換出口時才需要）",
    lead: "如果你希望某個帳號從指定的網路出口登入，先在「代理 IP」頁把這條出口加進來。不需要換出口的話可以跳過這一步，登入時選「不使用代理（直連）」。",
    blocks: [
      { t: "ol", items: [
        "點「新增代理」，填名稱、類型、位址與連接埠；代理需要驗證時再填使用者名稱和密碼。",
        "點「測試連線」。看到「連線正常 · 出口 … · … ms」說明這條出口能用。",
        "點「儲存」。",
      ] },
      { t: "ul", items: [
        "支援 HTTP、HTTPS 與 SOCKS5。",
        "密碼只儲存在本機，儲存之後不會再顯示；編輯時留空表示保持原來那個。",
        "「測速目標」預設是「通用（出口檢測）」：量的是到出口檢測服務的往返，並告訴你出口 IP 與地區。",
        "選成某個供應商時，量的是這條代理到該供應商伺服器的往返。這裡只列出本機已安裝外掛宣告了 API 位址的供應商。",
        "某個供應商沒測過就顯示空白，絕不會拿別的目標的數字來冒充。",
        "數字前面帶「~」表示只完成了 TLS 握手、對方沒有用 HTTP 回應。那是個下限，不是完整的請求時間。",
        "用 SOCKS5 時，隔離瀏覽器會走這條代理，但外掛自己取登入連結、發簡訊的請求仍從 magpie 的出口走。要求全程同一個出口時，請用 HTTP 或 HTTPS 代理。",
      ] },
      { t: "note", text: "列表裡的「評分」是第三方網站 ip.net.coffee 給出的 Claude Trust Score，不是我們自己打的分，和「帳號」頁的 A–D 判定是兩回事。評分會打開一個瀏覽器視窗，讀完分數後視窗會留著給你看。" },
    ],
  },
  {
    n: "04",
    title: "為供應商新增帳號",
    lead: "回到「供應商」頁，找到你要登入的服務，點卡片上的「新增帳號」。",
    blocks: [
      { t: "ol", items: [
        "選「代理 IP」。預設是「不使用代理（直連）」，這個供應商還沒用過的出口會排在前面。",
        "如果這個服務提供了多個登入方式，先選對那一個——選錯會登入到別的網站。",
        "有些方式在開始前要填幾項資訊，例如團隊網站、專屬網域或金鑰，按提示填完。",
        "點「開始登入」。會彈出一個隔離瀏覽器視窗，在裡面把登入做完。",
        "看到「登入完成，憑證已寫入 magpie。」就成功了。",
      ] },
      { t: "terms", items: [
        { k: "裝置碼", v: "視窗裡會顯示一個代碼，照著在頁面上確認。" },
        { k: "簡訊驗證碼", v: "不會開瀏覽器。把收到的驗證碼填進對話框，點「提交驗證碼」。" },
        { k: "magpie 自帶的供應商", v: "走 magpie 自己的登入流程與你的系統瀏覽器，對話框裡選的代理與身分對它不生效。" },
      ] },
      { t: "note", text: "如果提示頁面未在限定時間內載入完成，那只是警告。視窗還開著，你仍然可以手動把登入做完。" },
    ],
  },
  {
    n: "05",
    title: "看懂「帳號」頁：一個帳號，一個指紋",
    lead: "登入成功的帳號會出現在「帳號」頁。每個帳號都保留一個固定的瀏覽器指紋，和它自己的設定目錄綁在一起。",
    blocks: [
      { t: "ul", items: [
        "「指紋」欄寫著「固定於 …」，表示這個身分從那時起就沒變過。",
        "只要不清除身分，下次登入會沿用同一個指紋，不會變成一個新的人。",
        "已登出的帳號顯示「已登出 · 保留身分」，點「重新登入」就能用原來的身分回來。",
        "「清除身分」會刪掉指紋與設定目錄，下次登入就是一個全新身分；只有已登出的帳號才有這個操作。",
        "「上次登入」顯示的是那次登入用的出口，直連會寫「直連」。",
      ] },
    ],
  },
  {
    n: "06",
    title: "這個身分乾不乾淨？做一次身分檢測",
    lead: "在帳號那一列點「檢測」。乾淨登入會用這個帳號自己的指紋打開第三方網站 who.1ms.dog，把網站的判定讀回來。",
    blocks: [
      { t: "ol", items: [
        "點「檢測」，選這次檢測要用的出口，可以和登入時用的不一樣。",
        "點「開始檢測」，等網站給出判定。",
        "結果會以 A、B、C、D 記在這個帳號上。",
      ] },
      { t: "terms", items: [
        { k: "A · 乾淨", v: "出口和身分對得上，可以拿去用。" },
        { k: "B · 可用", v: "網站看得出你走了一條代理，但沒有自相矛盾。" },
        { k: "C · 建議換出口", v: "身分和出口對不上，換一個出口再測。" },
        { k: "D · 不要用這個出口", v: "多處矛盾，先換成別的出口。" },
      ] },
      { t: "note", text: "這是第三方站點 who.1ms.dog 的判定，不等於供應商風控結論，也不是我們自建的指紋評分。" },
      { t: "ul", items: [
        "這裡選的出口不會被記錄成登入出口，它只影響這一次檢測。",
        "檢測失敗或取消不會覆蓋上一次的判定，頁面會明確告訴你沒有產生新判定。",
        "同一時間只能跑一個檢測。",
      ] },
    ],
  },
  {
    n: "07",
    title: "卡住了怎麼辦",
    blocks: [
      { t: "terms", items: [
        { k: "卡片上沒有「新增帳號」", v: "這張卡多半來自 magpie 市場目錄，本機還沒裝對應外掛，徽標會寫「未安裝」。裝好外掛後重新載入頁面。" },
        { k: "提示隔離瀏覽器未安裝", v: "回到「供應商」頁頂部的卡片，點「準備瀏覽器」。" },
        { k: "登入一直停在等待你完成", v: "去那個隔離視窗裡把登入做完；不想要了就點「取消登入」。" },
        { k: "提示已有登入正在進行", v: "同一時間只能有一個登入流程，先完成或取消上一個。" },
        { k: "代理測試失敗", v: "提示會說明是逾時、驗證失敗還是隧道被拒。先確認位址、連接埠與帳號密碼。" },
        { k: "提示本機服務權杖已失效", v: "重新載入這個頁面。" },
        { k: "準備瀏覽器時磁碟不足", v: "清出磁碟空間後點「重試」。" },
      ] },
    ],
  },
  {
    n: "08",
    title: "你的資料放在哪裡",
    blocks: [
      { t: "ul", items: [
        "帳號身分、指紋與設定目錄都儲存在本機、本外掛自己的資料目錄裡。",
        "代理密碼只儲存在本機，儲存之後不再顯示。",
        "登入方式裡臨時填寫的金鑰不會被儲存，也不會出現在狀態裡。",
        "點「回報問題」時，正文由本機服務產生，不含帳號、cookie、權杖或代理憑據；它只幫你打開 GitHub 的新建 issue 頁面，要不要提交仍然由你決定。",
      ] },
    ],
  },
];

const ja = [
  {
    n: "01",
    title: "このプラグインができること",
    lead: "Clean Login はログインを専用の隔離ブラウザーに閉じ込めます。アカウントごとに固定のブラウザ指紋を持ち、どの出口からログインするかはあなたが選び、完了すると認証情報がそのまま magpie に書き込まれます。",
    blocks: [
      { t: "ul", items: [
        "プロバイダー — ログインできるサービスを確認し、カードからログインを開始します。",
        "プロキシ IP — ログインと以後のリクエストが通る出口を管理し、テストします。",
        "アカウント — ログイン済みの各アカウント、保持している指紋、サードパーティサイトがその身分をどう見るかを確認します。",
      ] },
      { t: "note", text: "Clean Login はアカウントの登録を代行せず、どのサービスの検証も回避しません。同じアカウントが常に同じ身分・同じ出口から現れるようにするだけです。" },
    ],
  },
  {
    n: "02",
    title: "初回: ログイン用ブラウザーを準備する",
    lead: "ログインに普段のブラウザーは使いません。最初のログインの前に「プロバイダー」タブを開き、上部の「ログイン用ブラウザーの準備」カードで「ブラウザーを準備」を一度押してください。",
    blocks: [
      { t: "ol", items: [
        "「プロバイダー」タブを開き、上部の「ログイン用ブラウザーの準備」カードを探します。",
        "カードに表示されるダウンロードサイズと空きディスク容量を確認し、「ブラウザーを準備」を押します。",
        "進捗が終わり、バッジが「準備完了」になるまで待ちます。途中で「キャンセル」も押せます。",
      ] },
      { t: "note", text: "ボタンを押すまでダウンロードは始まりません。ブラウザーと指紋モデルは本プラグイン専用のキャッシュに入り、共有の Camoufox キャッシュには触れません。準備前にログインしようとすると、隔離ブラウザーがないと表示されます。" },
    ],
  },
  {
    n: "03",
    title: "プロキシ IP を追加する（出口を変えたいときだけ）",
    lead: "特定のネットワーク出口からログインさせたい場合は、まず「プロキシ IP」タブでその出口を追加します。変える必要がなければこの手順は飛ばし、ログイン時に「プロキシを使用しない（直接接続）」を選んでください。",
    blocks: [
      { t: "ol", items: [
        "「プロキシを追加」を押し、名前・種類・ホスト・ポートを入力します。認証が必要な場合だけユーザー名とパスワードも入力します。",
        "「接続テスト」を押します。「接続正常 · 出口 … · … ms」と出れば、その出口は使えます。",
        "「保存」を押します。",
      ] },
      { t: "ul", items: [
        "HTTP、HTTPS、SOCKS5 に対応しています。",
        "パスワードはこの端末にのみ保存され、保存後は二度と表示されません。編集時に空欄のままにすると保存済みのものが維持されます。",
        "「測定先」の既定は「汎用（出口確認）」です。出口確認サービスまでの往復を測り、出口 IP と地域を返します。",
        "プロバイダーを選ぶと、このプロキシからそのプロバイダーのサーバーまでの往復を測ります。ここには API アドレスを宣言したインストール済みプラグインのプロバイダーだけが並びます。",
        "未測定のプロバイダーは空欄のままで、別の目標の数字を流用することはありません。",
        "数字の前の「~」は TLS ハンドシェイクだけが完了し、相手が HTTP で応答しなかったことを示します。これは下限であって、完全なリクエスト時間ではありません。",
        "SOCKS5 の場合、隔離ブラウザーはプロキシを通りますが、ログインリンクの取得や SMS 送信などプラグイン自身のリクエストは magpie の出口から出ます。全工程を同じ出口にしたい場合は HTTP または HTTPS プロキシを使ってください。",
      ] },
      { t: "note", text: "一覧の「スコア」はサードパーティサイト ip.net.coffee による Claude Trust Score です。自前の採点ではなく、「アカウント」タブの A–D 判定とも別物です。採点はブラウザーの窓を開き、数値を読んだ後もページを見られるよう窓を開いたままにします。" },
    ],
  },
  {
    n: "04",
    title: "プロバイダーにアカウントを追加する",
    lead: "「プロバイダー」タブに戻り、ログインしたいサービスを見つけて、カードの「アカウントを追加」を押します。",
    blocks: [
      { t: "ol", items: [
        "「プロキシ IP」を選びます。既定は「プロキシを使用しない（直接接続）」で、このプロバイダーがまだ使っていない出口が先に並びます。",
        "ログイン方法が複数あるサービスでは、まず正しいものを選んでください。間違えると別のサイトにログインしてしまいます。",
        "方法によっては開始前にいくつかの入力を求めます。チームサイト、専用ドメイン、キーなどを指示どおり入力してください。",
        "「ログインを開始」を押すと隔離ブラウザーの窓が開くので、その中でログインを完了します。",
        "「ログインが完了し、認証情報を magpie に書き込みました。」と出れば成功です。",
      ] },
      { t: "terms", items: [
        { k: "デバイスコード", v: "窓にコードが表示されるので、そのコードをページ上で確認します。" },
        { k: "SMS 認証コード", v: "ブラウザーは開きません。受け取ったコードをダイアログに入力し、「コードを送信」を押します。" },
        { k: "magpie 標準のプロバイダー", v: "magpie 自身のログイン手順とシステムのブラウザーを使います。ダイアログで選んだプロキシや身分は適用されません。" },
      ] },
      { t: "note", text: "ページが時間内に読み込みを終えなかったと表示されても、それは警告にすぎません。窓は開いたままなので、手動でログインを完了できます。" },
    ],
  },
  {
    n: "05",
    title: "「アカウント」タブの見方: 1 アカウント 1 指紋",
    lead: "ログインに成功したアカウントは「アカウント」タブに並びます。それぞれが専用のプロファイルディレクトリに結びついた固定のブラウザ指紋を保持します。",
    blocks: [
      { t: "ul", items: [
        "「指紋」列の「… に固定」は、その時点からこの身分が変わっていないことを示します。",
        "身分を消去しない限り、次のログインでも同じ指紋が再利用され、別人になることはありません。",
        "ログアウト済みのアカウントは「ログアウト済み · 身分を保持」と表示され、「再ログイン」で同じ身分として戻れます。",
        "「身分を消去」は指紋とプロファイルディレクトリを削除するため、次のログインは全く新しい身分になります。この操作はログアウト済みのアカウントにだけ表示されます。",
        "「最終ログイン」にはそのログインで使った出口が表示され、直接接続の場合は「直接接続」と書かれます。",
      ] },
    ],
  },
  {
    n: "06",
    title: "この身分はクリーンか: 身元判定を行う",
    lead: "アカウントの行で「判定」を押します。Clean Login はそのアカウント自身の指紋でサードパーティサイト who.1ms.dog を開き、サイトの判定を読み戻します。",
    blocks: [
      { t: "ol", items: [
        "「判定」を押し、今回の判定に使う出口を選びます。ログイン時と違っていても構いません。",
        "「判定を開始」を押し、サイトが判定を返すまで待ちます。",
        "結果は A・B・C・D としてそのアカウントに記録されます。",
      ] },
      { t: "terms", items: [
        { k: "A · クリーン", v: "出口と身分が一致しており、そのまま使えます。" },
        { k: "B · 使用可", v: "プロキシ経由だとサイトには分かりますが、矛盾はありません。" },
        { k: "C · 出口の変更を推奨", v: "身分と出口が合っていないので、別の出口で測り直してください。" },
        { k: "D · この出口は使わないでください", v: "矛盾が複数あります。まず別の出口に変えてください。" },
      ] },
      { t: "note", text: "これはサードパーティサイト who.1ms.dog の判定であり、プロバイダーのリスク管理結論でも、独自の指紋スコアでもありません。" },
      { t: "ul", items: [
        "ここで選んだ出口はログイン出口として記録されず、今回の判定にだけ影響します。",
        "失敗やキャンセルで前回の判定が上書きされることはなく、ページは新しい判定が出ていないことを明示します。",
        "同時に実行できる判定は 1 つだけです。",
      ] },
    ],
  },
  {
    n: "07",
    title: "詰まったとき",
    blocks: [
      { t: "terms", items: [
        { k: "カードに「アカウントを追加」がない", v: "そのカードは magpie のマーケットカタログ由来で、対応するプラグインがまだ入っていない可能性が高く、バッジは「未インストール」です。プラグインを入れてページを再読み込みしてください。" },
        { k: "隔離ブラウザーがないと出る", v: "「プロバイダー」タブ上部のカードに戻り、「ブラウザーを準備」を押してください。" },
        { k: "ログインが待機のまま進まない", v: "隔離された窓の中でログインを完了してください。不要なら「ログインをキャンセル」を押します。" },
        { k: "すでにログインが進行中と出る", v: "同時に実行できるログインは 1 つだけです。前のものを完了かキャンセルしてください。" },
        { k: "プロキシのテストが失敗する", v: "タイムアウトか、認証拒否か、トンネル拒否かがメッセージに出ます。まずホスト・ポート・認証情報を確認してください。" },
        { k: "ローカルサービスのトークンが無効と出る", v: "このページを再読み込みしてください。" },
        { k: "準備中にディスク不足で失敗する", v: "ディスクを空けてから「再試行」を押してください。" },
      ] },
    ],
  },
  {
    n: "08",
    title: "データの保存先",
    blocks: [
      { t: "ul", items: [
        "アカウントの身分、指紋、プロファイルディレクトリは、この端末の本プラグイン専用データディレクトリに保存されます。",
        "プロキシのパスワードはこの端末にのみ保存され、保存後は表示されません。",
        "ログイン方法の入力欄に一時的に入力したキーは保存されず、状態にも現れません。",
        "「問題を報告」の本文はローカルサービスが生成し、アカウント・cookie・トークン・プロキシの資格情報は含みません。GitHub の新規 issue ページを開くだけで、送信するかどうかはあなたが決めます。",
      ] },
    ],
  },
];

export const GUIDE = Object.freeze({
  en,
  "zh-Hans": zhHans,
  "zh-Hant": zhHant,
  ja,
});

// An unknown language falls back to English, exactly like messages does.
export function guideSections(langKey) {
  return GUIDE[langKey] || GUIDE.en;
}