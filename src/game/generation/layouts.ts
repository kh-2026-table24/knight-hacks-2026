// Same idea as theme.ts: code picks the composition so rooms don't all converge on one layout.
// Each entry is a starting shape for the room, not a rule; the room's brief still comes first.

const INDOOR = [
  "Symmetric and formal: the focal point centered on the north wall, matching pieces on each side.",
  "Asymmetric: the focal point off to one side; furniture clustered in one corner, the rest left bare.",
  "Centerpiece: one large object in the middle of the room that the player walks around, furniture along the walls.",
  "Raised stage: a platform along the north wall, reached by stairs, with the focal point on it.",
  "Gallery: a raised walkway along the east or west wall, reached by stairs, overlooking the main floor.",
  "Two zones: a low partition, railing or row of furniture splits the room in two, with a gap to pass through.",
  "Long and narrow, like a corridor or gallery, with objects lined up along both side walls.",
  "Cluttered: many objects crowded together with a winding path between them.",
];

const OUTDOOR = [
  "A grand approach: a broad path straight to the entrance, flanked by matching lamps, statues or hedges.",
  "A walled courtyard with a central fountain or statue the path splits around.",
  "An overgrown approach: a narrow path winding between hedges, trees and ruins to the entrance.",
  "Terraced grounds: raised garden beds or terraces on either side, reached by low steps, with the path between them.",
  "An open forecourt: a wide paved square with scattered objects that tell what happened outside.",
];

export function rollLayout(outdoor: boolean, random: () => number = Math.random): string {
  const list = outdoor ? OUTDOOR : INDOOR;
  return list[Math.floor(random() * list.length)];
}
