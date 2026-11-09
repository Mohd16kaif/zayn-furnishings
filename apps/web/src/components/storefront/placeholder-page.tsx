type PlaceholderPageProps = {
  title: string;
  body: string;
};

/** Shared "coming soon" page body used by the storefront placeholder routes. */
export function PlaceholderPage({ title, body }: PlaceholderPageProps) {
  return (
    <section className="zf-section zf-page">
      <div className="zf-container">
        <h1>{title}</h1>
        <p>{body}</p>
      </div>
    </section>
  );
}
