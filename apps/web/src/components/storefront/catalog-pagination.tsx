import Link from "next/link";

type PageItem = number | "ellipsis";

function pageItems(page: number, totalPages: number): PageItem[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const items: PageItem[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);

  if (start > 2) {
    items.push("ellipsis");
  }

  for (let index = start; index <= end; index += 1) {
    items.push(index);
  }

  if (end < totalPages - 1) {
    items.push("ellipsis");
  }

  items.push(totalPages);

  return items;
}

export function CatalogPagination({
  page,
  totalPages,
  hrefForPage,
}: {
  page: number;
  totalPages: number;
  hrefForPage: (page: number) => string;
}) {
  if (totalPages <= 1) {
    return null;
  }

  const items = pageItems(page, totalPages);

  return (
    <nav className="zf-pagination" aria-label="Pagination">
      {page > 1 ? (
        <Link
          className="zf-pagination__step"
          href={hrefForPage(page - 1)}
          rel="prev"
        >
          Previous
        </Link>
      ) : (
        <span className="zf-pagination__step is-disabled" aria-disabled="true">
          Previous
        </span>
      )}

      <ol className="zf-pagination__list">
        {items.map((item, index) =>
          item === "ellipsis" ? (
            <li
              key={`ellipsis-${index}`}
              className="zf-pagination__ellipsis"
              aria-hidden="true"
            >
              …
            </li>
          ) : (
            <li key={item}>
              {item === page ? (
                <span
                  className="zf-pagination__page is-current"
                  aria-current="page"
                >
                  {item}
                </span>
              ) : (
                <Link
                  className="zf-pagination__page"
                  href={hrefForPage(item)}
                  aria-label={`Page ${item}`}
                >
                  {item}
                </Link>
              )}
            </li>
          ),
        )}
      </ol>

      {page < totalPages ? (
        <Link
          className="zf-pagination__step"
          href={hrefForPage(page + 1)}
          rel="next"
        >
          Next
        </Link>
      ) : (
        <span className="zf-pagination__step is-disabled" aria-disabled="true">
          Next
        </span>
      )}
    </nav>
  );
}
