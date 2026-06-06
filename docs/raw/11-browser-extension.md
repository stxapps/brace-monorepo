## foundings

### general

- Use browser.* from WXT, not raw chrome.*. You get Promise-based APIs everywhere and cross-browser compatibility without thinking about it. The only time you'd touch chrome.* directly is for Chrome-specific APIs that don't exist in the standard (rare).

### storage

- In the popup and options pages (which are essentially small web pages), you actually do have access to localStorage and IndexedDB. The catch is that the popup's lifecycle is short — it unmounts when closed — so anything in memory or localStorage scoped to it is fragile. For persistent state that needs to survive popup closes and be accessible from background scripts, browser.storage.local or browser.storage.session is the safer choice. IndexedDB also works in both popup and background contexts if you need to store larger structured data (like a local encrypted bookmark index for search).
- In the background service worker (Manifest V3), there's no DOM, no localStorage. You have browser.storage, IndexedDB, and the Cache API.
- use browser.storage as your primary persistence layer for cross-context state, and IndexedDB if you need richer local querying. localStorage technically works in popups but isn't worth relying on.

### link preview

- The popup can't make arbitrary fetch requests to external sites due to CORS. The background service worker can, since you'll declare host_permissions in your manifest. The typical flow is: popup sends a message to the background worker, background fetches the URL, extracts Open Graph metadata (title, description, image), and sends it back. You could also do this server-side via your Hono API if you prefer — that avoids permission bloat in the extension and gives you caching on R2.


### q1

there are several use cases:

    on active tab, choose the extension button on the top bar to save a link
    on the browser extension page, user saves a link
    on the web app, user saves a link

I think, in the first use case, we can have the link, the html content, the screenshot. The last use case, we have only the link and must delegate to the extension somehow. I'm not sure about the second case.

You are the best tech lead in the world. Please help me design tech of my zero-knowledge bookmark manager web app and browser extension to be the best possible.

Answer:

Case 1: Active tab save — This is your richest context. The user is looking at the page, so you can capture everything immediately. A content script injected into the active tab grabs the full DOM, metadata, and computed styles. The background worker calls captureVisibleTab for the screenshot. Since the tab is already active and focused, there's no disruptive tab-switching. Everything gets encrypted client-side and uploaded. This is the golden path.

Case 2: Extension page save (paste a URL) — This is the interesting middle ground. The user is in your extension's popup or a full-page extension tab, pasting a URL they want to save. The extension can open that URL in a background tab, wait for it to load, inject a content script, capture content and screenshot, then close the tab. It's slightly disruptive (a tab flashes open briefly), but doable. Alternatively, you queue it and process it the same way as Case 3 — but since the extension is clearly active, processing it immediately makes more sense.

Case 3: Web app save — You only have a URL. The browser might not even be open. This is the queue-based flow: save the job to the server, and the extension picks it up when available.

  - the async path - writes a job to a queue and the extension polls
  - the externally_connectable approach - If the extension is active in the browser right now, the web app sends a message directly and gets instant processing. If the sendMessage call fails (extension not installed or browser closed), fall back to enqueueing the job. This gives you the best of both: instant when possible, resilient always.


The login flow would be:

- User enters passphrase in the extension popup (once, on setup)
- Extension derives the encryption key via PBKDF2/Argon2 and stores it in chrome.storage.session
- Extension also authenticates with your Hono API (gets a JWT or session token)
- Both the web app and extension derive the same key from the same passphrase, so they can encrypt/decrypt each other's data


Link preview (metadata extraction) — doesn't need a tab at all.

You can do this entirely in the background service worker with a plain fetch. OG tags, title, description, favicon — it's all in the initial HTML response. No rendering needed, no tab needed.

The only case this fails is when the page requires JavaScript to render its meta tags (rare, but some SPAs do this). For those, you'd fall back to a tab-based approach.

Screenshot

captureVisibleTab requires the tab to be the active tab in its window and the window to be focused. This is the API constraint that forces visibility. Your options:

Case 1 (active tab save): Already perfect — user is looking at the page.
Cases 2 & 3 (extension page / queued): You need to actually show the tab briefly. The least disruptive approach:

```ts
// Create a new window, load the URL, capture, close
const win = await browser.windows.create({
  url,
  focused: true,     // must be focused for capture
  width: 1280,
  height: 960,
  type: 'normal',
})

const tab = win.tabs[0]
await waitForTabComplete(tab.id)
await sleep(500) // let rendering settle

const screenshot = await browser.tabs.captureVisibleTab(
  win.id, 
  { format: 'png' }
)

await browser.windows.remove(win.id)
```

