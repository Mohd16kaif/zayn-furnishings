// The full homepage (hero, rooms, featured collections, etc.) ships in a
// later task. This placeholder keeps / inside the storefront shell in the
// meantime.
export const instant = false;

export default function HomePage() {
  return (
    <section className="zf-section zf-page">
      <div className="zf-container">
        <h1>Furniture made to be lived in.</h1>
        <p>
          The new Zayn Furnishings storefront is taking shape. Until then, use
          the menu above to explore the catalog, or view the{" "}
          <a href="/design-preview">design preview</a>.
        </p>
      </div>
    </section>
  );
}
