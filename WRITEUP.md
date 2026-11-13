# Write-up: Print it and ship it

Mattan Jackier · MCON 368 · Beanstalk Storybook · https://beanstalk.jackier.xyz

## What changed

1. **A printed book you can order from the app.** After a book is made, the parent reads the PDF, ticks
   "I looked through all 26 pages. Print the book exactly like this", and approves it. Only then does the
   address form appear. They pick a shipping speed, see the total, and place the order. The app builds the
   two print files, takes the price from their balance and creates the print job at **Lulu's Print API, in
   the sandbox** (no real book is printed or charged). If Lulu refuses the order, the money goes straight
   back to the balance. The order and Lulu's status show on the book's page.
2. **It looks like a real book** (11 × 8.5 in landscape hardcover):
   - Front cover: the title, then "starring Sarah", then the first picture.
   - Inside page 1: the copyright notice and the publisher ("© 2026 Beanstalk Storybook (Mattan Jackier).
     All rights reserved. Published by Beanstalk Storybook (Mattan Jackier), beanstalk.jackier.xyz",
     personalized edition, adapted from the folk tale, illustrations made with AI).
   - The story starts on the next page (pages 2–21 = story pages 1–20).
   - Pages 22–24: The End, a framed page for the child to draw their favourite part, a dedication.
   - Back cover: About Me.
