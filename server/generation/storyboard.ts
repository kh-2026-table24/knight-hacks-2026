// Stage 1 of generation: the server picks a real haunting or crime at random, and Claude recalls what
// is known about it and writes a storyboard. Left to choose, Claude kept picking the same story. Stage 2 (a separate prompt with the mechanics and GameSpec instructions)
// turns the storyboard into the game, so this stage decides the story and the house, not the JSON.
// Claude runs without tools here, so "research" means careful recall, not web search.

import { GENERATED_ROOM } from "../../src/shared/constants";
import { LIMITS } from "../../src/shared/spec";

const STORIES = [
  // Haunted places: North America
  "Winchester Mystery House (San Jose, California, 1884–1922)",
  "Myrtles Plantation (St. Francisville, Louisiana)",
  "LaLaurie Mansion (New Orleans, 1834)",
  "Lemp Mansion (St. Louis, Missouri)",
  "Whaley House (San Diego, California)",
  "The Bell Witch (Adams, Tennessee, 1817–1821)",
  "The Sallie House (Atchison, Kansas)",
  "Eastern State Penitentiary (Philadelphia)",
  "Waverly Hills Sanatorium (Louisville, Kentucky)",
  "Trans-Allegheny Lunatic Asylum (Weston, West Virginia)",
  "West Virginia Penitentiary (Moundsville)",
  "The Stanley Hotel (Estes Park, Colorado)",
  "RMS Queen Mary (Long Beach, California)",
  "The Amityville house (Amityville, New York, 1974–1976)",
  "Hotel del Coronado and Kate Morgan (Coronado, California, 1892)",
  "Franklin Castle (Cleveland, Ohio)",
  "Ohio State Reformatory (Mansfield, Ohio)",
  "Rolling Hills Asylum, the old county poor farm (Bethany, New York)",
  "Bachelor's Grove Cemetery (near Chicago)",
  "Lavinia Fisher and the Six Mile Wayfarer House (Charleston, South Carolina, 1820)",
  "St. Augustine Lighthouse (St. Augustine, Florida)",
  "Robert the Doll (Key West, Florida)",
  "Alcatraz (San Francisco Bay)",
  "Fort Mifflin (Philadelphia)",
  "Sloss Furnaces (Birmingham, Alabama)",
  "The Shanghai Tunnels (Portland, Oregon)",
  "Bobby Mackey's Music World, once a slaughterhouse (Wilder, Kentucky)",
  "The Annabelle doll (Connecticut, 1970)",
  "The Gettysburg battlefield (Pennsylvania, 1863)",
  "The Amherst Mystery and Esther Cox (Amherst, Nova Scotia, 1878)",
  "Fairmont Banff Springs Hotel and the sealed room 873 (Banff, Canada)",
  // Crimes and mysteries: North America
  "The Salem witch trials (Salem Village, Massachusetts, 1692)",
  "The lost colony of Roanoke (North Carolina, 1590)",
  "The Mary Celeste ghost ship (Atlantic Ocean, 1872)",
  "Villisca axe murder house (Villisca, Iowa, 1912)",
  "Lizzie Borden house (Fall River, Massachusetts, 1892)",
  "The Bloody Benders' inn (Labette County, Kansas, 1871–1873)",
  "H. H. Holmes's 'Murder Castle' (Chicago, 1893)",
  "Belle Gunness's farm (La Porte, Indiana, 1908)",
  "The Axeman of New Orleans (1918–1919)",
  "The Servant Girl Annihilator (Austin, Texas, 1884–1885)",
  "The Cleveland Torso Murders of Kingsbury Run (1935–1938)",
  "Harry Powers and the Quiet Dell murders (West Virginia, 1931)",
  "The Black Dahlia (Los Angeles, 1947)",
  "The Phantom Killer (Texarkana, 1946)",
  "Ed Gein's farmhouse (Plainfield, Wisconsin, 1957)",
  // Britain and Ireland
  "Borley Rectory (Essex, England)",
  "The Tower of London: Anne Boleyn and the Princes in the Tower",
  "Hampton Court Palace and Catherine Howard's Haunted Gallery",
  "Raynham Hall and the Brown Lady (Norfolk, England)",
  "Mary King's Close and the plague (Edinburgh)",
  "The South Bridge Vaults (Edinburgh)",
  "Glamis Castle and its secret room (Angus, Scotland)",
  "Chillingham Castle and the Blue Boy (Northumberland)",
  "The Ancient Ram Inn (Wotton-under-Edge, Gloucestershire)",
  "The Black Monk of Pontefract (Yorkshire, 1966)",
  "The Enfield poltergeist (London, 1977)",
  "The Pendle witch trials (Lancashire, 1612)",
  "Jack the Ripper (Whitechapel, London, 1888)",
  "Burke and Hare (Edinburgh, 1828)",
  "The Ratcliff Highway murders (London, 1811)",
  "The Red Barn murder (Polstead, Suffolk, 1827)",
  "The Road Hill House murder (Wiltshire, 1860)",
  "Mary Ann Cotton, the arsenic poisoner (County Durham, 1870s)",
  "Dr. Crippen and the cellar at Hilldrop Crescent (London, 1910)",
  "Sawney Bean, the cave-dwelling clan of legend (Galloway, Scotland)",
  "Pluckley, England's most haunted village (Kent)",
  "The Highgate Cemetery vampire (London, 1970)",
  "The Flannan Isles lighthouse keepers who vanished (Outer Hebrides, 1900)",
  "Leap Castle and the Bloody Chapel (County Offaly, Ireland)",
  "Loftus Hall and the devil at the card table (County Wexford, Ireland)",
  "Charleville Castle (Tullamore, Ireland)",
  "The Hellfire Club on Montpelier Hill (Dublin)",
  // Europe
  "Elizabeth Báthory and Čachtice Castle (Kingdom of Hungary, c. 1600)",
  "Gilles de Rais, the original Bluebeard (Brittany, 1430s)",
  "Henri Désiré Landru and the villa at Gambais (France, 1915–1919)",
  "Dr. Marcel Petiot and 21 rue Le Sueur (Paris, 1944)",
  "Hinterkaifeck farm (Bavaria, 1922)",
  "Peter Kürten, the Vampire of Düsseldorf (1929)",
  "Darya Saltykova's estate (Moscow, 1750s)",
  "Poveglia, the plague island (Venetian Lagoon)",
  "The Paris Catacombs",
  "Château de Brissac and the Green Lady (Loire Valley)",
  "The Paris Opera chandelier accident that inspired the Phantom (1896)",
  "Houska Castle, built over a 'gateway to hell' (Bohemia)",
  "Moosham Castle and the Zauberer-Jackl witch trials (Salzburg, 1675–1690)",
  "The dancing plague (Strasbourg, 1518)",
  "Hoia-Baciu Forest (Cluj, Romania)",
  "The Dyatlov Pass incident (Ural Mountains, 1959)",
  // Asia, Africa, Latin America, Australia
  "Okiku's well at Himeji Castle, the Banchō Sarayashiki legend (Japan)",
  "Oiwa's ghost, the Yotsuya Kaidan (Edo, Japan)",
  "Bhangarh Fort (Rajasthan, India)",
  "Lawang Sewu (Semarang, Indonesia)",
  "Old Changi Hospital (Singapore)",
  "The Island of the Dolls (Xochimilco, Mexico)",
  "La Llorona, the weeping woman (Mexico)",
  "Rose Hall and Annie Palmer, the White Witch (Jamaica)",
  "The Castle of Good Hope and the Lady in Grey (Cape Town)",
  "Monte Cristo Homestead (Junee, Australia)",
  "The convict-era Port Arthur penal settlement (Tasmania)",
];

