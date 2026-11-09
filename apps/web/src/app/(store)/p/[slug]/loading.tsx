export default function Loading() {
  return (
    <section className="zf-pdp" aria-busy="true" aria-live="polite">
      <div className="zf-container">
        <div className="zf-skeleton zf-skeleton--crumb zf-pdp__crumb" />

        <div className="zf-pdp__layout">
          <div className="zf-pdp__gallery-skeleton">
            <div className="zf-skeleton zf-pdp__skeleton-main" />
            <div className="zf-pdp__thumbs-skeleton">
              {Array.from({ length: 3 }, (_, index) => (
                <div className="zf-skeleton zf-pdp__skeleton-thumb" key={index} />
              ))}
            </div>
          </div>

          <div className="zf-pdp__info">
            <div className="zf-skeleton zf-skeleton--copy" />
            <div className="zf-skeleton zf-pdp__skeleton-title" />
            <div className="zf-skeleton zf-pdp__skeleton-price" />
            <div className="zf-skeleton zf-skeleton-line" />
            <div className="zf-skeleton zf-skeleton-line zf-skeleton-line--short" />
            <div className="zf-skeleton zf-pdp__skeleton-purchase" />
          </div>
        </div>

        <span className="zf-sr-only">Loading product</span>
      </div>
    </section>
  );
}
