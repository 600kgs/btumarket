import type { ReactNode } from "react";

// A friendly empty state: a soft icon in a circle, a one-line message, and an
// optional call to action - used wherever a list comes back empty, instead of
// a bare line of muted text.
export default function EmptyState({
  icon,
  title,
  action,
}: {
  icon: ReactNode;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon" aria-hidden="true">
        {icon}
      </div>
      <p>{title}</p>
      {action}
    </div>
  );
}
