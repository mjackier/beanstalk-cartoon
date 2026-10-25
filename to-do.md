# To-do

What still needs work in the storybook build (pages 1–3 + About Me).

## Faces and consistency
- [ ] Test with more children's photos (different ages, skin tones, hair, glasses). So far it has only been tested on a few photos.
- [ ] Check whether Jack's face drifts between page 1 (front view) and page 2 (three-quarter view). Three-quarter view is where likeness is most likely to slip.
- [ ] Page 3 is dusk and Jack is small in the doorway, so his face is the hardest to recognize there. May need a closer framing.
- [ ] The mother and the old man are described in words only, with no reference image, so they can look different from page to page. Give them their own reference images like Jack.

## Scene accuracy
- [ ] Page 1: check that Milky-White is actually visible through the door and the cupboard is clearly empty.
- [ ] Page 2: the model doesn't always draw exactly five beans or five different colors.
- [ ] Check that the text areas really stay empty (lower third on page 1, sky on page 2, dark grass on page 3).
- [ ] The model sometimes draws letters or signs despite the "no text" instruction. Watch for it.

## Prompt development
- [ ] Keep a log of the Playground experiments: which style words changed what.
- [ ] Try the same page prompt 3 times to see how much results vary.

## App
- [ ] Nothing is saved: refreshing the page loses the photo, Jack, and every page.
- [ ] Each page takes up to a minute. Show progress or let all pages generate in the background.
- [ ] The PDF only uses built-in fonts (Times and Helvetica). Embed a friendlier storybook font.
- [ ] No cover page yet.

## Next iterations
- [ ] Page 4: the beanstalk at dawn (planned in `story.js`, not built).
- [ ] Bring in "planting the seeds" and "climbing the beanstalk" from the first homework as pages.
- [ ] Grow to 20 pages. At 20 calls per book, cost and time per book matter.
