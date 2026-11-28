type PlaceholderPageProps = {
  title: string;
  body?: string;
};

/** Shared neutral page body for routes that do not have approved text yet. */
export function PlaceholderPage({
  title,
  body = "This page is being prepared.",
}: PlaceholderPageProps) {
  return (
    <section className="zf-section zf-page">
      <div className="zf-container">
        <h1>{title}</h1>
        <p>{body}</p>
      </div>
    </section>
  );
}
