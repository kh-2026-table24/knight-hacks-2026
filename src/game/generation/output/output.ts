import type { Vector3Tuple } from "three";

export enum ObjectType{
    RectPrism,
    RightTriPrism,
    Plane
}

export interface Object{
    type: ObjectType
    position: Vector3Tuple
    rotation: Vector3Tuple
    scale: Vector3Tuple
    collisionsEnabled: boolean
}

export interface Room{
    id: string,
    dimensions: Vector3Tuple,
    startPosition: Vector3Tuple,
    objects: Object[]
    // TODO later: add connects to later
}
