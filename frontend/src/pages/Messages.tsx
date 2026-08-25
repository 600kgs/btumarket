import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { API, authFetch, wsUrl, formatErrorDetail } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { usePageTitle } from "../lib/usePageTitle";
import { usePolling } from "../lib/usePolling";
import { relativeTime, truncate } from "../lib/utils";
import "./Messages.css";

interface Conversation {
  listing_id: number;
  peer: string;
  // null when the listing has been deleted - shown as a translated label.
  listing_title: string | null;
  last_message: string;
  last_at: string;
  unread: number;
}

interface Message {
  id: number;
  sender: string;
  body: string;
  created_at: string;
}

// Small tolerance since exact pixel equality is unreliable across
// browsers/zoom levels - "close enough to the bottom" still counts.
function isNearBottom(box: HTMLElement): boolean {
  return box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
}

export default function Messages() {
  const { t } = useTranslation();
  usePageTitle("page_title_messages");
  const navigate = useNavigate();
  const { token, username } = useAuth();
  const [params, setParams] = useSearchParams();

  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [activeListingId, setActiveListingId] = useState<number | null>(null);
  const [activePeer, setActivePeer] = useState<string | null>(null);
  const [activeListingTitle, setActiveListingTitle] = useState("");
  // deleted listing: show a translated label, no link to a dead page
  const [activeListingDeleted, setActiveListingDeleted] = useState(false);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [composeText, setComposeText] = useState("");
  const [sending, setSending] = useState(false);
  // Everyone this account has blocked - drives the thread header's
  // Block/Unblock toggle. Loaded once; toggling updates it locally.
  const [blockedPeers, setBlockedPeers] = useState<Set<string>>(new Set());
  // Live push connection - both polling intervals below fall back to real
  // polling (their original 10s/4s intervals) only while this is false, so
  // a dropped/reconnecting socket never leaves the UI silently stale.
  const [wsConnected, setWsConnected] = useState(false);

  const threadBoxRef = useRef<HTMLDivElement>(null);
  const composeInputRef = useRef<HTMLTextAreaElement>(null);
  const lastRenderedCountRef = useRef(-1);
  const wasAtBottomRef = useRef(true);
  // The websocket's onmessage closure is created once (effect deps: just
  // [token]) and would otherwise only ever see the activeListingId/activePeer
  // values from that first render - these refs give it a way to read the
  // current values without needing to reconnect the socket every time the
  // open thread changes.
  const activeListingIdRef = useRef<number | null>(null);
  const activePeerRef = useRef<string | null>(null);
  useEffect(() => {
    activeListingIdRef.current = activeListingId;
    activePeerRef.current = activePeer;
  }, [activeListingId, activePeer]);

  useEffect(() => {
    if (!token) {
      navigate("/login?reason=login_required&next=" + encodeURIComponent("/messages" + window.location.search));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function loadConversations() {
    const res = await authFetch(`${API}/conversations`);
    const data = await res.json();
    setConversations(data.conversations || []);
  }

  // Fallback poll - only runs while the live push socket is down, and (via
  // usePolling) only while the tab is actually visible.
  usePolling(loadConversations, 10000, !wsConnected);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await authFetch(`${API}/me/blocks`);
        if (res.ok) setBlockedPeers(new Set((await res.json()).blocked || []));
      } catch {
        // header just shows "Block" until a toggle refreshes the truth
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function toggleBlock() {
    if (activePeer === null) return;
    const isBlocked = blockedPeers.has(activePeer);
    if (!isBlocked && !confirm(t("confirm_block", { name: activePeer }))) return;
    const res = await authFetch(`${API}/users/${encodeURIComponent(activePeer)}/block`, {
      method: isBlocked ? "DELETE" : "POST",
    });
    if (res.ok) {
      setBlockedPeers((prev) => {
        const next = new Set(prev);
        if (isBlocked) next.delete(activePeer);
        else next.add(activePeer);
        return next;
      });
    }
  }

  // Delete the conversation from THIS user's inbox only (the backend keeps the
  // messages so the other person's thread is untouched, and it reappears here
  // if they message again).
  async function handleDeleteConversation() {
    if (activeListingId === null || activePeer === null) return;
    if (!confirm(t("confirm_delete_convo"))) return;
    const res = await authFetch(
      `${API}/conversations/${activeListingId}?peer=${encodeURIComponent(activePeer)}`,
      { method: "DELETE" },
    );
    if (res.ok) {
      const gone = { id: activeListingId, peer: activePeer };
      setConversations((prev) =>
        prev ? prev.filter((c) => !(c.listing_id === gone.id && c.peer === gone.peer)) : prev,
      );
      clearActiveThread();
    }
  }

  function openThread(listingId: number, peer: string, listingTitle: string | null) {
    setActiveListingId(listingId);
    setActivePeer(peer);
    setActiveListingDeleted(listingTitle === null);
    setActiveListingTitle(listingTitle || "");
    setMessages(null);
    lastRenderedCountRef.current = -1;

    const next = new URLSearchParams(params);
    next.set("listing_id", String(listingId));
    next.set("to", peer);
    // Push (not replace) so the phone/browser Back button returns to the
    // conversation list instead of leaving /messages entirely.
    setParams(next, { replace: false });

    loadConversations(); // clears the unread badge for this convo
  }

  // Closes the thread by dropping the ids from the URL rather than going
  // back. Deleting cannot use history: there may be nothing to go back to
  // (arriving from a listing's "message seller" link, or reloading), which
  // left the conversation on screen after it had gone from the list - and
  // even with an entry to pop, "back" would return to the listing rather
  // than the conversation list, which is where a deleted thread belongs.
  function clearActiveThread() {
    const next = new URLSearchParams(params);
    next.delete("listing_id");
    next.delete("to");
    setParams(next, { replace: true });
  }

  function closeThread() {
    // Pop the pushed thread entry so the in-app back arrow and the phone's
    // back button both land on the conversation list; the params-sync effect
    // clears the active thread once the URL loses the ids.
    navigate(-1);
  }

  async function loadThread(listingId: number, peer: string) {
    const res = await authFetch(`${API}/messages/${listingId}?peer=${encodeURIComponent(peer)}`);
    const data = await res.json();
    const msgs: Message[] = data.messages || [];

    // Only re-render (and re-scroll) when something actually changed.
    if (msgs.length === lastRenderedCountRef.current) return;
    lastRenderedCountRef.current = msgs.length;

    if (threadBoxRef.current) {
      wasAtBottomRef.current = isNearBottom(threadBoxRef.current);
    }
    setMessages(msgs);
  }

  // Load immediately when switching threads, on top of the polling below
  // (which only re-fires on its own schedule, not on every id change).
  useEffect(() => {
    if (activeListingId === null || activePeer === null) return;
    loadThread(activeListingId, activePeer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeListingId, activePeer]);

  // Fallback poll - only runs while the live push socket is down and a
  // thread is open, and (via usePolling) only while the tab is visible.
  usePolling(
    () => {
      if (activeListingId !== null && activePeer !== null) loadThread(activeListingId, activePeer);
    },
    4000,
    activeListingId !== null && activePeer !== null && !wsConnected,
  );

  // Live push connection: one socket per session (not per open conversation)
  // authenticated via a first-message handshake (a query-param token would
  // leak into Caddy's access logs and browser history). Reconnects with a
  // fixed backoff on drop; the two polling effects above take over again
  // automatically whenever wsConnected is false, so a slow-to-reconnect
  // socket never leaves the UI silently stale.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;

    function connect() {
      if (cancelled) return;
      ws = new WebSocket(wsUrl("/ws/chat"));

      ws.onopen = () => {
        ws?.send(JSON.stringify({ type: "auth", token }));
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        let data: { type?: string };
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
        if (data.type !== "new_message") return;
        loadConversations();
        if (activeListingIdRef.current !== null && activePeerRef.current !== null) {
          loadThread(activeListingIdRef.current, activePeerRef.current);
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (!cancelled) {
          reconnectTimer = window.setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => {
        ws?.close();
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      ws?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Only follow new messages to the bottom if that's where the user already
  // was - otherwise a message arriving while they're scrolled up reading
  // history would yank them back down.
  useEffect(() => {
    if (threadBoxRef.current && wasAtBottomRef.current) {
      threadBoxRef.current.scrollTop = threadBoxRef.current.scrollHeight;
    }
  }, [messages]);

  // Desktop-only autofocus. On touch devices a programmatic focus() is
  // worse than useless: it doesn't open the keyboard, but it does mark the
  // field as already-focused, so the user's actual tap gets ignored and the
  // keyboard never shows (seen in Instagram's in-app browser).
  useEffect(() => {
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      composeInputRef.current?.focus();
    }
  }, [activeListingId]);

  // Grow the compose box with its content, up to ~4 lines, instead of
  // scrolling inside a fixed single-line box.
  useEffect(() => {
    const el = composeInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight + 2, 120) + "px";
  }, [composeText, activeListingId]);

  // The open thread is driven by the URL (?listing_id=..&to=..), so the phone
  // and browser back/forward buttons move between the conversation list and an
  // open thread instead of jumping out of /messages. openThread pushes those
  // params; this effect reconciles the active-thread state whenever the URL
  // changes - back removes the ids (show the list), a deep link supplies them
  // (open that thread).
  useEffect(() => {
    const listingId = parseInt(params.get("listing_id") || "", 10);
    const to = params.get("to");
    if (listingId && to) {
      if (listingId !== activeListingIdRef.current || to !== activePeerRef.current) {
        setActiveListingId(listingId);
        setActivePeer(to);
        setMessages(null);
        lastRenderedCountRef.current = -1;
        // Title isn't in the URL - fetch it (covers a direct deep link; a
        // tapped conversation already set it via openThread, and this branch
        // no-ops there because the ids already match). Reset first so a failed
        // fetch never leaves the PREVIOUS thread's title showing, and treat a
        // 404 as a deleted listing rather than a stale/blank title.
        setActiveListingTitle("");
        setActiveListingDeleted(false);
        (async () => {
          try {
            const res = await fetch(`${API}/listings/${listingId}`);
            if (res.ok) {
              setActiveListingTitle((await res.json()).title);
            } else if (res.status === 404) {
              setActiveListingDeleted(true);
            }
          } catch {
            /* header shows an empty title until the messages load */
          }
        })();
      }
    } else if (activeListingIdRef.current !== null) {
      setActiveListingId(null);
      setActivePeer(null);
      // and everything that belonged to it, or the messages linger behind
      // the closed thread and flash when the next one opens
      setMessages(null);
      setActiveListingTitle("");
      setActiveListingDeleted(false);
      lastRenderedCountRef.current = -1;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  async function sendMessage() {
    const body = composeText.trim();
    if (!body || sending || activeListingId === null || activePeer === null) return;

    setSending(true);
    const res = await authFetch(`${API}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listing_id: activeListingId, recipient: activePeer, body }),
    });
    setSending(false);

    if (res.ok) {
      setComposeText("");
      lastRenderedCountRef.current = -1; // force re-render with the new message
      loadThread(activeListingId, activePeer);
      loadConversations();
    } else {
      const data = await res.json().catch(() => null);
      // Deliberately the same neutral message whichever side blocked whom -
      // the backend won't say either (revealing it invites retaliation).
      if (data?.detail === "messaging_unavailable") {
        alert(t("messaging_unavailable"));
      } else {
        alert(formatErrorDetail(data, t("msg_send_failed")));
      }
    }
  }

  // Pins the chat to the *visible* viewport, which is what keeps the compose
  // box sitting on top of the on-screen keyboard.
  //
  // Two values are needed, not one. --vvh is the visible height (shrinks when
  // the keyboard opens). --vvtop is visualViewport.offsetTop: iOS, and every
  // in-app webview built on it (Instagram, Facebook), doesn't shrink the
  // layout viewport for the keyboard - it scrolls the visual viewport down
  // inside it. Tracking height alone leaves the panel drawn in the region the
  // keyboard now covers, which is exactly how the compose box went missing
  // there. Messages.css positions the body at --vvtop with height --vvh, so
  // the layout always lands on the region the user can actually see.
  //
  // Not using the interactive-widget=resizes-content viewport hint: it's
  // Chrome-only and made Chrome's native resize fight this math.
  useEffect(() => {
    // App-like locked layout while on this page: no page scroll, footer
    // hidden (Messages.css).
    document.body.classList.add("chat-page");

    function updateViewport() {
      const vv = window.visualViewport;
      const vh = vv ? vv.height : window.innerHeight;
      const top = vv ? vv.offsetTop : 0;

      // While the height is a guess - an in-app browser that reports no
      // keyboard, see lib/keyboard.ts - only a real shrink may replace it.
      // These browsers still fire a scroll as the keyboard finishes
      // animating, and it reports the full height; taking that at face value
      // wiped the guess and dropped the composer back behind the keyboard,
      // which is why a first tap failed and a second one worked.
      if (document.body.classList.contains("kb-guess") && vh > window.innerHeight - 80) {
        document.documentElement.style.setProperty("--vvtop", `${top}px`);
        return;
      }

      const box = threadBoxRef.current;
      const wasAtBottom = box ? isNearBottom(box) : true;
      document.documentElement.style.setProperty("--vvh", `${vh}px`);
      document.documentElement.style.setProperty("--vvtop", `${top}px`);
      if (box && wasAtBottom) box.scrollTop = box.scrollHeight;
    }

    updateViewport();
    const vv = window.visualViewport;
    if (vv) {
      // scroll matters as much as resize here: on iOS the keyboard changes
      // offsetTop without necessarily firing resize
      vv.addEventListener("resize", updateViewport);
      vv.addEventListener("scroll", updateViewport);
    } else {
      window.addEventListener("resize", updateViewport);
    }

    return () => {
      if (vv) {
        vv.removeEventListener("resize", updateViewport);
        vv.removeEventListener("scroll", updateViewport);
      } else {
        window.removeEventListener("resize", updateViewport);
      }
      document.documentElement.style.removeProperty("--vvh");
      document.documentElement.style.removeProperty("--vvtop");
      document.body.classList.remove("chat-page");
    };
  }, []);

  function handleComposeFocus() {
    // Making room for the keyboard is handled globally (lib/keyboard.ts).
    // All that's left here is keeping the newest message in view once the
    // panel has finished resizing around it.
    setTimeout(() => {
      const box = threadBoxRef.current;
      if (box) box.scrollTop = box.scrollHeight;
    }, 400);
  }

  // The bar around the message box - 12px above and below it, 14px at the
  // left edge (Messages.css) - belongs to this div, and a div cannot take
  // focus. A tap landing there, which a fingertip does easily on a strip
  // that reads as part of the input, did nothing at all, and closed the
  // keyboard if it was already open. So hand those taps to the field the
  // user was aiming at. preventDefault is the half that matters: without
  // it the browser still treats the tap as one that left the field and
  // dismisses the keyboard on the way.
  //
  // Only taps on the bar itself - the textarea and the send button are
  // reached through their own handlers and must keep their behaviour.
  function handleComposeBarPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    composeInputRef.current?.focus();
  }

  function handleComposeKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div className="chat-shell">
      <div className={`chat-panel${activeListingId !== null ? " thread-open" : ""}`}>
        <div className="convo-list">
          <div className="convo-list-header">{t("nav_messages")}</div>
          <div>
            {conversations === null ? (
              <div className="convo-empty">{t("loading")}</div>
            ) : conversations.length === 0 ? (
              <div className="convo-empty">
                {t("msg_empty_1")}
                <br />
                {t("msg_empty_2")}
                <br />
                <a href="/">{t("msg_browse_link")}</a>
              </div>
            ) : (
              conversations.map((c) => {
                const isActive = c.listing_id === activeListingId && c.peer === activePeer;
                const initial = (c.peer || "?").charAt(0).toUpperCase();
                return (
                  <button
                    key={`${c.listing_id}-${c.peer}`}
                    type="button"
                    className={`convo-item${isActive ? " active" : ""}`}
                    onClick={() => openThread(c.listing_id, c.peer, c.listing_title)}
                  >
                    <span className="convo-avatar">{initial}</span>
                    <span className="convo-text">
                      <span className="convo-peer">
                        <span className="convo-peer-name">{c.peer}</span>
                        {c.unread > 0 && !isActive ? (
                          <span className="convo-unread">{c.unread > 9 ? "9+" : c.unread}</span>
                        ) : (
                          <span style={{ fontSize: 11, color: "#b3b3bb", fontWeight: 400, flexShrink: 0 }}>
                            {relativeTime(c.last_at, t)}
                          </span>
                        )}
                      </span>
                      <span className="convo-listing">{c.listing_title ?? t("msg_deleted_listing")}</span>
                      <span className="convo-preview">{truncate(c.last_message, 60)}</span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="thread">
          {activeListingId === null ? (
            <div className="thread-placeholder">{t("msg_pick")}</div>
          ) : (
            <>
              <div className="thread-header">
                <button type="button" className="thread-back" aria-label="Back to conversations" onClick={closeThread}>
                  ←
                </button>
                <div className="thread-title">
                  <div className="thread-peer">{activePeer}</div>
                  {activeListingDeleted ? (
                    <span className="thread-listing-deleted">{t("msg_deleted_listing")}</span>
                  ) : (
                    <a className="thread-listing-link" href={`/listing/${activeListingId}`}>
                      {activeListingTitle} →
                    </a>
                  )}
                </div>
                <button type="button" className="thread-block-btn" onClick={toggleBlock}>
                  {blockedPeers.has(activePeer || "") ? t("btn_unblock") : t("btn_block")}
                </button>
                <button
                  type="button"
                  className="thread-delete-btn"
                  onClick={handleDeleteConversation}
                  aria-label={t("btn_delete_convo")}
                  title={t("btn_delete_convo")}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                    <path d="M10 11v6M14 11v6" />
                  </svg>
                </button>
              </div>

              <div className="thread-messages" ref={threadBoxRef}>
                {messages === null ? null : messages.length === 0 ? (
                  <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13.5, margin: "auto" }}>
                    {t("msg_say_hi", { title: activeListingTitle || t("msg_deleted_listing") })}
                  </div>
                ) : (
                  messages.map((m, i) => (
                    <div
                      key={m.id}
                      className={`bubble ${m.sender === username ? "mine" : "theirs"}`}
                      // Bottom-anchors a short conversation that doesn't
                      // fill the box - no effect once there's enough
                      // content to scroll.
                      style={i === 0 ? { marginTop: "auto" } : undefined}
                    >
                      <span className="bubble-body">{m.body}</span>
                      <div className="bubble-time">{relativeTime(m.created_at, t)}</div>
                    </div>
                  ))
                )}
              </div>

              <div className="compose" onPointerDown={handleComposeBarPointerDown}>
                <textarea
                  ref={composeInputRef}
                  rows={1}
                  value={composeText}
                  onChange={(e) => setComposeText(e.target.value)}
                  onKeyDown={handleComposeKeyDown}
                  onFocus={handleComposeFocus}
                  placeholder={t("msg_placeholder")}
                  maxLength={2000}
                />
                <button type="button" disabled={sending} onClick={sendMessage}>
                  {t("btn_send")}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
