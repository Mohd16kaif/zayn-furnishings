export const instant = false;

export default function SearchPage() {
  return (
    <section className="zf-section zf-page">
      <div className="zf-container">
        <h1>Search</h1>
        <form action="/search" method="get" className="zf-search__page" role="search">
          <label className="zf-sr-only" htmlFor="page-search-input">
            Search products
          </label>
          <input id="page-search-input" name="q" type="search" placeholder="Search" />
          <button type="submit">Search</button>
        </form>
        {/* TODO(catalog): render live results via GET /api/public/products?q=
            instead of the placeholder note below. */}
        <p>Results are on the way — search prepares to meet the live catalog.</p>
      </div>
    </section>
  );
}
