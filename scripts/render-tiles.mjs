import { promises as fs } from "fs"
import path from "path"
import { createCanvas } from "canvas"
import sharp from "sharp"
import * as turf from "@turf/turf"
import { SphericalMercator } from "@mapbox/sphericalmercator"
import * as cover from "@mapbox/tile-cover"
import RBush from "rbush"
import { scaleLinear } from "d3-scale"
import { rgb } from "d3-color"

const TILE_SIZE = 512
const MIN_ZOOM = 10
const MAX_ZOOM = 13
const OUTPUT_DIR = "./tiles/raster/buildings"

const colorScale = scaleLinear()
  .domain([0, 150])
  .range(["#edf8e9", "#005a32"])
  .clamp(true)

const sm = new SphericalMercator({ size: TILE_SIZE })

const getColorForAge = (age) => {
  if (age === null) return "#ccc"
  const colorString = colorScale(age)
  const color = rgb(colorString)
  return [color.r, color.g, color.b, 180]
}

const getPixelCoordinates = (lon, lat, x, y, z) => {
  const px = sm.px([lon, lat], z)
  const tilePx = sm.px(sm.ll([x * TILE_SIZE, y * TILE_SIZE], z), z)

  return {
    x: px[0] - tilePx[0],
    y: px[1] - tilePx[1],
  }
}

const renderPolygon = (ctx, coordinates, x, y, z) => {
  ctx.beginPath()

  const exterior = coordinates[0]
  const startPx = getPixelCoordinates(exterior[0][0], exterior[0][1], x, y, z)
  ctx.moveTo(startPx.x, startPx.y)

  for (let i = 1; i < exterior.length; i++) {
    const px = getPixelCoordinates(exterior[i][0], exterior[i][1], x, y, z)
    ctx.lineTo(px.x, px.y)
  }
  ctx.closePath()

  for (let i = 1; i < coordinates.length; i++) {
    const hole = coordinates[i]
    const holeStartPx = getPixelCoordinates(hole[0][0], hole[0][1], x, y, z)
    ctx.moveTo(holeStartPx.x, holeStartPx.y)

    for (let j = 1; j < hole.length; j++) {
      const px = getPixelCoordinates(hole[j][0], hole[j][1], x, y, z)
      ctx.lineTo(px.x, px.y)
    }
    ctx.closePath()
  }

  ctx.fill()
  ctx.stroke()
}

const renderFeature = (ctx, feature, x, y, z) => {
  const age = feature.properties.age
  const color = getColorForAge(age)
  const geometry = feature.geometry

  ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${color[3] / 255})`
  ctx.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${Math.min(255, color[3] + 50) / 255})`
  ctx.lineWidth = 0.5

  if (geometry.type === "Polygon") {
    renderPolygon(ctx, geometry.coordinates, x, y, z)
  } else if (geometry.type === "MultiPolygon") {
    geometry.coordinates.forEach((polygon) => {
      renderPolygon(ctx, polygon, x, y, z)
    })
  }
}

const generateTile = async (x, y, z, spatialIndex) => {
  const canvas = createCanvas(TILE_SIZE, TILE_SIZE)
  const ctx = canvas.getContext("2d")

  ctx.clearRect(0, 0, TILE_SIZE, TILE_SIZE)

  const bbox = sm.bbox(x, y, z)
  const tileBounds = turf.bboxPolygon(bbox)

  const buildingCandidates = spatialIndex.search({
    minX: bbox[0],
    minY: bbox[1],
    maxX: bbox[2],
    maxY: bbox[3],
  })

  const intersectingBuildings = buildingCandidates
    .filter(
      ({ feature }) =>
        turf.booleanIntersects(feature, tileBounds) ||
        turf.booleanContains(tileBounds, feature) ||
        turf.booleanContains(feature, tileBounds)
    )
    .map(({ feature }) => feature)

  intersectingBuildings.forEach((building) => {
    renderFeature(ctx, building, x, y, z)
  })

  return canvas.toBuffer("image/png")
}

const generateZoomLevel = async (zoom, spatialIndex, bounds) => {
  const boundsPolygon = turf.bboxPolygon(bounds)
  const tiles = cover.tiles(boundsPolygon.geometry, {
    min_zoom: zoom,
    max_zoom: zoom,
  })

  const batchSize = 50
  for (let i = 0; i < tiles.length; i += batchSize) {
    const batch = tiles.slice(i, i + batchSize)

    await Promise.all(
      batch.map(async ([x, y, z]) => {
        try {
          const pngBuffer = await generateTile(x, y, z, spatialIndex)

          const pngTileDir = path.join(
            OUTPUT_DIR,
            "png",
            z.toString(),
            x.toString()
          )
          const webpTileDir = path.join(
            OUTPUT_DIR,
            "webp",
            z.toString(),
            x.toString()
          )
          await fs.mkdir(pngTileDir, { recursive: true })
          await fs.mkdir(webpTileDir, { recursive: true })

          await fs.writeFile(path.join(pngTileDir, `${y}.png`), pngBuffer)

          const webpBuffer = await sharp(pngBuffer)
            .webp({ quality: 85 })
            .toBuffer()
          await fs.writeFile(path.join(webpTileDir, `${y}.webp`), webpBuffer)
        } catch (error) {
          console.error(`Error generating tile ${z}/${x}/${y}:`, error.message)
        }
      })
    )

    console.log(
      `Completed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(tiles.length / batchSize)}`
    )
  }
}

const main = async () => {
  const geojsonPath = process.argv[2]

  console.log("Loading GeoJSON...")
  const geojsonData = JSON.parse(await fs.readFile(geojsonPath, "utf8"))
  const features = geojsonData.features || geojsonData

  const buildings = features.filter((feature) => {
    try {
      if (!feature.geometry || !feature.properties) return false
      turf.cleanCoords(feature)
      return true
    } catch (error) {
      return false
    }
  })

  console.log(`Loaded ${buildings.length} valid buildings`)

  const featureCollection = turf.featureCollection(buildings)
  const bounds = turf.bbox(featureCollection)

  const spatialIndex = new RBush()
  buildings.forEach((feature, i) => {
    const [minX, minY, maxX, maxY] = turf.bbox(feature)
    spatialIndex.insert({
      minX,
      minY,
      maxX,
      maxY,
      id: i,
      feature,
    })
  })
  console.log("Bounds:", bounds)

  await fs.mkdir(OUTPUT_DIR, { recursive: true })

  for (let zoom = MIN_ZOOM; zoom <= MAX_ZOOM; zoom++) {
    await generateZoomLevel(zoom, spatialIndex, bounds)
  }

  const metadata = {
    name: "Detroit Building Age Map",
    bounds: bounds.join(","),
    minzoom: MIN_ZOOM.toString(),
    maxzoom: MAX_ZOOM.toString(),
  }
  await fs.writeFile(
    path.join(OUTPUT_DIR, "png", "metadata.json"),
    JSON.stringify({ ...metadata, format: "png" }, null, 2)
  )
  await fs.writeFile(
    path.join(OUTPUT_DIR, "webp", "metadata.json"),
    JSON.stringify({ ...metadata, format: "webp" }, null, 2)
  )

  console.log("Done! Tiles generated in ./tiles/")
}

main().catch(console.error)
