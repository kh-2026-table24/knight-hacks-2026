// Hand-written stand-in for an LLM response: the foyer of an old house, with stairs up to a balcony.
// type: 0 = RectPrism, 1 = RightTriPrism, 2 = Plane. Rotation in radians.
export const testOutput = () => {
    return `{
  "id": "old-house-foyer",
  "dimensions": [20, 6, 16],
  "startPosition": [8, 0, 14],
  "objects": [
    { "type": 0, "position": [10, 0, 0.15],   "rotation": [0, 0, 0],       "scale": [20, 5, 0.3],    "collisionsEnabled": true },
    { "type": 0, "position": [0.15, 0, 8],    "rotation": [0, 0, 0],       "scale": [0.3, 5, 16],    "collisionsEnabled": true },
    { "type": 0, "position": [19.85, 0, 8],   "rotation": [0, 0, 0],       "scale": [0.3, 5, 16],    "collisionsEnabled": true },

    { "type": 0, "position": [16.5, 0, 9.975],"rotation": [0, 0, 0],       "scale": [3, 0.3, 0.45],  "collisionsEnabled": true },
    { "type": 0, "position": [16.5, 0, 9.525],"rotation": [0, 0, 0],       "scale": [3, 0.6, 0.45],  "collisionsEnabled": true },
    { "type": 0, "position": [16.5, 0, 9.075],"rotation": [0, 0, 0],       "scale": [3, 0.9, 0.45],  "collisionsEnabled": true },
    { "type": 0, "position": [16.5, 0, 8.625],"rotation": [0, 0, 0],       "scale": [3, 1.2, 0.45],  "collisionsEnabled": true },
    { "type": 0, "position": [16.5, 0, 8.175],"rotation": [0, 0, 0],       "scale": [3, 1.5, 0.45],  "collisionsEnabled": true },
    { "type": 0, "position": [16.5, 0, 7.725],"rotation": [0, 0, 0],       "scale": [3, 1.8, 0.45],  "collisionsEnabled": true },
    { "type": 0, "position": [16.5, 0, 7.275],"rotation": [0, 0, 0],       "scale": [3, 2.1, 0.45],  "collisionsEnabled": true },
    { "type": 0, "position": [16.5, 0, 6.825],"rotation": [0, 0, 0],       "scale": [3, 2.4, 0.45],  "collisionsEnabled": true },
    { "type": 0, "position": [16.5, 0, 6.375],"rotation": [0, 0, 0],       "scale": [3, 2.7, 0.45],  "collisionsEnabled": true },
    { "type": 0, "position": [16.5, 0, 5.925],"rotation": [0, 0, 0],       "scale": [3, 3.0, 0.45],  "collisionsEnabled": true },
    { "type": 1, "position": [14.925, 0, 7.95],"rotation": [0, 0, 0],      "scale": [0.15, 3.0, 4.5],"collisionsEnabled": true },
    { "type": 0, "position": [14.925, 2.5, 7.95],"rotation": [0.588, 0, 0],"scale": [0.1, 0.1, 5.41],"collisionsEnabled": false },

    { "type": 0, "position": [16.6, 2.7, 3.0],"rotation": [0, 0, 0],       "scale": [6.2, 0.3, 5.4], "collisionsEnabled": true },
    { "type": 0, "position": [13.6, 3, 3.0],  "rotation": [0, 0, 0],       "scale": [0.1, 1, 5.4],   "collisionsEnabled": true },
    { "type": 0, "position": [13.8, 0, 5.4],  "rotation": [0, 0, 0],       "scale": [0.35, 2.7, 0.35],"collisionsEnabled": true },
    { "type": 0, "position": [13.8, 0, 0.6],  "rotation": [0, 0, 0],       "scale": [0.35, 2.7, 0.35],"collisionsEnabled": true },

    { "type": 0, "position": [5, 0, 0.8],     "rotation": [0, 0, 0],       "scale": [3, 1.4, 1.0],   "collisionsEnabled": true },
    { "type": 0, "position": [5, 1.4, 0.6],   "rotation": [0, 0, 0],       "scale": [2, 3.6, 0.6],   "collisionsEnabled": true },
    { "type": 0, "position": [5, 0, 6],       "rotation": [0, 0, 0],       "scale": [3.5, 0.9, 1.2], "collisionsEnabled": true },
    { "type": 0, "position": [5, 0, 6.75],    "rotation": [0, 0, 0],       "scale": [3.5, 1.6, 0.3], "collisionsEnabled": true },
    { "type": 0, "position": [9.5, 0, 9],     "rotation": [0, 0.3, 0],     "scale": [1.6, 0.8, 1.0], "collisionsEnabled": true },
    { "type": 0, "position": [18.6, 0, 12.5], "rotation": [0, 0.2, 0],     "scale": [1, 1, 1],       "collisionsEnabled": true },

    { "type": 2, "position": [9.5, 0, 0.6],   "rotation": [0, 0, 0],       "scale": [1, 3, 0],       "collisionsEnabled": true },
    { "type": 2, "position": [11.5, 0, 0.32], "rotation": [0, 0, 0],       "scale": [1.6, 3, 0],     "collisionsEnabled": false },
    { "type": 2, "position": [2.2, 2, 0.32],  "rotation": [0, 0, 0],       "scale": [1.2, 1.4, 0],   "collisionsEnabled": false },
    { "type": 2, "position": [8, 0.01, 9.5],  "rotation": [-1.5708, 0, 0], "scale": [4, 3, 0],       "collisionsEnabled": false },
    { "type": 2, "position": [3, 0, 12],      "rotation": [0, 0, 0.1],     "scale": [0.8, 1.9, 0],   "collisionsEnabled": true }
  ]
}`
}
