import { describe, expect, it } from "vitest";
import {
  buildFieldGraph, describeMoveRoute, fieldGraphFromData, gatePointsFromFeatures, neighboursOf, routeSummary, shortestRoute,
  type FieldGraphInput,
} from "./field-graph";

// A farm near Paysandú. Shapes are written in meters east/north of an origin
// and converted with a plain spherical approximation, independent of the
// library's own projection.
const LAT0 = -32.3;
const LNG0 = -57.9;
const M_PER_DEG_LAT = 111_195;
const M_PER_DEG_LNG = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180);
const ll = (x: number, y: number): [number, number] => [LNG0 + x / M_PER_DEG_LNG, LAT0 + y / M_PER_DEG_LAT];

/** Closed ring for an axis-aligned rectangle, x/y/w/h in meters. */
const rectRing = (x: number, y: number, w: number, h: number) => [ll(x, y), ll(x + w, y), ll(x + w, y + h), ll(x, y + h), ll(x, y)];
const rect = (x: number, y: number, w: number, h: number) => ({ type: "Polygon", coordinates: [rectRing(x, y, w, h)] });
const section = (id: string, geometry: unknown, name = id.toUpperCase()): FieldGraphInput => ({ id, name, geometry });

describe("buildFieldGraph adjacency", () => {
  it("links two potreros that share a whole edge and measures it", () => {
    const graph = buildFieldGraph([section("a", rect(0, 0, 200, 200)), section("b", rect(200, 0, 200, 200))]);
    expect(graph.edges).toHaveLength(1);
    const [edge] = graph.edges;
    expect([edge.a, edge.b]).toEqual(["a", "b"]);
    expect(edge.sharedM).toBeGreaterThanOrEqual(195);
    expect(edge.sharedM).toBeLessThanOrEqual(205);
    expect(edge.distanceM).toBeGreaterThanOrEqual(197);
    expect(edge.distanceM).toBeLessThanOrEqual(203);
    expect(edge.gate).toBe(false);
  });

  it("measures only the overlapping stretch of a partly shared fence", () => {
    const graph = buildFieldGraph([section("a", rect(0, 0, 200, 200)), section("b", rect(200, 100, 200, 200))]);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].sharedM).toBeGreaterThanOrEqual(95);
    expect(graph.edges[0].sharedM).toBeLessThanOrEqual(110);
  });

  it("does not link potreros that only touch at a corner", () => {
    const graph = buildFieldGraph([section("a", rect(0, 0, 200, 200)), section("b", rect(200, 200, 200, 200))]);
    expect(graph.edges).toEqual([]);
  });

  it("does not link potreros separated by more than the tolerance", () => {
    const graph = buildFieldGraph([section("a", rect(0, 0, 200, 200)), section("b", rect(212, 0, 200, 200))]);
    expect(graph.edges).toEqual([]);
  });

  it("links hand-drawn shapes whose fence is off by a couple of meters", () => {
    const graph = buildFieldGraph([section("a", rect(0, 0, 200, 200)), section("b", rect(202.5, 0, 200, 200))]);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].sharedM).toBeGreaterThanOrEqual(190);
  });

  it("links shapes whose shared fence has different vertices on each side", () => {
    const b = {
      type: "Polygon",
      coordinates: [[ll(200, 0), ll(400, 0), ll(400, 200), ll(200, 200), ll(200.5, 150), ll(199.5, 90), ll(200, 40), ll(200, 0)]],
    };
    const graph = buildFieldGraph([section("a", rect(0, 0, 200, 200)), section("b", b)]);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].sharedM).toBeGreaterThanOrEqual(190);
  });

  it("treats a sliver of overlap along the fence as a shared boundary", () => {
    const graph = buildFieldGraph([section("a", rect(0, 0, 200, 200)), section("b", rect(190, 0, 200, 200))]);
    expect(graph.edges).toHaveLength(1);
  });

  it("respects custom tolerance and minimum shared length", () => {
    const shapes = [section("a", rect(0, 0, 200, 200)), section("b", rect(200, 170, 200, 200))];
    // 30 m of shared fence: enough by default (20 m), not with a 50 m minimum.
    expect(buildFieldGraph(shapes).edges).toHaveLength(1);
    expect(buildFieldGraph(shapes, { minSharedM: 50 }).edges).toHaveLength(0);
    const gap = [section("a", rect(0, 0, 200, 200)), section("b", rect(208, 0, 200, 200))];
    expect(buildFieldGraph(gap).edges).toHaveLength(0);
    expect(buildFieldGraph(gap, { toleranceM: 10 }).edges).toHaveLength(1);
  });
});

