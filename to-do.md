# To-do

What still needs work in the storybook (homework 4: 20 pages, two stories, one template, Stripe).

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
