import { PlaceholderPage } from "@/components/storefront/placeholder-page";

export const instant = false;

function prettify(slug: string): string {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <PlaceholderPage
      title={prettify(slug)}
      // TODO(catalog): replace with the live category listing using
      // GET /api/public/products?category=<slug>.
      body="This collection is nearly ready — check back soon."
    />
  );
}