/** One story from the list, picked at random. */
export const randomStory = () => STORIES[Math.floor(Math.random() * STORIES.length)];

export const storyboardPrompt = (story: string) => `You are the lead writer and level designer for Paradise Chateau, a short 2.5D horror
exploration game in a retro PS1 style. Each game is built from a real haunting, crime or legend.
Your job in this step is the storyboard: the story, the cast, the house and what the player finds in it.
A second step, with the full building instructions, turns your storyboard into the playable game, so
write it to give that step everything it needs: vivid, specific and consistent.

<story>
${story}
</story>

<steps>
1. Research the story above. Recall everything you reliably know: who was there, what happened and
   in what order, the buildings and rooms involved, the objects, the period details, the rumors and sightings that
   came after. Separate the documented record from legend, and never present an invented detail as
   fact. Look hardest for physical details (an object, a mark on a wall, a locked room, a habit),
   because the player learns the story only through what they see, examine and hear.
2. Find the game in it: a place the player explores, a mystery that unfolds room by room, and a
   final room where the truth (or the haunting at its heart) is revealed.
3. Write the storyboard.
</steps>

<the_game>
These are facts about the engine. A storyboard that ignores them can't be built.

- The player is always the same character: a young woman in dark gothic dress. Don't redesign her;
  give her a reason to be here and let the story happen around her.
- The player walks, climbs stairs and ramps, examines objects, searches containers, talks to
  characters and picks up keys. She has 4 hearts; hazards and hostile characters cost hearts, and
  every hostile moves slower than she does, so danger is escapable.
- The only item is a key, and each key opens one locked door and is used up. Nothing else gates
  progress: there are no other items, no inventory puzzles and no flags, so a character can't react to
  what the player has done or found.
- Every character is someone the player can talk to; the only exception is a hostile threat. A figure
  who has nothing to say doesn't belong in the game.
- Each character has exactly one conversation, heard the first time the player talks to them. It tells
  part of the story and always ends in an outcome: it hands over a key, gives the player a new
  objective, or both. Every later talk gets the same short brush-off that helps no further ("I've told
  you all I know."), so nobody has to be talked to twice.
- A key can lie in the open, be hidden inside an object (it drops out the first time the player
  examines or searches it), or be handed over by a character at the end of their conversation. Hints
  are only words: a character or a note can point the player toward a key.
- Each room has 1 to 5 things the player can interact with in all, counting both story objects to
  examine and characters to talk to; 2 or 3 is usually right. Everything else in it is scenery, so the
  few things that respond are the ones that matter.
- Objectives keep the player from getting stuck. One short instruction is on screen at a time. The
  first is shown from the start; each later one replaces it when the player finishes examining a
  particular story object, talking to a particular character, or picking up a particular key. Write one
  for each step of the way through: after every key and every important clue, the next objective says
  what to look for or where to go. Keep each under ${LIMITS.objectiveLength} characters, concrete, and naming the
  thing and the place ("Ask the keeper's widow about the logbook", "Unlock the lamp room upstairs").
- The map is a grid of rooms, one room per cell. Rooms connect only to neighboring cells (north,
  south, east or west), through a door in the shared wall. The first room listed is where the game
  starts. Every locked door's key must be reachable before that door.
- The camera looks north from the south side of each room. Indoors, the north, west and east walls
  are built and the south side is open to the camera, so the north wall is the stage. Outdoor areas
  (yards, gardens, graveyards, the street) show only the building's face along the north edge.
- A room is ${LIMITS.roomSide[0]} to ${GENERATED_ROOM.maxSide} m wide and deep and ${LIMITS.roomHeight[0]} to ${GENERATED_ROOM.maxHeight} m tall. A room holds at most 4 characters.
- The whole game is drawn from at most ${LIMITS.artJobsWarning} generated images: every distinct material, object
  picture and character pose is one, and a description repeated word for word is drawn once.
- Plan 4 to 8 rooms and 2 to 5 locked doors. At most 12 rooms.
</the_game>

<guidance>
Everything here is advice, not rules. Break it when the story is better for it.

- Respect the real people. Use fictional names for real victims and perpetrators from the last 100
  years; older historical figures can keep their names. The haunting is the subject, not the
  suffering.
- Every room should earn its place: it reveals part of the story, holds a key, or both. Name rooms by
  what they were ("the scullery where she boiled the linens"), not by function ("room 3").
- Make the order of discovery tell the story. Early rooms set the scene, middle rooms complicate it,
  and the last locked door hides the truth.
- Characters can be ghosts, survivors, witnesses, caretakers or the thing itself. Give each one a
  voice, something they want and something they know. A hostile character should feel like part of
  the story, not just an obstacle.
- Hold one visual identity across the whole game: a palette, a small set of recurring materials (6 to
  10 for the whole game, reused word for word from room to room), and a lighting mood. Describe
  surfaces and light concretely ("whitewashed plaster yellowed by lamp smoke"), since those words
  become textures and lights.
- Give each room one focal point on its north wall or at its center that the eye goes to first, and
  a few story objects the player will want to examine. Outdoor areas have no walls to frame them, so
  give them more dressing than indoor rooms.
- Dressing and story objects are solid things that could stand, sit or hang somewhere. Weather and
  effects (spray, waves, fog, smoke, wind) belong in a room's lighting and description, not its objects.
- Keep the voice, but write dialogue that is clear the first time it's read: concrete details over
  riddles, and hints that name the object and where it is in plain words. One ominous line per
  conversation is plenty.
</guidance>

<output>
First write your research inside <research></research>: the documented account, the legends, and the
physical details you plan to use. Then write the storyboard as one JSON object inside
<storyboard></storyboard>, in this shape:

{
  "source": {
    "story": "the story you were given, as written",
    "account": "the true story, 1-3 paragraphs, documented and legendary parts marked as such",
    "inspirations": ["real details you are using and where they appear in the game"]
  },
  "title": "the game's title",
  "summary": "2-5 sentences on what happened here, as the game presents it",
  "premise": "why the player is here and what she's looking for",
  "ending": "what the final room reveals and how the story resolves",
  "beats": ["what the player learns, in the order she learns it"],
  "artDirection": {
    "style": "one paragraph that sets the look for every piece of art",
    "palette": ["4-6 colors as words"],
    "materials": ["recurring surfaces"],
    "lighting": "the light sources and mood"
  },
  "rooms": [
    {
      "id": "kebab-case-id",
      "name": "Name shown to the player",
      "outdoor": false,
      "grid": [0, 0],
      "size": "rough size and shape, e.g. 'large and tall, 18 x 6 x 14 m' or 'a narrow passage'",
      "purpose": "what this room does for the story and the progression",
      "description": "a vivid paragraph: what the player sees, where things are, what happened here",
      "walls": "wall surface",
      "floor": "floor surface",
      "lighting": "how dark the room is and what lights it",
      "focalPoint": "the first thing the eye goes to, and where it is",
      "storyObjects": [
        { "name": "specific, visual name (with the characters, 1 to 5 things to interact with per room)", "where": "its place in the room", "reveals": "what examining it tells the player" }
      ],
      "dressing": ["other objects that fill the room and set the scene"],
      "characters": [
        {
          "name": "name",
          "appearance": "what the image model should draw",
          "role": "ghost, survivor, witness, threat...",
          "personality": "voice and manner, with one or two sample lines",
          "knows": "what their one conversation tells the player, and its outcome: the key they hand over, the objective it sets, or both",
          "brushOff": "the one unhelpful line they say on every later talk",
          "behavior": "stands still, wanders, patrols a route, or hunts the player",
          "hostile": false
        }
      ]
    }
  ],
  "doors": [
    {
      "id": "kebab-case-id",
      "rooms": ["room-a", "room-b"],
      "locked": true,
      "description": "what the door looks like"
    }
  ],
  "keys": [
    {
      "name": "name shown to the player",
      "appearance": "what the key looks like",
      "unlocks": "door id",
      "room": "id of the room it's found in",
      "howFound": "how the player gets it, in story terms",
      "hint": "who or what points the player toward it, if anything"
    }
  ],
  "objectives": [
    {
      "id": "kebab-case-id",
      "text": "what to do next, shown on screen (under ${LIMITS.objectiveLength} characters)",
      "room": "id of the room where it's set (leave out for the first objective, which is shown from the start)",
      "trigger": "the story object, character or key in that room that sets it, once the player examines it, talks to them or picks it up"
    }
  ]
}

Rooms in the "rooms" list must have distinct grid cells, and every door must join two rooms whose
cells are neighbors. List the objectives in the order the player meets them. Write nothing after the closing </storyboard>.
</output>`;
