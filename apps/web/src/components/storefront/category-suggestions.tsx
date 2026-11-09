import Link from "next/link";
import type { PublicCategoryNode } from "@zayn/shared";

export function CategorySuggestions({
  categories,
  heading,
  excludeSlug,
}: {
  categories: PublicCategoryNode[];
  heading?: string;
  excludeSlug?: string;
}) {
  const items = categories.filter(
    (category) => category.slug !== excludeSlug,
  );

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="zf-category-suggestions">
      {heading ? <h2>{heading}</h2> : null}
      <ul className="zf-catalog__subcategories">
        {items.map((category) => (
          <li key={category.slug}>
            <Link
              className="zf-subcategory-chip"
              href={`/c/${category.slug}`}
            >
              {category.name}
              <span>{category.product_count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
