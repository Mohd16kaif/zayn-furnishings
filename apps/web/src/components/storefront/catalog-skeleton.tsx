const SKELETON_CARDS = Array.from({ length: 8 }, (_, index) => index);

export function CatalogSkeleton() {
  return (
    <section className="zf-catalog" aria-busy="true" aria-live="polite">
      <div className="zf-container">
        <div className="zf-catalog__header">
          <div className="zf-skeleton zf-skeleton--crumb" />
          <div className="zf-skeleton zf-skeleton--title" />
          <div className="zf-skeleton zf-skeleton--copy" />
        </div>

        <div className="zf-catalog__layout">
          <div className="zf-skeleton zf-skeleton--sidebar" />

          <div className="zf-catalog__results">
            <div className="zf-product-grid">
              {SKELETON_CARDS.map((index) => (
                <div className="zf-skeleton-card" key={index}>
                  <div className="zf-skeleton zf-skeleton-card__media" />
                  <div className="zf-skeleton-card__body">
                    <div className="zf-skeleton zf-skeleton-line zf-skeleton-line--short" />
                    <div className="zf-skeleton zf-skeleton-line" />
                    <div className="zf-skeleton zf-skeleton-line zf-skeleton-line--short" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <span className="zf-sr-only">Loading collection</span>
      </div>
    </section>
  );
}
