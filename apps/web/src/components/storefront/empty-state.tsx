import type { ReactNode } from "react";

export function EmptyState({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div className="zf-empty">
      <h2>{title}</h2>
      <p>{body}</p>
      {children}
    </div>
  );
}