describe("buildFieldGraph nodes", () => {
  it("computes centroid and area of a polygon", () => {
    const graph = buildFieldGraph([section("a", rect(0, 0, 200, 100))]);
    const [node] = graph.nodes;
    expect(node.hasPolygon).toBe(true);
    expect(node.areaM2).toBeGreaterThan(19_700);
    expect(node.areaM2).toBeLessThan(20_300);
    const [lng, lat] = node.centroid!;
    const [expectedLng, expectedLat] = ll(100, 50);
    expect(Math.abs(lng - expectedLng) * M_PER_DEG_LNG).toBeLessThan(2);
    expect(Math.abs(lat - expectedLat) * M_PER_DEG_LAT).toBeLessThan(2);
  });

  it("keeps point-only and unplaced potreros as isolated nodes", () => {
    const [lng, lat] = ll(100, 100);
    const graph = buildFieldGraph([
      section("a", rect(0, 0, 200, 200)),
      section("p", { lat, lng }),
      section("n", null),
      section("junk", { type: "Polygon", coordinates: "nope" }),
    ]);
    expect(graph.edges).toEqual([]);
    const point = graph.nodes.find((node) => node.id === "p")!;
    expect(point.hasPolygon).toBe(false);
    expect(point.centroid).toEqual([lng, lat]);
    expect(point.areaM2).toBeNull();
    expect(graph.nodes.find((node) => node.id === "n")!.centroid).toBeNull();
    expect(graph.nodes.find((node) => node.id === "junk")!.hasPolygon).toBe(false);
    expect(graph.components).toHaveLength(4);
  });

  it("handles MultiPolygon parts and holes", () => {
    const multi = { type: "MultiPolygon", coordinates: [[rectRing(0, 0, 100, 100)], [rectRing(1000, 0, 100, 100)]] };
    const withHole = { type: "Polygon", coordinates: [rectRing(2000, 0, 300, 300), rectRing(2100, 100, 100, 100)] };
    const graph = buildFieldGraph([
      section("multi", multi),
      section("east", rect(1100, 0, 100, 100)), // touches the second part only
      section("donut", withHole),
      section("island", rect(2100, 100, 100, 100)), // fills the donut's hole
    ]);
    const pairs = graph.edges.map((edge) => [edge.a, edge.b].sort().join("+")).sort();
    expect(pairs).toEqual(["donut+island", "east+multi"]);
    const donut = graph.nodes.find((node) => node.id === "donut")!;
    // 300×300 minus the 100×100 hole.
    expect(donut.areaM2).toBeGreaterThan(79_000);
    expect(donut.areaM2).toBeLessThan(81_000);
  });

  it("groups connected potreros into components", () => {
    const graph = buildFieldGraph([
      section("a", rect(0, 0, 200, 200)),
      section("b", rect(200, 0, 200, 200)),
      section("far", rect(5000, 0, 200, 200)),
    ]);
    expect(graph.components.map((component) => [...component].sort())).toEqual([["a", "b"], ["far"]]);
  });
});

describe("gates", () => {
  it("marks an edge with a portera on the shared fence", () => {
    const gates = gatePointsFromFeatures([
      { type: "portera", geometry: { type: "Point", coordinates: ll(201, 100) } },
      { type: "aguada", geometry: { type: "Point", coordinates: ll(100, 100) } },
      { type: "portera", geometry: { type: "LineString", coordinates: [ll(0, 0), ll(1, 1)] } },
    ]);
    expect(gates).toHaveLength(1);
    const graph = buildFieldGraph([section("a", rect(0, 0, 200, 200)), section("b", rect(200, 0, 200, 200))], { gates });
    expect(graph.edges[0].gate).toBe(true);
  });

  it("ignores a portera far from the shared fence", () => {
    const graph = buildFieldGraph([section("a", rect(0, 0, 200, 200)), section("b", rect(200, 0, 200, 200))], { gates: [ll(50, 50)] });
    expect(graph.edges[0].gate).toBe(false);
  });
});

describe("neighboursOf", () => {
  it("lists each neighbour with its name, gate and shared length", () => {
    const graph = buildFieldGraph([
      section("a", rect(0, 0, 200, 200), "Potrero Sur"),
      section("b", rect(200, 0, 200, 200), "I-995"),
      section("c", rect(0, 200, 200, 200), "Potrero Norte"),
    ]);
    const list = neighboursOf(graph, "a");
    expect(list.map((item) => item.name)).toEqual(["I-995", "Potrero Norte"]);
    expect(list[0].sharedM).toBeGreaterThan(190);
    expect(neighboursOf(graph, "missing")).toEqual([]);
  });
});

