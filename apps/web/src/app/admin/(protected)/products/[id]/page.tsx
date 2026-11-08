import { ProductForm } from "../product-form";

export const instant = false;

export default async function EditProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { id } = await params;
  const { saved } = await searchParams;

  return <ProductForm productId={id} initialSaved={saved === "1"} />;
}
