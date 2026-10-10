import type { Game } from "./output/output"
import type { SavedHouse } from "./generateHouse"
import { testOutput } from "./prompts/test-output"

// Houses written by scripts/gen-house.ts. Bundled at build time, so a new one needs a page reload.
const savedHouses = import.meta.glob<SavedHouse>("/generated/houses/*.json", { eager: true, import: "default" })

const logHouse = (name: string, house: SavedHouse) => {
    console.groupCollapsed(`[generation] "${house.title}" (${name})`)
    console.log(`Theme\n${house.theme}\n\nStory\n${house.story}`)
    for (const room of house.rooms) {
        console.log(`\n${room.name} (${room.id}), ${room.layout}\n${room.notes}`)
        console.table(room.items)
    }
    console.groupEnd()
}

/** The newest saved house, or the one named by ?house=<file name>; the hand-written test game if there are none. */
export const generate = async (): Promise<Game> => {
    const names = Object.keys(savedHouses).sort()
    const wanted = new URLSearchParams(location.search).get("house")
    const name = wanted ? names.find((n) => n.includes(wanted)) : names.at(-1)
    if (!name) {
        console.warn(`[generation] ${wanted ? `no saved house matches "${wanted}"` : "no saved houses yet (npx tsx scripts/gen-house.ts)"}; loading the test game`)
        return JSON.parse(testOutput()) as Game
    }
    logHouse(name, savedHouses[name])
    return savedHouses[name].game
}
