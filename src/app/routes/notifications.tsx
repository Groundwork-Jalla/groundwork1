import { useEffect, useState } from 'react';
import { Bell, CheckCheck, Building2, Upload, MessageSquare, BadgeCheck, AlertCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase/client';

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)   return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  created_at: string;
  project_id: string | null;
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  stage_approved:          <BadgeCheck className="size-4 text-green-600" />,
  evidence_uploaded:       <Upload className="size-4 text-blue-600" />,
  message_received:        <MessageSquare className="size-4 text-purple-600" />,
  project_created:         <Building2 className="size-4 text-brand-mid-grey" />,
  verification_requested:  <AlertCircle className="size-4 text-amber-600" />,
};

export default function NotificationsPage() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (!error && data) setNotifications(data as Notification[]);
        setLoading(false);
      });
  }, [user]);

  async function markAllRead() {
    if (!user) return;
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', user.id)
      .eq('read', false);
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 pb-24 md:pb-8 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-brand-near-black">Notifications</h2>
          <p className="text-xs text-brand-mid-grey mt-0.5">
            {loading ? 'Loading…' : unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={markAllRead}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-mid-grey hover:text-brand-near-black transition-colors border border-brand-border-grey rounded-lg px-3 py-1.5 bg-white"
          >
            <CheckCheck className="size-3.5" /> Mark all read
          </button>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-brand-border-grey divide-y divide-brand-off-white">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="flex items-start gap-3 px-5 py-4 animate-pulse">
              <div className="size-8 rounded-full bg-brand-light-grey shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-48 rounded bg-brand-light-grey" />
                <div className="h-3 w-64 rounded bg-brand-light-grey" />
                <div className="h-2.5 w-20 rounded bg-brand-light-grey" />
              </div>
            </div>
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-brand-border-grey py-16 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-brand-off-white">
            <Bell className="size-7 text-brand-border-grey" />
          </div>
          <div>
            <p className="text-sm font-semibold text-brand-near-black mb-1">No notifications yet</p>
            <p className="text-xs text-brand-mid-grey leading-relaxed max-w-xs mx-auto">
              You'll be notified here when stages are approved, evidence is uploaded, or messages arrive.
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-brand-border-grey overflow-hidden">
          <div className="divide-y divide-brand-off-white">
            {notifications.map(n => (
              <div
                key={n.id}
                className={`flex items-start gap-3 px-5 py-4 transition-colors ${!n.read ? 'bg-brand-off-white/60' : ''}`}
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-off-white mt-0.5">
                  {TYPE_ICON[n.type] ?? <Bell className="size-4 text-brand-mid-grey" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-sm font-semibold text-brand-near-black truncate">{n.title}</p>
                    {!n.read && <span className="size-2 rounded-full bg-brand-near-black shrink-0" />}
                  </div>
                  <p className="text-xs text-brand-mid-grey leading-relaxed">{n.body}</p>
                  <p className="text-[10px] text-brand-border-grey mt-1.5 tabular-nums">
                    {timeAgo(n.created_at)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
