// The two stories. Both fill the same 20 template slots (template.js).
//
// Per page:
//   text   what the reader sees. {he} {him} {his} {He} {His} follow the pronouns chosen for the child.
//   scene  what the picture shows (other characters come from the character bible).
//   hero   what the hero is doing, or null if the hero is not on this page.
//   cast   bible characters in the picture (besides the hero).
//   keep   things the page needs you to see: the checker must find them, and text may never cover them.
//
// Each story's character bible is stored in the database (table `characters`) the first time the
// server starts; the reference images are generated once by the admin and reused for every book.

export const STORIES = {
  jack: {
    id: "jack",
    title: "Jack and the Beanstalk",
    heroName: "Jack",
    heroKey: "jack",
    blurb: "Magic beans, a beanstalk to the clouds, and a giant's golden hen.",
    bible: {
      jack: {
        name: "Jack",
        hero: true,
        description:
          "Jack, the hero: a cheerful child of about 8 with a round face, short tousled brown hair and big curious eyes. " +
          "Wears an oatmeal-coloured linen tunic with a green patch on the chest, a knotted rope belt, dark green trousers " +
          "with brown knee patches, and brown lace-up boots.",
      },
      mother: {
        name: "Jack's mother",
        description:
          "Jack's mother: a kind, hard-working village mother in her thirties with warm brown hair tied in a bun, wearing a long faded-blue peasant dress with rolled-up sleeves and a cream apron.",
      },
      oldMan: {
        name: "The old man",
        description:
          "The old man: small and stooped, with a long white beard, bright twinkling blue eyes, a pointed grey-green hood and a patched brown cloak, leaning on a crooked walking stick.",
      },
      cow: {
        name: "Milky-White",
        description:
          "Milky-White the cow: a gentle cream-and-white dairy cow with soft brown patches, small curved horns, long eyelashes and a brass bell on a leather collar.",
      },
      giant: {
        name: "The giant",
        description:
          "The giant: enormous, about five times as tall as a grown man, bald, with a bushy red beard, a big round nose and heavy eyebrows; " +
          "brown leather jerkin over a rough green shirt, huge boots. Grumpy and cartoonish, never gory or truly frightening.",
      },
      giantWife: {
        name: "The giant's wife",
        description:
          "The giant's wife: very tall, about four times as tall as a woman, plump and kind-faced with rosy cheeks, grey hair in a bun, a mustard-yellow dress and a white apron.",
      },
      hen: {
        name: "The golden hen",
        description: "The hen: a plump little brown hen with a bright red comb and shiny feathers.",
      },
      harp: {
        name: "The golden harp",
        description: "The harp: a small golden harp whose top is carved into a singing woman's face.",
      },
    },
    pages: [
      {
        text: "Once upon a time, Jack lived with {his} mother in a tiny cottage at the edge of the fields. They were very poor.",
        scene: "A small thatched cottage with a crooked chimney at the edge of golden fields, under a wide open morning sky. Milky-White grazes by a wooden fence. Jack's mother hangs washing on a line.",
        hero: "Jack stands in the front yard near the fence, facing the viewer, waving, clearly visible.",
        cast: ["mother", "cow"],
        keep: ["Jack's face", "the cottage", "Milky-White"],
      },
      {
        text: "One morning the cupboard was bare. “We must sell Milky-White,” said {his} mother. “She gives no more milk.”",
        scene: "Inside the bare cottage kitchen: the cupboard doors hang open and every shelf is empty. Jack's mother stands by the cupboard, worried. Through the open door, Milky-White waits in the yard.",
        hero: "Jack stands beside his mother, looking up at her sadly; face fully visible from the front.",
        cast: ["mother", "cow"],
        keep: ["Jack's face", "the mother's face", "the empty cupboard"],
      },
      {
        text: "So Jack tied a rope to Milky-White and set off down the long, winding road to market.",
        scene: "A dirt road winding between green hedges and fields towards a distant town on a hill. Sunny morning.",
        hero: "Jack walks along the road leading Milky-White on a rope, smiling, in three-quarter view towards the viewer.",
        cast: ["cow"],
        keep: ["Jack's face", "Milky-White", "the rope"],
      },
      {
        text: "On the way, {he} met a strange little old man with a twinkle in his eye. “Good morning, Jack,” he said.",
        scene: "The same country road beside a big old oak tree. The old man steps out from the shade of the oak, smiling.",
        hero: "Jack stops in surprise, holding Milky-White's rope, facing the old man; face clearly visible in three-quarter view.",
        cast: ["oldMan", "cow"],
        keep: ["Jack's face", "the old man's face", "Milky-White"],
      },
      {
        text: "“Trade me your cow,” said the old man, “and I will give you five magic beans.”",
        scene: "Close on the road. The old man holds out his open palm with exactly five beans on it, each a different bright colour (red, blue, yellow, purple, green), large enough to see clearly.",
        hero: "Jack leans in to look at the beans with wide, tempted eyes; face in three-quarter view.",
        cast: ["oldMan", "cow"],
        keep: ["Jack's face", "the old man's face", "the five beans"],
      },
      {
        text: "Magic beans! Jack could not say no. {He} handed over the rope and ran all the way home.",
        scene: "Plain soft background of sunny fields, out of focus.",
        hero: "Close-up: Jack holds the five colourful beans in his cupped hands near his chest and grins with delight, looking at the viewer.",
        cast: [],
        keep: ["Jack's face", "the five beans"],
      },
      {
        text: "“Beans?” cried {his} mother. “You sold our cow for beans?” And she threw them out of the window.",
        scene: "The cottage kitchen at dusk, warm lamplight. Jack's mother, angry, flings the five colourful beans out of the open window; they arc through the air into the dark garden.",
        hero: "Jack stands in the middle of the kitchen with his hands raised, shocked; face clearly visible.",
        cast: ["mother"],
        keep: ["Jack's face", "the mother's face", "the beans flying out of the window"],
      },
      {
        text: "That night Jack went to bed without any supper, feeling very sorry for {him}self.",
        scene: "A tiny attic bedroom at night with a sloping roof, a small round window showing stars, a patchwork quilt, moonlight.",
        hero: "Jack sits on the edge of his bed in a nightshirt, chin in his hands, sad; face lit by moonlight and clearly visible.",
        cast: [],
        keep: ["Jack's face", "the window"],
      },
      {
        text: "But in the morning {his} little room was full of green light. Outside, a giant beanstalk had grown up into the sky!",
        scene: "The attic bedroom in morning light. Through the open round window, a huge twisting green beanstalk with enormous leaves rises past the window into the clouds.",
        hero: "Jack leans out of the window in his nightshirt, mouth open in amazement, looking up at the beanstalk; face in three-quarter view.",
        cast: [],
        keep: ["Jack's face", "the beanstalk"],
      },
      {
        text: "Jack climbed out of the window and up, up, up the beanstalk, until the cottage was a speck far below.",
        scene: "High in the sky: the giant beanstalk twists up through fluffy clouds; far below, the tiny cottage and patchwork fields.",
        hero: "Jack, back in his tunic and boots, climbs the beanstalk in the middle of the picture, looking down over his shoulder at the viewer with an excited grin; face clearly visible.",
        cast: [],
        keep: ["Jack's face", "the beanstalk"],
      },
      {
        text: "At the very top, a long white road ran across the clouds to an enormous castle.",
        scene: "Above the clouds: a road of white cloud leads to a gigantic grey stone castle with a huge wooden door, bright blue sky.",
        hero: "Jack stands at the top of the beanstalk on the cloud road, seen from the side and slightly in front, gazing at the castle in wonder; face visible.",
        cast: [],
        keep: ["Jack's face", "the castle"],
      },
      {
        text: "A giant woman opened the door. “Hide, quickly!” she whispered. “My husband is coming, and he is always grumpy before breakfast.”",
        scene: "At the castle's huge open doorway, the giant's wife bends down kindly with a finger to her lips.",
        hero: "Jack stands on the doorstep looking up at the giant's wife; tiny beside her but face clearly visible.",
        cast: ["giantWife"],
        keep: ["Jack's face", "the giant's wife's face"],
      },
      {
        text: "THUMP! THUMP! In stomped the giant. “Fee-fi-fo-fum!” he roared. “I smell a little one!”",
        scene: "The giant's enormous kitchen with a huge table and a giant copper pot. The giant stomps in through the door, sniffing the air.",
        hero: "In the front corner of the picture, Jack peeks out from behind the giant copper pot, eyes wide; face clearly visible.",
        cast: ["giant"],
        keep: ["Jack's face", "the giant's face"],
      },
      {
        text: "After breakfast the giant set a little brown hen on the table. “Lay!” he said, and she laid an egg of solid gold.",
        scene: "On the giant's huge wooden table, the little brown hen sits beside a shining golden egg.",
        hero: "Jack peeks over the edge of a huge bowl on the table, staring at the golden egg in amazement; face clearly visible.",
        cast: ["hen"],
        keep: ["Jack's face", "the hen", "the golden egg"],
      },
      {
        text: "Soon the giant was snoring like thunder. Jack crept out, scooped up the hen, and tiptoed to the door.",
        scene: "The giant is fast asleep in a huge chair, head back, snoring. The golden harp stands on a shelf behind him.",
        hero: "Jack tiptoes across the floor in the foreground holding the hen, glancing back at the sleeping giant; face visible.",
        cast: ["giant", "hen", "harp"],
        keep: ["Jack's face", "the hen", "the sleeping giant"],
      },
      {
        text: "On the shelf, the golden harp cried out, “Master! Master!” The giant woke with a roar and came thundering after Jack.",
        scene: "Out on the cloud road: the giant chases from the castle in the background, arms out, roaring (cartoonish, not scary). The harp gleams in the open doorway.",
        hero: "Jack runs towards the viewer in the foreground with the hen under his arm, determined; face clearly visible.",
        cast: ["giant", "hen", "harp"],
        keep: ["Jack's face", "the giant", "the hen"],
      },
      {
        text: "Down the beanstalk Jack slid, with the hen tucked under {his} arm and the giant's great boots coming after him.",
        scene: "The beanstalk in the sky; high above, the giant's huge boots climb down through the clouds.",
        hero: "Jack slides down the beanstalk holding on with one hand and the hen with the other, looking up; face visible.",
        cast: ["giant", "hen"],
        keep: ["Jack's face", "the hen", "the giant's boots"],
      },
      {
        text: "“Mother, the axe!” shouted Jack. Chop! Chop! Chop! {He} swung with all {his} might.",
        scene: "At the foot of the beanstalk beside the cottage. Jack's mother runs out of the cottage, pointing up. The hen sits safely on the grass.",
        hero: "Jack swings an axe at the thick beanstalk, side view, determined face clearly visible.",
        cast: ["mother", "hen"],
        keep: ["Jack's face", "the axe", "the beanstalk"],
      },
      {
        text: "With a creak and a crash, the beanstalk tumbled down. The giant scrambled back into the clouds and was never seen again.",
        scene: "The beanstalk topples sideways across the fields in a big leafy swoosh; high up, the giant's boots disappear back into the clouds.",
        hero: "Jack and his mother stand together hugging and watching, safe at the cottage; Jack's face visible.",
        cast: ["mother", "giant"],
        keep: ["Jack's face", "the falling beanstalk"],
      },
      {
        text: "From then on, the little hen laid a golden egg every morning, and Jack and {his} mother were never hungry again. The End.",
        scene: "The cottage kitchen, now cosy and full: food on the table, a warm fire. The hen sits in a basket with golden eggs. Milky-White looks in through the window, home again.",
        hero: "Jack sits at the table beside his mother, laughing, holding up a golden egg; face clearly visible.",
        cast: ["mother", "hen", "cow"],
        keep: ["Jack's face", "the mother's face", "the hen", "the golden eggs"],
      },
    ],
  },

  red: {
    id: "red",
    title: "Little Red Riding Hood",
    heroName: "Little Red",
    heroKey: "red",
    blurb: "A red cape, a walk through the woods, and a wolf in Grandmother's bed.",
    bible: {
      red: {
        name: "Little Red",
        hero: true,
        description:
          "Little Red, the hero: a cheerful child of about 8 with a round face and big bright eyes. Wears a bright red wool cape " +
          "with a deep hood over a cream-coloured tunic, brown leggings and short brown boots.",
      },
      mother: {
        name: "Little Red's mother",
        description:
          "Little Red's mother: a cheerful village mother in her thirties with curly auburn hair tied back, wearing a long sage-green dress and a white baking apron.",
      },
      grandmother: {
        name: "Grandmother",
        description:
          "Grandmother: small and round, with fluffy white hair in a bun, round gold spectacles, rosy cheeks, a lavender shawl over a long pale-pink nightgown.",
      },
      wolf: {
        name: "The wolf",
        description:
          "The wolf: a tall grey wolf who walks on his hind legs, with sly yellow eyes, a long snout, a big toothy grin and a bushy tail. Sly and cartoonish, never bloody or truly terrifying.",
      },
      woodcutter: {
        name: "The woodcutter",
        description:
          "The woodcutter: a broad-shouldered man with a short black beard and a kind face, a red-and-black checked shirt, brown trousers and boots, an axe resting on his shoulder.",
      },
      basket: {
        name: "The basket",
        description: "A wicker basket covered with a red-and-white checked cloth, with a loaf of bread poking out.",
      },
    },
    pages: [
      {
        text: "Once upon a time, at the edge of a deep green forest, lived a child who always wore a bright red cape. Everyone called {him} Little Red Riding Hood.",
        scene: "A pretty village cottage with flower boxes at the edge of a deep green forest, under a wide open morning sky.",
        hero: "Little Red stands in the garden by the gate in the red cape, facing the viewer and smiling, clearly visible.",
        cast: [],
        keep: ["Little Red's face", "the cottage", "the forest"],
      },
      {
        text: "One morning {his} mother packed a basket with fresh bread and honey cakes. “Grandmother is ill,” she said. “Take her this.”",
        scene: "A sunny cottage kitchen. Little Red's mother places honey cakes into the basket on the table.",
        hero: "Little Red stands at the table beside her, watching eagerly; face fully visible.",
        cast: ["mother", "basket"],
        keep: ["Little Red's face", "the mother's face", "the basket"],
      },
      {
        text: "“Stay on the path,” said Mother, “and don't stop to talk to strangers.” Little Red promised.",
        scene: "At the open cottage door. Little Red's mother bends down with one finger raised, giving advice.",
        hero: "Little Red holds the basket and nods seriously; face in three-quarter view.",
        cast: ["mother", "basket"],
        keep: ["Little Red's face", "the mother's face"],
      },
      {
        text: "The path wound deep into the forest, where the trees grew tall and the birds sang high above.",
        scene: "A sun-dappled forest with very tall trees and beams of light; a narrow dirt path winds between ferns and wildflowers.",
        hero: "Little Red walks along the path towards the viewer swinging the basket, happy; face clearly visible.",
        cast: ["basket"],
        keep: ["Little Red's face", "the path"],
      },
      {
        text: "Then, from behind a tree, stepped a wolf with a big friendly smile. “Good morning, little one!”",
        scene: "On the forest path. The wolf leans out from behind a thick tree trunk with a wide, sly smile, tipping an imaginary hat.",
        hero: "Little Red stops on the path, surprised but curious, facing the wolf; face in three-quarter view.",
        cast: ["wolf", "basket"],
        keep: ["Little Red's face", "the wolf's face"],
      },
      {
        text: "“Where are you going with that lovely basket?” asked the wolf. “To Grandmother's cottage, past the three oak trees,” said Little Red.",
        scene: "Soft forest background, out of focus.",
        hero: "Close-up: Little Red, hood up, looking up and talking innocently with a friendly smile, holding the basket.",
        cast: ["basket"],
        keep: ["Little Red's face"],
      },
      {
        text: "“Why not pick her some flowers?” said the wolf. “Look how pretty they are!” And he slipped away between the trees.",
        scene: "The forest opens onto a sunny meadow full of bluebells and buttercups. The wolf points a long arm towards the meadow, grinning.",
        hero: "Little Red looks at the meadow with delight, standing at the edge of the path; face visible.",
        cast: ["wolf", "basket"],
        keep: ["Little Red's face", "the wolf", "the flowers"],
      },
      {
        text: "Little Red wandered off the path, picking bluebells and buttercups, and forgot all about the time.",
        scene: "A sunny meadow full of bluebells and buttercups, the forest edge behind; butterflies.",
        hero: "Little Red kneels among the flowers holding a bunch of them, smiling; face clearly visible.",
        cast: ["basket"],
        keep: ["Little Red's face", "the flowers"],
      },
      {
        text: "Meanwhile, the wolf raced ahead to Grandmother's cottage and knocked on the door. Tap, tap, tap.",
        scene: "A small cottage in a forest clearing with a green door and a round window. The wolf stands at the door, knocking politely, grinning slyly over his shoulder.",
        hero: null,
        cast: ["wolf"],
        keep: ["the wolf's face", "the door"],
      },
      {
        text: "Grandmother peeked out, saw the wolf, and hid in the wardrobe, quick as a mouse.",
        scene: "Inside Grandmother's cosy bedroom: Grandmother in her nightgown steps into a tall wooden wardrobe, peeking out with a hand over her mouth, while the wolf's shadow falls through the doorway.",
        hero: null,
        cast: ["grandmother", "wolf"],
        keep: ["Grandmother's face", "the wardrobe"],
      },
      {
        text: "The wolf put on Grandmother's nightcap and spectacles, climbed into her bed, and pulled the covers up to his nose.",
        scene: "Grandmother's bedroom: the wolf lies in the bed wearing a frilly white nightcap and Grandmother's round spectacles, the quilt pulled up to his snout, looking very pleased with himself.",
        hero: null,
        cast: ["wolf"],
        keep: ["the wolf's face", "the nightcap"],
      },
      {
        text: "Soon Little Red arrived with the basket and a big bunch of flowers. The door was open, so {he} stepped inside.",
        scene: "Grandmother's cottage door standing open in the forest clearing.",
        hero: "Little Red stands in the doorway with the basket and a bunch of flowers, peering in; face clearly visible.",
        cast: ["basket"],
        keep: ["Little Red's face", "the open door"],
      },
      {
        text: "“Grandmother, what big ears you have!” “All the better to hear you with, my dear.”",
        scene: "Grandmother's bedroom. The wolf in the nightcap and spectacles sits up in bed, cupping one huge ear.",
        hero: "Little Red stands at the bedside holding the basket, looking puzzled; face clearly visible.",
        cast: ["wolf", "basket"],
        keep: ["Little Red's face", "the wolf's face"],
      },
      {
        text: "“Grandmother, what big eyes you have!” “All the better to see you with, my dear.”",
        scene: "Close on the bed: the wolf in nightcap and spectacles leans forward with enormous yellow eyes.",
        hero: "Little Red, in the foreground, leans back slightly with a suspicious frown; face clearly visible.",
        cast: ["wolf"],
        keep: ["Little Red's face", "the wolf's eyes"],
      },
      {
        text: "“Grandmother, what big TEETH you have!” “All the better to EAT you with!”",
        scene: "The wolf throws off the covers with a huge toothy grin (cartoonish, not bloody).",
        hero: "Little Red steps back in alarm, hands up, eyes wide; face clearly visible.",
        cast: ["wolf"],
        keep: ["Little Red's face", "the wolf's teeth"],
      },
      {
        text: "Out of the bed leapt the wolf! Little Red dropped the basket and ran, shouting, “Help! Help!”",
        scene: "Grandmother's bedroom: the wolf leaps out of the bed in a tangle of quilt, nightcap flying. The basket lies spilled on the floor.",
        hero: "Little Red runs towards the viewer in the foreground, shouting, cape flying; face clearly visible.",
        cast: ["wolf", "basket"],
        keep: ["Little Red's face", "the wolf"],
      },
      {
        text: "A woodcutter working nearby heard the cry and came running through the door.",
        scene: "Grandmother's doorway: the woodcutter bursts in, axe on his shoulder, looking brave.",
        hero: "Little Red hides safely behind the woodcutter, peeking around him; face visible.",
        cast: ["woodcutter"],
        keep: ["Little Red's face", "the woodcutter's face"],
      },
      {
        text: "The wolf took one look at the woodcutter, jumped out of the window, and ran into the forest. He was never seen again.",
        scene: "Grandmother's bedroom: the wolf dives out of the open window, nightcap still on, tail last. The woodcutter stands with hands on hips.",
        hero: "Little Red stands beside the woodcutter, pointing at the window and laughing; face visible.",
        cast: ["wolf", "woodcutter"],
        keep: ["Little Red's face", "the wolf leaving through the window"],
      },
      {
        text: "Out of the wardrobe climbed Grandmother. “My brave little one!” she said, and hugged Little Red tight.",
        scene: "Grandmother's bedroom, the wardrobe door open behind them.",
        hero: "Little Red and Grandmother hug warmly, both smiling; Little Red's face clearly visible over Grandmother's shoulder.",
        cast: ["grandmother"],
        keep: ["Little Red's face", "Grandmother's face"],
      },
      {
        text: "They shared the honey cakes by the fire. And Little Red never, ever strayed from the path again. The End.",
        scene: "Grandmother's cosy cottage by a crackling fire: a table with tea and honey cakes. The woodcutter sits with a cup of tea.",
        hero: "Little Red sits at the table between Grandmother and the woodcutter, laughing, holding a honey cake; face clearly visible.",
        cast: ["grandmother", "woodcutter", "basket"],
        keep: ["Little Red's face", "Grandmother's face", "the honey cakes"],
      },
    ],
  },
};

export const STORY_IDS = Object.keys(STORIES);

export const PRONOUNS = {
  he: { he: "he", him: "him", his: "his" },
  she: { he: "she", him: "her", his: "her" },
  they: { he: "they", him: "them", his: "their" },
};

// "{He} ran" -> "She ran". Only the hero's words change; the wolf stays "he".
export function personalize(text, pronouns = "he") {
  const p = PRONOUNS[pronouns] || PRONOUNS.he;
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  return text.replace(/\{(he|him|his|He|Him|His)\}/g, (_, k) =>
    k[0] === k[0].toUpperCase() ? cap(p[k.toLowerCase()]) : p[k]
  );
}