describe("shortestRoute", () => {
  // a | b | c in a row, d alone far away.
  const row = buildFieldGraph([
    section("a", rect(0, 0, 200, 200), "Potrero Sur"),
    section("b", rect(200, 0, 200, 200), "Potrero Norte"),
    section("c", rect(400, 0, 200, 200), "I-995"),
    section("d", rect(5000, 0, 200, 200), "Lejano"),
    section("p", { lat: LAT0, lng: LNG0 }, "Punto"),
  ]);

  it("returns a direct route between neighbours", () => {
    const route = shortestRoute(row, "a", "b")!;
    expect(route.path).toEqual(["a", "b"]);
    expect(route.direct).toBe(true);
    expect(route.via).toEqual([]);
    expect(routeSummary(route)).toBe("lindero directo");
  });

  it("routes through an intermediate potrero", () => {
    const route = shortestRoute(row, "a", "c")!;
    expect(route.path).toEqual(["a", "b", "c"]);
    expect(route.names).toEqual(["Potrero Sur", "Potrero Norte", "I-995"]);
    expect(route.direct).toBe(false);
    expect(route.via).toEqual(["Potrero Norte"]);
    expect(route.distanceM).toBeGreaterThan(390);
    expect(route.distanceM).toBeLessThan(410);
    expect(routeSummary(route)).toBe("pasando por Potrero Norte");
  });

  it("returns null when there is no path, and for unknown or point-only potreros", () => {
    expect(shortestRoute(row, "a", "d")).toBeNull();
    expect(shortestRoute(row, "a", "p")).toBeNull();
    expect(shortestRoute(row, "a", "zzz")).toBeNull();
  });

  it("returns a one-stop route from a potrero to itself", () => {
    expect(shortestRoute(row, "a", "a")?.path).toEqual(["a"]);
  });

  it("prefers a path through porteras over an equally long one without", () => {
    // a → (b or c) → d, where b and c are mirror images; only c has porteras.
    const shapes = [
      section("a", rect(0, 0, 200, 400)),
      section("b", rect(200, 200, 200, 200)),
      section("c", rect(200, 0, 200, 200)),
      section("d", rect(400, 0, 200, 400)),
    ];
    const gates = [ll(200, 100), ll(400, 100)];
    const route = shortestRoute(buildFieldGraph(shapes, { gates }), "a", "d")!;
    expect(route.path).toEqual(["a", "c", "d"]);
    expect(route.gates).toBe(2);
    const noGates = shortestRoute(buildFieldGraph(shapes), "a", "d")!;
    expect(noGates.path).toHaveLength(3);
  });

  it("summarizes long routes compactly", () => {
    expect(routeSummary({ path: ["a", "b", "c", "d", "e"], names: ["A", "B", "C", "D", "E"], via: ["B", "C", "D"], direct: false, distanceM: 1, gates: 0 }))
      .toBe("pasando por B, C y D");
  });
});

describe("describeMoveRoute", () => {
  const graph = buildFieldGraph([
    section("a", rect(0, 0, 200, 200), "Potrero Sur"),
    section("b", rect(200, 0, 200, 200), "Potrero Norte"),
    section("c", rect(400, 0, 200, 200), "I-995"),
    section("far", rect(5000, 0, 200, 200), "Lejano"),
    section("u", null, "Sin dibujar"),
  ], { gates: [ll(200, 100)] });

  it("names a direct lindero, with its portera", () => {
    expect(describeMoveRoute(graph, "a", "b")).toEqual({ text: "Ruta: Potrero Sur → Potrero Norte, lindero directo con portera", path: ["a", "b"], known: true });
    expect(describeMoveRoute(graph, "b", "c")?.text).toBe("Ruta: Potrero Norte → I-995, lindero directo");
  });

  it("lists the potreros crossed on the way", () => {
    expect(describeMoveRoute(graph, "a", "c")).toEqual({ text: "Ruta: Potrero Sur → Potrero Norte → I-995", path: ["a", "b", "c"], known: true });
  });

  it("asks to draw the potreros when geometry is missing", () => {
    expect(describeMoveRoute(graph, "a", "u")).toEqual({ text: "Sin ruta conocida: dibujá los potreros en el mapa.", path: null, known: false });
    expect(describeMoveRoute(graph, "u", "a")?.known).toBe(false);
  });

  it("says when drawn potreros are not joined by linderos", () => {
    expect(describeMoveRoute(graph, "a", "far")?.text).toBe("Sin ruta conocida: ningún camino de linderos dibujados une estos potreros.");
  });

  it("says nothing without a graph, a destination or for the same potrero", () => {
    expect(describeMoveRoute(null, "a", "b")).toBeNull();
    expect(describeMoveRoute(graph, "a", "")).toBeNull();
    expect(describeMoveRoute(graph, "a", "a")).toBeNull();
  });
});

describe("fieldGraphFromData", () => {
  it("builds the graph from section rows and map features", () => {
    const graph = fieldGraphFromData(
      [
        { id: "a", name: "A", map_center: rect(0, 0, 200, 200) },
        { id: "b", name: "B", map_center: rect(200, 0, 200, 200) },
      ],
      [{ type: "portera", geometry: { type: "Point", coordinates: ll(200, 50) } }],
    );
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].gate).toBe(true);
  });
});
