Changes made:
- Controlled qty input added.
- Client-side subtotal shown.
- Debounced auto-commit emits `pharmarack-qty-changed` CustomEvent after 700ms idle.
- handleAddToCart now uses AbortController to cancel prior add requests per product.
- Per-product error state `addErrors` added; UI shows error message when present.

Notes:
- Debounced auto-commit emits an event instead of calling the API to avoid duplicate additions; other modules can listen for `pharmarack-qty-changed` to perform background sync if desired.
- To change auto-commit behavior to directly call the API, modify `autoCommitQuantity` in the file.
