import Link from "next/link";

export function StoreNotFound() {
  return (
    <section className="zf-catalog zf-notfound">
      <div className="zf-container">
        <div className="zf-notfound__inner">
          <span className="zf-eyebrow">404</span>
          <h1>This page has moved on.</h1>
          <p>
            The page you were looking for isn&apos;t here anymore. Head back to
            the shop, or search the catalog for something new.
          </p>

          <div className="zf-notfound__actions">
            <Link className="zf-btn zf-btn--primary" href="/">
              Back to the shop
            </Link>
            <Link className="zf-btn zf-btn--ghost" href="/search">
              Search the catalog
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