This causes a visible flash — a window opens and closes. There's no way around it with captureVisibleTab. However, there's an alternative worth considering:

The chrome.tabCapture API and the newer chrome.tabs.captureVisibleTab with offscreen documents are evolving, but as of now there's no fully invisible screenshot path in Manifest V3. If the flash is unacceptable for queued jobs, you could batch screenshots during idle time using the chrome.idle API — process the queue only when the user has been away for 60+ seconds, so the flashing window is invisible to them.

Full archive — mostly doesn't need focus, but needs a tab.

The archive (SingleFile-style DOM capture) requires a content script running in a tab, but the tab does not need to be focused or visible. You can:

```ts
// Open tab in background (not active)
const tab = await browser.tabs.create({
  url,
  active: false,    // stays in background
})

await waitForTabComplete(tab.id)

// Inject content script — works on non-focused tabs
const results = await browser.scripting.executeScript({
  target: { tabId: tab.id },
  func: captureFullDOM,
})

const archive = results[0].result
await browser.tabs.remove(tab.id)
```

The content script can access the full DOM, inline styles, serialize everything — all without the tab being visible. The page just needs to have loaded.

My recommendation for the queued job pipeline:

```
1. fetch() metadata         — immediate, no tab
2. Open tab (active: false) — background, no flash
3. Wait for load
4. Inject content script    — capture archive
5. Now focus the tab briefly — capture screenshot
6. Close tab
7. Encrypt all, upload
```

Steps 1–4 are invisible to the user. Only step 5 causes a brief flash. If you batch this during idle time, the user never notices. And if you decide screenshots aren't worth the disruption for queued jobs, you can skip step 5 entirely — you still get metadata and a full archive, which is arguably more valuable than a screenshot anyway.


For your bookmark manager, the architecture maps to:

```
action button click
  → opens popup (React app)
    → user hits "Save"
    → sends message to background worker

background worker
  → receives message
  → injects content script into active tab
  → content script returns DOM + metadata
  → background worker takes screenshot
  → encrypts everything (using key from chrome.storage.session)
  → uploads to Hono API

options page
  → passphrase setup / change
  → account settings
  → key management

popup
  → quick save UI
  → recent bookmarks list
  → search
```

In WXT, these map directly to the file structure:

```
extension/
  entrypoints/
    background.ts          → service worker
    popup/
      App.tsx              → popup React app
      main.tsx
    options/
      App.tsx              → options React app
      main.tsx
    content.ts             → content script (programmatic)
```

The data flow is the same everywhere:

```
User action → encrypt locally → upload to server
Display data → fetch from server → decrypt locally → render
```

Where things get interesting is keeping them in sync. If the user saves a bookmark via the extension, the web app won't know about it until it refetches. A few approaches:

Simple: short staleTime. Set staleTime to 30–60 seconds. Both clients refetch frequently. Good enough for most users.

Better: invalidation via server events. Use a WebSocket or Server-Sent Events from your Hono API. When a new bookmark is saved, the server broadcasts to all connected clients. On receipt, the client invalidates the query:

```
// Shared hook, works in both web app and extension
function useBookmarkSync() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const eventSource = new EventSource('/api/events')
    eventSource.addEventListener('bookmark:created', () => {
      queryClient.invalidateQueries({ queryKey: ['bookmarks'] })
    })
    return () => eventSource.close()
  }, [])
}
```

SSE works in both the web app and the extension's background worker. The background worker can listen for events and update chrome.storage, so even the popup sees fresh data instantly.

Use Tanstack Query's refetchOnWindowFocus: true (it's on by default). Every time the user switches to your web app tab or opens the extension popup, it refetches. Combined with a short staleTime of 30–60 seconds, the data is always fresh enough. Most users won't save a bookmark in the extension and switch to the web app within seconds expecting it to be there.

In the future, When you do need real-time, go with Durable Objects + WebSockets. Durable Objects are designed for exactly this — per-user stateful connections at the edge. The cost is minimal for a bookmark manager's traffic patterns (one Durable Object per user, a handful of connections each). Durable Objects are a Cloudflare product that runs alongside Workers.

Durable Objects are stateful singletons — each one has a unique ID, runs in one location, and can hold state in memory across requests. They also get their own built-in key-value storage that's transactionally consistent. You create and access them from your Workers code, but they're a separate runtime with different characteristics and billing.

ref: https://claude.ai/chat/866cabd6-f41c-440c-a65e-458780ddc3f6
