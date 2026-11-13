# To-do

What still needs work in the storybook (homework 5: print it and ship it, on top of homework 4's 20 pages, two stories, one template, Stripe).

## Print it and ship it (homework 5)
- [x] The book looks like a real book: front cover "<Title>", "starring <Name>"; page 1 is the copyright notice and publisher; the story starts on the next page; About Me is the back cover.
- [x] 11 x 8.5 in landscape hardcover (Lulu casewrap, 24 interior pages): the 20 story pages plus copyright, The End, a page to draw on and a dedication.
- [x] Print files: interior with 0.125 in bleed on every side, and one cover spread (back, spine, front) sized from Lulu's /cover-dimensions/.
- [x] About Me details are checked before anything is drawn, charged or printed: rules (letters only, age 17 or under, no links/emails/phone numbers, obvious insults), OpenAI moderation, and a real-name check that rejects insults and epithets. If a check can't run, nothing goes ahead.
- [x] Nothing is ordered before the parent approves the PDF. Changing the details afterwards cancels the approval.
- [x] Address form (US only), shipping speed, live price from Lulu's cost API, order paid from the balance, print job created in Lulu's SANDBOX. If Lulu refuses, the money goes back.
- [x] Books made before this get a free "update to the printed-book layout" (same pictures, no new drawing).
- [ ] Lulu sandbox jobs stay "unpaid" until paid in the sandbox portal; nothing is actually printed (by design: sandbox only).
- [ ] International shipping (US only for now).
- [ ] A spine title (Lulu only allows spine text from 80 pages; ours has 24).

## From review-log.md run 3 (99/100)
- [ ] The Account page's headline average cost ($1.07 over 8 books) still mixes in the books made before the cost fix; books cost $0.50–0.52 now. Show the current average, and the printed-book margin.
- [x] After signing out, the browser could still reopen a PDF from its cache (max-age 1 day). PDFs are now sent with no-store.
- [ ] All 7 full-page slots put the text under the picture in both books. Redraw those scenes with empty sky for the caption.
- [ ] The About Me check refused "I hate school". Loosen it so only insults, slurs and unsafe content are refused.
- [x] The "add funds" message for a printed copy took ~10 s (print files were built first). The balance is now checked first.

## From my review of the first real book (Jack, 52 seconds)
- [x] Page 3: Jack was holding the rope behind him instead of in front of him. Redrew the scene.
- [x] Page 7: Jack's mother wasn't throwing the beans outside the window, she was just throwing them. Redrew the scene.
- [x] Page 9: it looked like Jack's house was in the sky, based on the view from the window. The window now looks down on the garden.
- [x] Page 13: Jack wasn't hiding from the giant, the giant could clearly see him. Jack is now hidden behind the pot.
- [x] Page 16 (and page 10): the text was blocking the picture. The text spot is now checked by drawing it on the picture and asking the vision model whether it covers any character; if no spot is clear the text goes under the picture.
- [x] Page 17: the giant had 3 feet stepping on the sky. Now exactly two boots.
- [x] Page 19: looked a bit off (floating boots). The beanstalk now falls with no giant.
- [x] Page 20: they still had Milky-White, even though they sold her. Removed the cow.
- [x] The name on the cover was lowercase ("mattan"). Names typed in lowercase are capitalised.
- [x] The refund was hard to find, and it refunded my whole balance in one click. Added a "Request a refund" button and a confirm step.

## From review-log.md run 1 (professor's storybook-review skill, 96/100)
- [x] Every book lost money: $2.72 average API cost against the $0.99 price. Each page sent 10,885 image tokens at high input fidelity (~$0.107 a page). Switched book pages to low input fidelity (517 tokens, ~$0.024 a page); side-by-side tests showed the same scene and likeness.
- [x] Little Red's hair changed between the photo's hair and the stand-in's bob. The edit now replaces the hair under the hood too, and the checker counts hair in likeness.
- [x] The Account page said the bible and scenes cost "$0.00"; they were drawn before cost tracking. It now says "not tracked".
- [ ] 12 of 14 full-page slots still put the text under the picture; redraw those scenes with clear sky.

## Professor's cleanup ("AI mess-ups")
- [x] The Account page advertised the free test card (4242) and "no real money moves"; the footer said "Payments run in Stripe test mode". Customers no longer see any of it; the test-card note shows only to admins.
- [x] Anyone could refund their balance to the card with one button. Refunds are now an admin/support tool (the server refuses them for customers).
- [x] Customers could see our cost per book and margin. The cost tracking is now shown only to admins (Account page and each book).
- [x] The password box talked about "the class password" and "real money"; it's now a plain access code.

## From review-log.md run 2 (98/100)
- [ ] The Account page's average cost ($1.41) still includes the two books made before the cost fix; books now cost about $0.53. Show the average for the current settings.
- [ ] Little Red's hair under the hood is still longer than the child's on most pages (pp. 1, 4, 5, 8). Redraw the stand-in Red with short hair tucked into the hood.
- [ ] Three Red pages needed a second try for likeness; try a higher-quality hero portrait.

## Still open (from the storybook-review result, see storybook-review.md)
- [ ] Page 5 (the trade) is a crowded close-up and the cow is cut off. Redraw it as a wider shot.
- [ ] Page numbers on the paper pages are very small.
- [ ] Little Red needed 4 likeness redraws in the test book.
- [ ] Most full-page pictures now put the text under the picture, because the check is strict. Draw the full-page scenes with more empty sky so the text can stay on the picture.
- [ ] Needs to be tested with more children with different facial features, and different hair / skin colors.
- [ ] The mother should probably share physical features with the child, at least for some features, just like in real life.
- [ ] 52 seconds is close to the 60-second limit. When a page needs a redraw it gets close; try drawing a backup copy of slow pages sooner.
- [ ] Little Red Riding Hood needs the same page-by-page review that Jack got.
- [ ] A "refund this book" option, not only refunding unspent money to the card.

## Earlier homework
- [x] Jack's age looked different in each picture. Every page now starts from the same pre-drawn Jack, so he's the same age and size on every page.
- [x] The story wasn't done. Both stories are now complete, 20 pages each.
- [x] Quotation marks, page numbers on every page, and the About Me page not repeating itself.
