import * as THREE from "three";

export class Room {
  readonly startPosition: THREE.Vector3;

  constructor(startPosition = new THREE.Vector3()) {
    this.startPosition = startPosition;
  }
}
