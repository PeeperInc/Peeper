import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import BottomSheet from '../components/BottomSheet';
import SupporterStar from '../components/SupporterStar';
import { avatarUrl } from '../utils/avatarUrl';
import * as api from '../api';
import './GlobalChatScreen.css';

const MUTE_OPTIONS = [
  ['1h', '1 hour'],
  ['6h', '6 hours'],
  ['24h', '24 hours'],
  ['7d', '1 week'],
  ['forever', 'Forever'],
];

function formatMessageTime(value) {
  const date = new Date(Number(value) * 1000);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${day}.${month} ${time}`;
}

function ChatAvatar({ user, size = 34, onClick }) {
  const [failed, setFailed] = useState(false);
  const source = avatarUrl(user.telegram_id);
  const content = source && !failed
    ? <img src={source} alt="" onError={() => setFailed(true)} />
    : <span>🐸</span>;
  return (
    <button
      type="button"
      className="global-chat-avatar"
      style={{ '--chat-avatar-size': `${size}px` }}
      onClick={onClick}
      aria-label={`Open actions for ${user.first_name || 'user'}`}
    >
      {content}
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
          <strong>{target.first_name || 'Peeper player'}</strong>
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
        <strong>Reply to {message.first_name || 'player'}</strong>
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
        <div>
          <span>WORLD CHANNEL</span>
          <h1>Global Chat</h1>
        </div>
        <div className="global-chat-header-rules">
          <strong>50</strong>
          <span>messages</span>
          <b>5s</b>
          <span>slow mode</span>
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
            <article key={message.id} className={`global-chat-message${isMe ? ' is-me' : ''}`}>
              {!isMe && <ChatAvatar user={message} onClick={() => setSelectedUser(message)} />}
              <div className="global-chat-message-body">
                {!isMe && (
                  <button type="button" className="global-chat-author" onClick={() => setSelectedUser(message)}>
                    <span>{message.first_name || 'Peeper player'}</span>
                    <SupporterStar user={message} size={10} />
                    {message.username && <small>@{message.username}</small>}
                  </button>
                )}
                <div className="global-chat-bubble">
                  {message.reply_to_id && message.reply_message && (
                    <div className="global-chat-reply-quote">
                      <strong>{message.reply_first_name || 'Player'}</strong>
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
                  <button type="button" onClick={() => setReplyTo(message)}>Reply</button>
                </div>
              </div>
            </article>
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
            });
            setSelectedUser(null);
          }}
          onMute={handleMute}
        />
      )}
    </main>
  );
}
