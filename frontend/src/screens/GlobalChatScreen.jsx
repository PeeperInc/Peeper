import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import BottomSheet from '../components/BottomSheet';
import SupporterStar from '../components/SupporterStar';
import { ProfileAvatar, ProfileName } from '../components/ProfileCustomization';
import * as api from '../api';
import './GlobalChatScreen.css';

const MUTE_OPTIONS = [
  ['1h', '1 hour'],
  ['6h', '6 hours'],
  ['24h', '24 hours'],
  ['7d', '1 week'],
  ['forever', 'Forever'],
];

function ReplyIcon({ size = 17 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9.5 7 4 12l5.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 12h7.25C16.53 12 20 15.1 20 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function SwipeReplyMessage({ isMe, onReply, children }) {
  const [offset, setOffset] = useState(0);
  const gestureRef = useRef(null);
  const suppressClickRef = useRef(false);

  function resetGesture() {
    gestureRef.current = null;
    setOffset(0);
  }

  function handlePointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      horizontal: false,
    };
  }

  function handlePointerMove(event) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;

    if (!gesture.horizontal) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        resetGesture();
        return;
      }
      if (dx > -8 || Math.abs(dx) < Math.abs(dy) * 1.15) return;
      gesture.horizontal = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }

    event.preventDefault();
    setOffset(Math.min(68, Math.max(0, -dx)));
  }

  function handlePointerEnd(event) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const swipeDistance = Math.max(0, gesture.startX - event.clientX);
    const shouldReply = gesture.horizontal && swipeDistance >= 46;
    suppressClickRef.current = gesture.horizontal;
    window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    resetGesture();
    if (shouldReply) {
      window.Telegram?.WebApp?.HapticFeedback?.selectionChanged?.();
      onReply();
    }
  }

  function handleClickCapture(event) {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div
      className={`global-chat-swipe-shell${isMe ? ' is-me' : ''}${offset > 0 ? ' is-swiping' : ''}${offset >= 46 ? ' is-armed' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={resetGesture}
      onClickCapture={handleClickCapture}
    >
      <span className="global-chat-swipe-action"><ReplyIcon size={18} /></span>
      <article
        className={`global-chat-message${isMe ? ' is-me' : ''}`}
        style={{ transform: `translate3d(${-offset}px, 0, 0)` }}
      >
        {children}
      </article>
    </div>
  );
}

function formatMessageTime(value) {
  const date = new Date(Number(value) * 1000);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${day}.${month} ${time}`;
}

function ChatAvatar({ user, size = 34, onClick }) {
  return (
    <button
      type="button"
      className="global-chat-avatar"
      style={{ '--chat-avatar-size': `${size}px` }}
      onClick={onClick}
      aria-label={`Open actions for ${user.first_name || 'user'}`}
    >
      <ProfileAvatar user={user} size={size} />
    </button>
  );
}

function UserActionsSheet({ target, isAdmin, currentUserId, onClose, onProfile, onGift, onMute }) {
  const [muteOpen, setMuteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const nowTs = Math.floor(Date.now() / 1000);
  const activelyMuted = Boolean(target.mute_user_id)
    && (target.muted_until === null || Number(target.muted_until) > nowTs);

  async function applyMute(duration) {
    if (busy) return;
    setBusy(true);
    try {
      await onMute(duration);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet onClose={busy ? undefined : onClose} zIndex={240} bodyStyle={{ padding: '18px 18px 30px' }}>
      <div className="global-chat-user-sheet-head">
        <ChatAvatar user={target} size={46} />
        <div>
          <ProfileName user={target} as="strong" />
          {target.username && <span>@{target.username}</span>}
        </div>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Close</button>
      </div>

      <div className="global-chat-user-actions">
        <button type="button" onClick={onProfile}>View Profile</button>
        <button type="button" onClick={onGift}>Send Gift</button>
        {isAdmin && target.user_id !== currentUserId && (
          <button type="button" className="danger" onClick={() => setMuteOpen(value => !value)}>
            {activelyMuted ? 'Change Chat Mute' : 'Mute in Global Chat'}
          </button>
        )}
      </div>

      {muteOpen && (
        <div className="global-chat-mute-options">
          <span>Mute duration</span>
          <div>
            {MUTE_OPTIONS.map(([value, label]) => (
              <button type="button" key={value} onClick={() => applyMute(value)} disabled={busy}>{label}</button>
            ))}
            {activelyMuted && (
              <button type="button" className="unmute" onClick={() => applyMute('unmute')} disabled={busy}>Unmute</button>
            )}
          </div>
        </div>
      )}
    </BottomSheet>
  );
}

function ReplyPreview({ message, onCancel }) {
  if (!message) return null;
  return (
    <div className="global-chat-composer-reply">
      <div>
        <strong>Reply to <ProfileName user={message} /></strong>
        <span>{message.message}</span>
      </div>
      <button type="button" onClick={onCancel} aria-label="Cancel reply">×</button>
    </div>
  );
}

export default function GlobalChatScreen({ onViewProfile, onSendGift, onOpenFamily, onUnreadChange }) {
  const { user, showToast } = useApp();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [mute, setMute] = useState(null);
  const [cooldown, setCooldown] = useState(0);
  const [newBelow, setNewBelow] = useState(false);
  const scrollRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const initializedRef = useRef(false);
  const latestMessageIdRef = useRef(0);

  const scrollToBottom = useCallback((behavior = 'smooth') => {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior });
    stickToBottomRef.current = true;
    setNewBelow(false);
  }, []);

  const loadMessages = useCallback(async ({ forceBottom = false } = {}) => {
    try {
      const result = await api.getGlobalMessages();
      const nextMessages = result.messages || [];
      const nextLatestId = Number(nextMessages.at(-1)?.id || 0);
      const hasNewMessages = initializedRef.current && nextLatestId > latestMessageIdRef.current;
      const shouldScroll = forceBottom || !initializedRef.current || stickToBottomRef.current;
      latestMessageIdRef.current = nextLatestId;
      initializedRef.current = true;
      setMessages(nextMessages);
      setIsAdmin(Boolean(result.isAdmin));
      setMute(result.mute || null);
      await api.markGlobalMessagesRead().catch(() => {});
      onUnreadChange?.(0);
      if (hasNewMessages && !shouldScroll) setNewBelow(true);
      if (shouldScroll) window.requestAnimationFrame(() => scrollToBottom(forceBottom ? 'smooth' : 'auto'));
    } catch (error) {
      showToast?.(error.message || 'Could not load Global Chat');
    } finally {
      setLoading(false);
    }
  }, [onUnreadChange, scrollToBottom, showToast]);

  useEffect(() => {
    loadMessages();
    const timer = window.setInterval(() => loadMessages(), 3000);
    return () => window.clearInterval(timer);
  }, [loadMessages]);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = window.setInterval(() => setCooldown(value => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  function handleScroll() {
    const container = scrollRef.current;
    if (!container) return;
    const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
    stickToBottomRef.current = distance < 72;
    if (stickToBottomRef.current) setNewBelow(false);
  }

  async function handleSend() {
    const message = input.trim();
    if (!message || sending || cooldown > 0 || mute) return;
    setSending(true);
    try {
      await api.sendGlobalMessage(message, replyTo?.id || null);
      setInput('');
      setReplyTo(null);
      setCooldown(5);
      stickToBottomRef.current = true;
      await loadMessages({ forceBottom: true });
    } catch (error) {
      if (error.status === 429) setCooldown(Number(error.data?.retryAfter || 5));
      if (error.status === 403) setMute({ mutedUntil: error.data?.mutedUntil ?? null });
      showToast?.(error.message || 'Could not send message');
    } finally {
      setSending(false);
    }
  }

  async function handleMute(duration) {
    try {
      const result = await api.muteGlobalChatUser(selectedUser.user_id, duration);
      showToast?.(result.message);
      await loadMessages();
    } catch (error) {
      showToast?.(error.message || 'Could not update mute');
      throw error;
    }
  }

  const muteCopy = mute
    ? mute.mutedUntil === null
      ? 'You are muted permanently'
      : `Muted until ${formatMessageTime(mute.mutedUntil)}`
    : '';

  return (
    <main className="global-chat-screen">
      <header className="global-chat-header">
        <div className="global-chat-header-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" fill="none">
            <path d="M7 8.5h18v12H14l-5.5 4v-4H7z" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
            <path d="M11 13h10M11 17h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
        <div className="global-chat-header-copy">
          <span>PEEPER NETWORK</span>
          <h1>Global Chat</h1>
        </div>
      </header>

      <section className="global-chat-feed" ref={scrollRef} onScroll={handleScroll}>
        {loading && <div className="global-chat-empty">Opening channel...</div>}
        {!loading && messages.length === 0 && (
          <div className="global-chat-empty"><strong>No messages yet</strong><span>Be the first frog to say hello.</span></div>
        )}
        {messages.map(message => {
          const isMe = Number(message.user_id) === Number(user?.id);
          return (
            <SwipeReplyMessage key={message.id} isMe={isMe} onReply={() => setReplyTo(message)}>
              {!isMe && <ChatAvatar user={message} onClick={() => setSelectedUser(message)} />}
              <div className="global-chat-message-body">
                {!isMe && (
                  <button type="button" className="global-chat-author" onClick={() => setSelectedUser(message)}>
                    <ProfileName user={message} />
                    <SupporterStar user={message} size={10} />
                    {message.username && <small>@{message.username}</small>}
                  </button>
                )}
                <div className="global-chat-bubble">
                  {message.reply_to_id && message.reply_message && (
                    <div className="global-chat-reply-quote">
                      <ProfileName
                        user={{ first_name: message.reply_first_name || 'Player', appearance: message.replyAppearance }}
                        as="strong"
                      />
                      <span>{message.reply_message}</span>
                    </div>
                  )}
                  {message.message_type === 'family_invite' && message.family_id ? (
                    <button
                      type="button"
                      className="global-chat-family-card"
                      onClick={() => onOpenFamily?.({
                        familyId: message.family_id,
                        inviteCode: message.family_invite_code,
                      })}
                    >
                      <span>FAMILY INVITATION</span>
                      <strong>{message.family_name}</strong>
                      <small>{message.family_member_count}/10 members · Open family</small>
                    </button>
                  ) : message.message}
                </div>
                <div className="global-chat-message-meta">
                  <span>{formatMessageTime(message.sent_at)}</span>
                </div>
              </div>
            </SwipeReplyMessage>
          );
        })}
      </section>

      {newBelow && <button type="button" className="global-chat-new" onClick={() => scrollToBottom()}>New messages ↓</button>}

      <footer className="global-chat-composer">
        <ReplyPreview message={replyTo} onCancel={() => setReplyTo(null)} />
        {muteCopy && <div className="global-chat-muted">{muteCopy}</div>}
        <div className="global-chat-composer-row">
          <input
            className="search-input"
            value={input}
            onChange={event => setInput(event.target.value)}
            placeholder={mute ? 'You cannot send messages' : 'Message Global Chat...'}
            maxLength={200}
            disabled={Boolean(mute)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                handleSend();
              }
            }}
          />
          <button type="button" className="btn btn-primary" onClick={handleSend} disabled={!input.trim() || sending || cooldown > 0 || Boolean(mute)}>
            {sending ? '...' : cooldown > 0 ? `${cooldown}s` : 'Send'}
          </button>
        </div>
      </footer>

      {selectedUser && (
        <UserActionsSheet
          target={selectedUser}
          isAdmin={isAdmin}
          currentUserId={user?.id}
          onClose={() => setSelectedUser(null)}
          onProfile={() => { onViewProfile?.(selectedUser.user_id); setSelectedUser(null); }}
          onGift={() => {
            onSendGift?.({
              id: selectedUser.user_id,
              first_name: selectedUser.first_name,
              username: selectedUser.username,
              telegram_id: selectedUser.telegram_id,
              photo_url: selectedUser.photo_url,
              supporter_since: selectedUser.supporter_since,
              supporter_stars: selectedUser.supporter_stars,
              appearance: selectedUser.appearance,
            });
            setSelectedUser(null);
          }}
          onMute={handleMute}
        />
      )}
    </main>
  );
}