3. **About Me is checked before anything is drawn, charged or printed.** Three layers, cheapest first,
   and it fails closed (if a check can't run, nothing goes ahead):
   - rules: a name has only letters, spaces, hyphens and apostrophes; age 17 or under; no links, emails or
     phone numbers; a short list of obvious insults;
   - OpenAI's moderation endpoint (free);
   - gpt-4.1-mini reads the name like a bookshop clerk: it must be a real-sounding name from any culture,
     and insults, epithets, slurs, rude words and joke names are refused. The other fields must be fit for
     a children's book.
   Tested: "Stupid" (rules), "Stinky Pete" (name check), "I hate you all" (moderation), age 40 (rules) are
   refused with a message next to the field; "Oluwaseun", "Mattan", "Mary-Kate", "O'Brien" are accepted.
   Nothing is charged when the check says no. Editing the details after approval cancels the approval.

## Why Lulu

| | Lulu Print API | Others looked at |
|---|---|---|
| Takes our PDF and prints a real bound book | yes (interior PDF + cover PDF by URL) | Prodigi, Gelato, Peecho also do; most need a sales call or are photo-book only |
| Ships to the customer's address | yes, 5 speeds | yes |
| Free sandbox where orders are never printed or charged | yes, separate site and keys | Gelato/Prodigi have test modes but need business sign-up |
| Price and cover size APIs | `/print-job-cost-calculations/`, `/cover-dimensions/`, file validators | partial |

The format is a **hardcover casewrap, 11 × 8.5 in landscape, premium full colour on 80# coated paper**
(`pod_package_id` `1100X0850FCPRECW080CW444GXX`, set by `LULU_POD_PACKAGE_ID`). A paperback would need at
least 32 pages; a casewrap needs 24, which is exactly the copyright page + 20 story pages + 3 closing pages.

## The business model

The parent already pays **$0.99** for the PDF; that covers drawing the book (about $0.53 in API calls).
The printed book is an add-on for a book they've already seen and approved, so there is no risk of
printing something they don't like. It is sold as **one flat price, shipped to the door: $39.99 with
standard shipping in the US included**. Parents compare it with personalised books that sell for
$35–$45 plus shipping; a flat, shipping-included price means no surprise at checkout.
Faster shipping costs Lulu's extra charge for that speed, rounded up to the dollar. If an address would
leave less than an $8 margin (Alaska, Hawaii), that order's price goes up and the parent sees it before
placing it, so no order loses money. Payment comes out of the same balance the PDF uses (topped up with
Stripe), so the money flow from homework 4 still holds.

## Cost per book and the margin

Real numbers from Lulu's sandbox cost API (`/print-job-cost-calculations/`, 13 Nov 2026), one copy of
this book (24-page 11 × 8.5 casewrap) shipped to a test address in Washington, DC. Generation cost is the
average of books made at the current settings (cost tracking in the `api_calls` table, see homework 4).

**Per book, standard shipping (MAIL):**

| | Cost to us | Paid by the parent |
|---|---:|---:|
| Drawing the book: portrait, 20 pages, checks (OpenAI) | $0.53 | |
| The PDF | | $0.99 |
| Printing the hardcover (Lulu) | $16.14 | |
| Shipping, standard (Lulu) | $5.69 | |
| Fulfillment fee (Lulu) | $0.75 | |
| Sales tax Lulu charges (6% in DC) | $1.37 | |
| The printed book, shipped | | $39.99 |
| Stripe's fee on the top-ups that paid for it (2.9% + $0.30, about) | $1.46 + $0.33 | |
| **Total** | **$26.27** | **$40.98** |

**Margin on a printed book:** $40.98 − $26.27 = **$14.71 per book, 36%**.
Only the print order: $39.99 − $23.95 (Lulu, all in) − $1.46 (Stripe) = **$14.58** (36% of $39.99).
The PDF on its own: $0.99 − $0.53 − about $0.33 Stripe ≈ $0.13 (it pays for itself; the printed book is
where the money is).

**Faster shipping** (same address; the extra Lulu cost is passed on, rounded up to the dollar):

| Shipping | Lulu total (print + ship + fee + tax) | Price | Stripe | Margin |
|---|---:|---:|---:|---:|
| Standard (MAIL) | $23.95 | $39.99 | $1.46 | $14.58 |
| Expedited | $39.90 | $55.99 (+$16) | $1.92 | $14.17 |
| Express | $55.80 | $71.99 (+$32) | $2.39 | $13.80 |

The rule in `lib/pricing.js`: price = $39.99 + extra shipping; if Lulu's cost for an address would leave
less than $8 after Stripe, the price is raised to keep $8 (shown to the parent before ordering). Break-even
on fixed costs (domain, Render) is a handful of books a month.

## How it is built

- `book/pdf.js`: one set of drawing functions makes three files, so what the parent approves is what is
  printed: the reading copy (26 pages: front cover, the 24 inside pages, back cover), the printer's
  interior (24 pages, 810 × 630 pt = trim + 0.125 in bleed on every side; full-page art stretches into the
  bleed), and the cover spread (back | spine | front, sized from Lulu's `/cover-dimensions/`).
- `lib/validate.js`: the About Me check. `lib/lulu.js`: Lulu over `fetch` (OAuth client credentials,
  cost, cover dimensions, print jobs, file validators); it refuses to talk to Lulu production.
- `lib/pricing.js`: the price rule above. `server.js`: approve → quote → order. Lulu downloads the print
  files from a signed link that expires in a week (`/print-files/<token>.pdf`); a changed link is refused.
- Database: `orders` table (address, price paid, Lulu's quote, job id and status), `documents.kind`
  (book / print_interior / print_cover), `books.approval` and `books.details_ok`.
- Customers never see our cost or margin, the test card, or the word "sandbox"; admins see Lulu's job id,
  status, our cost and margin on each order.

## Tested

- Locally against a fake Lulu: 30 checks pass (approval required, stale PDF refused, bad address
  refused, quote, stale price refused, 402 without enough balance, Lulu refusal refunds, order placed,
  charged once, print files download without sign-in and a tampered link is refused, editing the details
  cancels the approval). A Playwright run clicks the whole flow as a customer.
- Live on beanstalk.jackier.xyz against Lulu's sandbox (review-log.md run 3, 13 Nov 2026): Little Red made
  in 41 s and Jack in 26 s from a new photo; both PDFs 26 pages in the real-book order. "I hate school" in
  About Me was refused before anything was charged (since loosened, see to-do). The printed copy was refused
  at a $3.02 balance (402, "Add funds first"), then approved, quoted at $39.99 and ordered: Lulu sandbox
  **Print Job #363851** ("beanstalk-order-1") went from CREATED to UNPAID within two minutes, which means
  Lulu downloaded both print files and accepted them. Balance trail 0 → 5 → 4.01 → 3.02 → 23.02 → 43.02 →
  42.02 (refund) → 2.03 (print order). The storybook-review score is 99/100 (run 3).

## Links

- Live site: https://beanstalk.jackier.xyz
- Repo: https://github.com/mjackier/beanstalk-cartoon
- PDFs the app produced (run 3): [Jack and the Beanstalk, starring Mattan](samples/Jack-and-the-Beanstalk-starring-Mattan.pdf) ·
  [Little Red Riding Hood, starring Mattan](samples/Little-Red-Riding-Hood-starring-Mattan.pdf)
- [to-do.md](to-do.md) · [review-log.md](review-log.md)
