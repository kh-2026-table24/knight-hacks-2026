import { Float32BufferAttribute, Vector3, type BufferGeometry } from "three";

const UP = new Vector3(0, 1, 0);
const X_AXIS = new Vector3(1, 0, 0);
const p = new Vector3();
const n = new Vector3();
const u = new Vector3();
const v = new Vector3();

/**
 * Replaces the geometry's UVs with ones measured in meters, so a tiled texture keeps the same
 * pixel density on a 20 m wall and a 1 m crate instead of stretching to fit each face.
 *
 * Each vertex is projected onto its face's own plane (using the vertex normal), which also
 * keeps sloped faces like ramps undistorted. Expects flat per-face normals, which Box, Plane
 * and ConvexGeometry all have.
 */
export function applyWorldUVs(geometry: BufferGeometry, tileSize: number) {
  const positions = geometry.getAttribute("position");
  const normals = geometry.getAttribute("normal");
  if (!normals) throw new Error("applyWorldUVs needs vertex normals");

  const uvs = new Float32Array(positions.count * 2);
  for (let i = 0; i < positions.count; i++) {
    p.fromBufferAttribute(positions, i);
    n.fromBufferAttribute(normals, i);

    // u runs horizontally along the face and v points "up" the face. Horizontal faces have no
    // up direction, so they fall back to world X.
    if (Math.abs(n.y) > 0.999) u.copy(X_AXIS);
    else u.crossVectors(UP, n).normalize();
    v.crossVectors(n, u);

    uvs[i * 2] = p.dot(u) / tileSize;
    uvs[i * 2 + 1] = p.dot(v) / tileSize;
  }
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
}
