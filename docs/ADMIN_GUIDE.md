# Admin guide

## Bulk price changes

Only the owner sees the **Change prices** button. It is on the **Products**
page, next to **Add product**.

1. Click **Change prices**.
2. Choose **where** the change applies: all products, or one category. Choosing
   a category also includes its subcategories.
3. Choose the product status. The default is active and draft products.
   Archived products are skipped unless you choose to include them.
4. Choose the change: increase or decrease, percent or dollars, and whether it
   applies to the regular price, the sale price, or both.
5. Choose a rounding option. The panel explains each one with an example.
6. Click **Preview changes**. Review every row. Skipped rows show a plain
   reason. Nothing is saved yet.
7. Click **Apply prices** and confirm. The exact number of products is shown in
   the confirmation.
8. The storefront refreshes within a few seconds. The change appears in
   **Recent price changes** in the same panel.

Rules:

- Prices are in whole cents and must be at least **$1.00** and no more than
  **$1,000,000.00**.
- A sale price must always stay **below** the regular price. If a regular
  price change would make an existing sale price equal or higher, that product
  is skipped. The tool does not silently change the sale price.
- A sale-price change needs an existing sale price. Products without one are
  skipped.
- A single change can affect at most **500 products**. Narrow the category or
  status if the preview says there are too many.
- A preview is valid for **15 minutes**. If someone edits a product after the
  preview, applying returns a message asking you to preview again. The panel
  refreshes the preview for you.

Rounding examples:

- **Nearest dollar**: $11.49 becomes $11.00 and $11.50 becomes $12.00.
- **End in 99 cents**: rounds up, so $11.00 becomes $11.99.
- **End in 00, round up**: $11.01 becomes $12.00.

Undo:

- Every applied change is saved in **Recent price changes** for the last 20
  batches.
- Click **Undo** and confirm. The old regular and sale prices are restored only
  for products whose current prices still match the batch.
- Products that were edited since the batch are skipped and the panel reports
  how many were restored and how many were skipped.
- A batch can be undone only once.

Bulk price changes never change past orders or order totals. Each apply and
undo is recorded in the audit log.
