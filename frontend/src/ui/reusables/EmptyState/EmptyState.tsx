import { Inbox } from 'lucide-react';
import type { ReactNode } from 'react';

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Inbox size={24} /></div>
      <h3>{title}</h3>
      <p className="muted">{description}</p>
      {action}
    </div>
  );
}
