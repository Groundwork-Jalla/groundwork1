import { useEffect, useRef, useState, useCallback } from 'react';
import type { KeyboardEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, Send } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  fetchMessages,
  sendMessage,
  subscribeToMessages,
  formatRelativeTime,
} from '@/lib/supabase/messages';
import type { ProjectMessageRow } from '@/types/project';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ProjectChatProps {
  projectId: string;
  currentUserId: string;
  currentUserName: string;
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function MessageSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-4" aria-busy="true" aria-label="Loading messages">
      {[false, true, false, true].map((isRight, i) => (
        <div
          key={i}
          className={cn('flex', isRight ? 'justify-end' : 'justify-start')}
        >
          <div
            className={cn(
              'h-8 rounded-2xl animate-pulse bg-brand-light-grey',
              isRight ? 'w-40' : 'w-56',
            )}
          />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Individual message bubble
// ---------------------------------------------------------------------------

interface MessageBubbleProps {
  message: ProjectMessageRow;
  isOwn: boolean;
  showSenderName: boolean;
}

function MessageBubble({ message, isOwn, showSenderName }: MessageBubbleProps) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className={cn('flex w-full', isOwn ? 'justify-end' : 'justify-start')}
    >
      <div className={cn('max-w-[75%] sm:max-w-[65%]', isOwn ? 'items-end' : 'items-start', 'flex flex-col')}>
        {!isOwn && showSenderName && (
          <span className="text-[10px] font-semibold text-brand-mid-grey mb-1 px-1 select-none">
            {message.sender_name}
          </span>
        )}

        <div
          className={cn(
            'px-4 py-2.5 text-sm leading-relaxed break-words',
            isOwn
              ? 'bg-brand-near-black text-white rounded-2xl rounded-br-sm'
              : 'bg-brand-off-white border border-brand-border-grey text-brand-near-black rounded-2xl rounded-bl-sm',
          )}
        >
          {message.content}
        </div>

        <span
          className={cn(
            'text-[10px] text-brand-mid-grey mt-1 px-1 select-none',
            isOwn ? 'text-right' : 'text-left',
          )}
        >
          {formatRelativeTime(message.created_at)}
        </span>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ProjectChat({ projectId, currentUserId, currentUserName }: ProjectChatProps) {
  const [messages, setMessages] = useState<ProjectMessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Scroll to the latest message
  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Fetch on mount + subscribe to realtime
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const rows = await fetchMessages(projectId);
        if (!cancelled) {
          setMessages(rows);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    const unsubscribe = subscribeToMessages(projectId, (msg) => {
      setMessages((prev) => {
        // Avoid duplicates from optimistic updates
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [projectId]);

  // Auto-scroll when messages change
  useEffect(() => {
    if (!loading) scrollToBottom();
  }, [messages, loading, scrollToBottom]);

  // Send handler
  const handleSend = useCallback(async () => {
    const content = inputValue.trim();
    if (!content || sending) return;

    setSending(true);
    setInputValue('');

    // Optimistic: insert a local copy so the sender sees it immediately
    const optimistic: ProjectMessageRow = {
      id: `optimistic-${Date.now()}`,
      project_id: projectId,
      sender_id: currentUserId,
      sender_name: currentUserName,
      content,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);

    try {
      await sendMessage(projectId, currentUserId, currentUserName, content);
    } catch {
      // Roll back optimistic message on error
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setInputValue(content);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [inputValue, sending, projectId, currentUserId, currentUserName]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // Determine whether to show sender name (group consecutive same-sender messages)
  function showSenderName(index: number): boolean {
    if (index === 0) return true;
    return messages[index].sender_id !== messages[index - 1].sender_id;
  }

  return (
    <div className="flex flex-col rounded-xl border border-brand-border-grey bg-white overflow-hidden">
      {/* Message list */}
      <div
        className="flex-1 overflow-y-auto max-h-[480px] sm:max-h-[560px] p-4"
        role="log"
        aria-live="polite"
        aria-label="Project messages"
      >
        {loading ? (
          <MessageSkeleton />
        ) : messages.length === 0 ? (
          <EmptyState
            icon={<MessageSquare size={32} strokeWidth={1.5} />}
            title="No messages yet"
            description="Start a conversation about your project."
          />
        ) : (
          <div className="flex flex-col gap-2">
            <AnimatePresence initial={false}>
              {messages.map((msg, i) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isOwn={msg.sender_id === currentUserId}
                  showSenderName={showSenderName(i)}
                />
              ))}
            </AnimatePresence>
            {/* Invisible anchor for scroll-to-bottom */}
            <div ref={bottomRef} aria-hidden="true" />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="sticky bottom-0 bg-white border-t border-brand-border-grey px-4 py-3">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message..."
            disabled={sending}
            aria-label="Type a message"
            className={cn(
              'flex-1 rounded-xl border border-brand-border-grey bg-brand-off-white',
              'px-4 py-2.5 text-sm font-sans text-brand-near-black placeholder:text-brand-mid-grey',
              'outline-none focus:ring-2 focus:ring-brand-near-black/20 focus:border-brand-near-black/40',
              'transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          />
          <Button
            type="button"
            size="icon"
            variant="default"
            onClick={handleSend}
            disabled={sending || inputValue.trim().length === 0}
            aria-label="Send message"
            className="shrink-0 rounded-xl"
          >
            <Send size={16} strokeWidth={2} />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ProjectChat;
