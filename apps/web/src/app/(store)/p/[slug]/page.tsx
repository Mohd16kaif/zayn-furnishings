import { PlaceholderPage } from "@/components/storefront/placeholder-page";

export const instant = false;

function prettify(slug: string): string {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <PlaceholderPage
      title={prettify(slug)}
      // TODO(catalog): replace with the live product detail using
      // GET /api/public/products/<slug>.
      body="This product page is nearly ready — check back soon."
    />
  );
}
