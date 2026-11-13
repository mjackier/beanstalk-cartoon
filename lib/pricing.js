// The printed book's price. Business model (see WRITEUP.md):
//   The picture book PDF stays $0.99 (it covers its ~$0.53 of AI drawing).
//   A printed hardcover, shipped to the door in the US, is one flat price: $39.99,
//   standard shipping included, so the parent never sees a surprise at checkout.
//   Faster shipping is offered at Lulu's extra cost for it, rounded up to the dollar.
//   If Lulu's cost for an address would leave less than MIN_MARGIN, the price goes up for
//   that order (it's shown before the parent places it), so no order ever loses money.
export const PRINT_PRICE_CENTS = Number(process.env.PRINT_PRICE_CENTS || 3999);
export const MIN_MARGIN_CENTS = Number(process.env.PRINT_MIN_MARGIN_CENTS || 800);
export const STRIPE_PCT = 0.029; // what Stripe keeps from the top-up that paid for it
export const STRIPE_FIXED_CENTS = 30;

export const SHIPPING = {
  MAIL: { label: "Standard (about 1 to 2 weeks)", included: true },
  EXPEDITED: { label: "Expedited (about 3 to 5 business days)" },
  EXPRESS: { label: "Express (about 2 to 3 business days)" },
};

const upToDollar = (c) => Math.ceil(c / 100) * 100;
const to99 = (c) => Math.ceil((c + 1) / 100) * 100 - 1; // 4012 -> 4099

// standard: Lulu's quote for MAIL; chosen: Lulu's quote for the chosen level (same object for MAIL).
// generationCents: what drawing the book cost us (already paid for by the $0.99 PDF).
export function priceFor({ standard, chosen, level }) {
  const extra = level === "MAIL" ? 0 : upToDollar(Math.max(0, chosen.totalCents - standard.totalCents));
  let price = PRINT_PRICE_CENTS + extra;
  const stripe = (p) => Math.round(p * STRIPE_PCT) + STRIPE_FIXED_CENTS;
  if (price - chosen.totalCents - stripe(price) < MIN_MARGIN_CENTS) price = to99(chosen.totalCents + MIN_MARGIN_CENTS + stripe(price + 500));
  const margin = price - chosen.totalCents - stripe(price);
  return { priceCents: price, extraShippingCents: extra, luluCents: chosen.totalCents, stripeCents: stripe(price), marginCents: margin };
}
