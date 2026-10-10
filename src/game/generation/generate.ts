import type { Game } from "./output/output"
import { testOutput } from "./prompts/test-output"
 
const generateResponse = async () => {
    // TODO add api call to generate response
    return testOutput()
}

export const generate = async () => {

    const res = await generateResponse()
    return JSON.parse(res) as Game
}